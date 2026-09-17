"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Text, useTexture } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { EffectPass, type BloomEffect, type EffectComposer as EffectComposerImpl } from "postprocessing";
import * as THREE from "three";

import { attachHlsStream } from "@/lib/hls-stream";
import { CONTACT_EMAIL, CONTACT_INSTAGRAM } from "@/lib/contact";
import { GLASS_TARGET_ID, getWordmarkMotion, type WordmarkMotion } from "./hero-wordmark-motion";
import { createGlassGradientTexture, createGlassMaterial, createSheenGradientTexture } from "./wordmark-glass";
import { useReducedMotion, useRenderingEnabled, usePointerPosition } from "./scene-utils";

const WORDMARK = "bur1alrites";
const WORDMARK_FONT = "/fonts/AIxDB-CUMI.TTF";
const GLASS_ASPECT = 866 / 1070;
// Distance chosen so a perspective camera reproduces the old orthographic 1-world-unit = 1-CSS-px framing at z=0.
const CAMERA_DISTANCE = 900;
// Color channels above 1 stay HDR-bright (toneMapped=false) so Bloom's luminance threshold reads the text as emissive.
// Kept well above threshold+smoothing so widening the soft edge (below) can't dim the idle glow.
const BASE_EMISSIVE = 1.4;
const MAX_EMISSIVE = 3.2;
const MAX_TILT = 0.18;
// The wordmark sits close to the camera and the video far behind it, so camera drift separates them strongly.
const TEXT_DEPTH = 420;
const VIDEO_DEPTH = -2400;
// Enough tessellation for the luminance displacement to read as relief rather than facets.
const VIDEO_SEGMENTS = 180;
const MAX_VIDEO_DISPLACEMENT = 900;
// Tap radius in UV units; smooths the relief so fine video detail and grain stop rippling the mesh.
const VIDEO_DISPLACEMENT_BLUR = 0.02;
const PARALLAX_STRENGTH = 60;
const PARALLAX_EASE = 0.06;
// Thin extruded body: a handful of stacked glyph copies read as solid sides once the camera is off-axis.
const EXTRUDE_LAYERS = 8;
const EXTRUDE_STEP = 1.4;

// Objects off the calibration plane must be scaled so 1 world unit still covers 1 CSS pixel on screen.
function depthScale(depth: number) {
  return (CAMERA_DISTANCE - depth) / CAMERA_DISTANCE;
}

// troika-three-text extends THREE.Mesh with this reactive glyph property.
type TroikaTextMesh = THREE.Mesh & {
  fillOpacity: number;
};

type WordmarkGeometry = { galleryTop: number; contactTop: number };

function fontSizeForViewport(width: number) {
  return Math.min(Math.max(width * 0.08, 48), 260);
}

// Reads live DOM geometry so the wordmark stays in sync with the gallery/contact sections without prop drilling.
function useWordmarkGeometry() {
  const geometryRef = useRef<WordmarkGeometry>({ galleryTop: 1, contactTop: Number.POSITIVE_INFINITY });

  useEffect(() => {
    const contact = document.getElementById(GLASS_TARGET_ID);
    const gallery = contact?.previousElementSibling;

    const measure = () => {
      geometryRef.current = {
        galleryTop: gallery ? gallery.getBoundingClientRect().top + window.scrollY : window.innerHeight,
        contactTop: contact ? contact.getBoundingClientRect().top + window.scrollY : Number.POSITIVE_INFINITY,
      };
    };

    measure();
    const resizeObserver = new ResizeObserver(measure);
    if (contact) resizeObserver.observe(contact);
    if (gallery instanceof Element) resizeObserver.observe(gallery);
    window.addEventListener("resize", measure, { passive: true });

    return () => {
      window.removeEventListener("resize", measure);
      resizeObserver.disconnect();
    };
  }, []);

  return geometryRef;
}

function currentMotion(geometryRef: React.RefObject<WordmarkGeometry>): WordmarkMotion {
  return getWordmarkMotion({
    scrollY: window.scrollY,
    viewportHeight: window.innerHeight,
    ...geometryRef.current,
  });
}

// Calibrates FOV to the viewport and drifts the camera toward the pointer to parallax the whole scene.
function SceneRig() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const pointer = usePointerPosition();
  const target = useMemo(() => new THREE.Vector3(0, 0, CAMERA_DISTANCE), []);
  const lookAt = useMemo(() => new THREE.Vector3(0, 0, TEXT_DEPTH), []);

  useEffect(() => {
    // r3f's documented pattern: mutate the camera in an effect when the viewport changes.
    /* eslint-disable-next-line react-hooks/immutability */
    camera.fov = (2 * Math.atan(size.height / 2 / CAMERA_DISTANCE) * 180) / Math.PI;
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
  }, [camera, size]);

  useFrame(() => {
    // Camera drifts opposite the pointer and keeps the wordmark plane centred, so the text never leaves its spot.
    target.set(-pointer.x * PARALLAX_STRENGTH, pointer.y * PARALLAX_STRENGTH, CAMERA_DISTANCE);
    // r3f's documented pattern: mutate three.js objects (here, the camera) in useFrame instead of setState.
    camera.position.lerp(target, PARALLAX_EASE);
    camera.lookAt(lookAt);
  });

  return null;
}

function HeroVideoPlane({
  manifestUrl,
  geometryRef,
}: {
  manifestUrl: string;
  geometryRef: React.RefObject<WordmarkGeometry>;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readyRef = useRef(false);
  const size = useThree((state) => state.size);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    videoRef.current = video;

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    mesh.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uOpacity: { value: 0 },
        uDisplacement: { value: MAX_VIDEO_DISPLACEMENT },
        uBlur: { value: VIDEO_DISPLACEMENT_BLUR },
      },
      vertexShader: `
        uniform sampler2D uMap;
        uniform float uDisplacement;
        uniform float uBlur;
        varying vec2 vUv;

        float luminanceAt(vec2 uv) {
          // The sampled texel is sRGB-encoded; without linearising, mid-tones read far brighter than they are.
          vec3 linear = pow(texture2D(uMap, clamp(uv, 0.0, 1.0)).rgb, vec3(2.2));
          return dot(linear, vec3(0.2126, 0.7152, 0.0722));
        }

        // Vertex texture fetch always reads mip 0, so the blur has to be an explicit tap kernel.
        float blurredLuminance(vec2 uv) {
          float total = luminanceAt(uv) * 0.2;
          for (int i = 0; i < 8; i++) {
            float angle = float(i) * 0.7853981634;
            vec2 direction = vec2(cos(angle), sin(angle));
            total += luminanceAt(uv + direction * uBlur * 0.5) * 0.06;
            total += luminanceAt(uv + direction * uBlur) * 0.04;
          }
          return total;
        }

        void main() {
          vUv = uv;
          // Black anchors the plane and only highlights lift, so dark areas keep their full on-screen size.
          float luminance = blurredLuminance(uv);
          vec3 displaced = position + vec3(0.0, 0.0, luminance * uDisplacement);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          vec4 texel = texture2D(uMap, vUv);
          // The composer works in linear space and encodes to sRGB on output, so emit linear here.
          gl_FragColor = vec4(pow(texel.rgb, vec3(2.2)), texel.a * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: true,
    });

    let controller: Awaited<ReturnType<typeof attachHlsStream>> | null = null;
    let cancelled = false;
    const markReady = () => {
      readyRef.current = true;
    };
    const markNotReady = () => {
      readyRef.current = false;
    };

    video.addEventListener("canplay", markReady);
    void attachHlsStream(video, manifestUrl, {
      startLevel: 0,
      onFatalError: markNotReady,
    })
      .then((nextController) => {
        if (cancelled) {
          nextController.destroy();
          return;
        }

        controller = nextController;
        // Autoplay can still be refused even when muted; failing here just leaves the poster underneath.
        void video.play().catch(() => {});
      })
      .catch(markNotReady);

    return () => {
      cancelled = true;
      controller?.destroy();
      video.removeEventListener("canplay", markReady);
      texture.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    };
  }, [manifestUrl]);

  useFrame(() => {
    const mesh = meshRef.current;
    const video = videoRef.current;
    if (!mesh || !video || !mesh.material) return;

    // Farther planes must be scaled up to keep covering the same screen-space area under perspective.
    const scale = depthScale(VIDEO_DEPTH);
    const videoAspect = (video.videoWidth || size.width) / (video.videoHeight || size.height);
    const viewportAspect = size.width / size.height;

    const baseWidth = viewportAspect > videoAspect ? size.width : size.height * videoAspect;
    const baseHeight = viewportAspect > videoAspect ? size.width / videoAspect : size.height;
    // Extra headroom keeps the plane covering the frame while the camera drifts sideways.
    mesh.scale.set(baseWidth * scale * 1.25, baseHeight * scale * 1.25, 1);

    const motion = currentMotion(geometryRef);
    const material = mesh.material as THREE.ShaderMaterial;
    const targetOpacity = readyRef.current ? 1 - motion.fadeProgress : 0;
    const opacity = THREE.MathUtils.lerp(material.uniforms.uOpacity.value, targetOpacity, 0.12);
    material.uniforms.uOpacity.value = opacity;
    // Depth writes resolve the self-overlapping folds; released during the fade so it blends cleanly.
    material.depthWrite = opacity > 0.99;
  });

  return (
    <mesh ref={meshRef} position={[0, 0, VIDEO_DEPTH]}>
      <planeGeometry args={[1, 1, VIDEO_SEGMENTS, VIDEO_SEGMENTS]} />
    </mesh>
  );
}

function WordmarkGlyphs({ geometryRef }: { geometryRef: React.RefObject<WordmarkGeometry> }) {
  const size = useThree((state) => state.size);
  const textRef = useRef<TroikaTextMesh>(null);
  const wordmarkGroupRef = useRef<THREE.Group>(null);
  const sideGroupRef = useRef<THREE.Group>(null);
  const glassGroupRef = useRef<THREE.Group>(null);
  const glassMeshRef = useRef<THREE.Mesh>(null);
  const sheenMeshRef = useRef<THREE.Mesh>(null);
  const bloomRef = useRef<BloomEffect>(null);
  const wideBloomRef = useRef<BloomEffect>(null);
  const composerRef = useRef<EffectComposerImpl>(null);
  const ditheringAppliedRef = useRef(false);

  useFrame(() => {
    // The composer adds its EffectPass one render after mount (internal state update), so a
    // mount-time effect runs too early to find it - poll each frame until it exists, once.
    if (ditheringAppliedRef.current) return;
    for (const pass of composerRef.current?.passes ?? []) {
      if (pass instanceof EffectPass) {
        pass.dithering = true;
        ditheringAppliedRef.current = true;
      }
    }
  });

  const logoTexture = useTexture("/assets/logo.png");
  const glassTexture = useMemo(() => createGlassGradientTexture(), []);
  const sheenTexture = useMemo(() => createSheenGradientTexture(), []);
  // Bright-but-flat color (not real lighting) so the text reads as an emissive object under Bloom.
  const textMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(BASE_EMISSIVE, BASE_EMISSIVE, BASE_EMISSIVE),
        toneMapped: false,
        fog: false,
        // Harmless fallback for the (non-post-processed) direct render path; see EffectPass.dithering above for the real fix.
        dithering: true,
      }),
    [],
  );

  useEffect(() => () => textMaterial.dispose(), [textMaterial]);

  // Dim, non-emissive body so the extruded sides read as depth rather than extra glow under Bloom.
  const sideMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.06, 0.06, 0.07),
        toneMapped: false,
        transparent: true,
        depthWrite: false,
        fog: false,
        dithering: true,
      }),
    [],
  );

  useEffect(() => () => sideMaterial.dispose(), [sideMaterial]);

  useEffect(() => {
    const glassMesh = glassMeshRef.current;
    const sheenMesh = sheenMeshRef.current;
    if (!glassMesh || !sheenMesh) return;

    const glassMaterial = createGlassMaterial(glassTexture, logoTexture);
    const sheenMaterial = createGlassMaterial(sheenTexture, logoTexture, THREE.AdditiveBlending);
    glassMesh.material = glassMaterial;
    sheenMesh.material = sheenMaterial;

    return () => {
      glassMaterial.dispose();
      sheenMaterial.dispose();
    };
  }, [glassTexture, sheenTexture, logoTexture]);

  const fontSize = fontSizeForViewport(size.width);
  const glassWidth = Math.min(Math.max(size.width * 0.3, 220), 620);
  const glassHeight = glassWidth / GLASS_ASPECT;

  useFrame(() => {
    const motion = currentMotion(geometryRef);
    const groupFade = 1 - motion.fadeProgress;
    const group = wordmarkGroupRef.current;

    if (group) {
      group.visible = groupFade > 0.001;
      // Subtle tilt + recession sells the "object floating in 3D space" read as you scroll.
      // glowProgress starts at 0 at rest, so no centering offset - this keeps the wordmark upright until it tilts.
      group.rotation.y = motion.glowProgress * MAX_TILT;
      group.rotation.x = motion.textBlurProgress * -MAX_TILT * 0.6;
    }
    if (glassGroupRef.current) glassGroupRef.current.visible = motion.contactProgress > 0.001;

    const emissive = BASE_EMISSIVE + (MAX_EMISSIVE - BASE_EMISSIVE) * motion.glowProgress;
    textMaterial.color.setScalar(emissive);

    if (bloomRef.current) {
      const intensity = 0.3 + motion.glowProgress * 2.2;
      bloomRef.current.intensity = intensity;
      // Faint wide tail stays proportional so it never out-glows the near-field bloom it's softening.
      if (wideBloomRef.current) wideBloomRef.current.intensity = intensity * 0.2;
    }

    const text = textRef.current;
    if (text) {
      text.fillOpacity = groupFade;
    }

    sideGroupRef.current?.children.forEach((child) => {
      (child as TroikaTextMesh).fillOpacity = groupFade;
    });

    const glassMaterial = glassMeshRef.current?.material as THREE.ShaderMaterial | undefined;
    const sheenMaterial = sheenMeshRef.current?.material as THREE.ShaderMaterial | undefined;
    // r3f's documented pattern: mutate three.js objects in useFrame instead of setState.
    /* eslint-disable react-hooks/immutability */
    if (glassMaterial?.uniforms) glassMaterial.uniforms.uOpacity.value = motion.contactProgress;
    if (sheenMaterial?.uniforms) sheenMaterial.uniforms.uOpacity.value = motion.contactProgress * 0.9;
    /* eslint-enable react-hooks/immutability */
  });

  return (
    <>
      <group ref={wordmarkGroupRef} position={[0, 0, TEXT_DEPTH]} scale={depthScale(TEXT_DEPTH)}>
        <Text
          ref={textRef}
          font={WORDMARK_FONT}
          fontSize={fontSize}
          anchorX="center"
          anchorY="middle"
          material={textMaterial}
          position={[0, 0, 0]}
        >
          {WORDMARK}
        </Text>
        <group ref={sideGroupRef}>
          {Array.from({ length: EXTRUDE_LAYERS }, (_, index) => (
            <Text
              key={index}
              font={WORDMARK_FONT}
              fontSize={fontSize}
              anchorX="center"
              anchorY="middle"
              material={sideMaterial}
              position={[0, 0, -(index + 1) * EXTRUDE_STEP]}
            >
              {WORDMARK}
            </Text>
          ))}
        </group>
      </group>

      <group ref={glassGroupRef}>
        <mesh ref={glassMeshRef} position={[0, 0, 1]}>
          <planeGeometry args={[glassWidth, glassHeight]} />
        </mesh>
        <mesh ref={sheenMeshRef} position={[0, 0, 1.01]}>
          <planeGeometry args={[glassWidth, glassHeight]} />
        </mesh>
      </group>

      {/* Threshold sits above the video's 1.0 ceiling so only the HDR wordmark blooms, not the footage. */}
      {/* Two bloom passes: a tighter near-field glow plus a very faint, wide tail so the falloff to
          black is imperceptible instead of hitting mipmapBlur's finite mip-chain radius as a hard edge. */}
      <EffectComposer ref={composerRef} frameBufferType={THREE.HalfFloatType}>
        <Bloom
          ref={bloomRef}
          mipmapBlur
          luminanceThreshold={1.02}
          luminanceSmoothing={0.3}
          intensity={0.3}
          levels={7}
          radius={0.75}
        />
        <Bloom
          ref={wideBloomRef}
          mipmapBlur
          luminanceThreshold={1.02}
          luminanceSmoothing={0.3}
          intensity={0.06}
          levels={11}
          radius={1.0}
        />
      </EffectComposer>
    </>
  );
}

function ContactLinks({
  geometryRef,
  animated,
}: {
  geometryRef: React.RefObject<WordmarkGeometry>;
  animated: boolean;
}) {
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const links = ref.current;
    if (!links) return;

    if (!animated) {
      links.style.opacity = "1";
      links.style.pointerEvents = "auto";
      return;
    }

    let frame = 0;
    const render = () => {
      frame = 0;
      const motion = currentMotion(geometryRef);
      links.style.opacity = motion.contactProgress.toFixed(3);
      links.style.pointerEvents = motion.contactProgress > 0.5 ? "auto" : "none";
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(render);
    };

    render();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [animated, geometryRef]);

  return (
    <ul
      ref={ref}
      className="pointer-events-none fixed inset-x-0 bottom-[12vh] z-20 m-0 flex list-none flex-col items-center gap-2 p-0 text-center text-[clamp(14px,1.4vw,20px)] uppercase text-white opacity-0"
    >
      <li>
        <a className="underline-offset-4 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
      </li>
      <li>
        <a
          className="underline-offset-4 hover:underline"
          href={CONTACT_INSTAGRAM}
          target="_blank"
          rel="noreferrer noopener"
        >
          @bur1alrites
        </a>
      </li>
    </ul>
  );
}

function StaticWordmark() {
  return (
    <div className="pointer-events-none fixed inset-x-2 top-1/2 z-10 -translate-y-1/2 text-center font-[AIx_Darbotzcumi] text-[clamp(48px,8vw,260px)] leading-[0.85] uppercase text-white mix-blend-difference">
      {WORDMARK}
    </div>
  );
}

type HeroSceneProps = {
  manifestUrl: string;
};

export function HeroScene({ manifestUrl }: HeroSceneProps) {
  const geometryRef = useWordmarkGeometry();
  const enabled = useRenderingEnabled();
  const reduced = useReducedMotion();

  return (
    <>
      {/* The visual glyph renders on canvas; this keeps the heading in the accessibility tree. */}
      <h1 className="sr-only">{WORDMARK}</h1>

      {enabled ? (
        <Canvas
          className="pointer-events-none z-10"
          style={{ position: "fixed", inset: 0 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          camera={{ position: [0, 0, CAMERA_DISTANCE], fov: 50, near: 10, far: CAMERA_DISTANCE - VIDEO_DEPTH + 1000 }}
          aria-hidden="true"
        >
          <SceneRig />
          <HeroVideoPlane manifestUrl={manifestUrl} geometryRef={geometryRef} />
          <Suspense fallback={null}>
            <WordmarkGlyphs geometryRef={geometryRef} />
          </Suspense>
        </Canvas>
      ) : (
        <StaticWordmark />
      )}

      <ContactLinks geometryRef={geometryRef} animated={enabled && !reduced} />
    </>
  );
}
