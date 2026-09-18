"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Text, useTexture } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { EffectPass, type BloomEffect, type EffectComposer as EffectComposerImpl } from "postprocessing";
import * as THREE from "three";

import { measureSections, observedSections } from "./hero-wordmark-motion";
import { MirrorFloor, RoomShell, SCREEN_DISPLACEMENT, ScreenPanel } from "./room";
import {
  FLOOR_Y,
  HERO_ASPECT,
  HERO_EYE_Y,
  LOGO_ASPECT,
  SCREEN_Z,
  getHeroCameraDistanceScale,
  getHeroScreenLayout,
  getScreenLayout,
  getScrollRise,
  screenFitDistance,
} from "./scene-layout";
import { useRenderingEnabled, usePointerPosition } from "./scene-utils";

const WORDMARK = "bur1alrites";
const WORDMARK_FONT = "/fonts/AIxDB-CUMI.TTF";
// Color channels above 1 stay HDR-bright (toneMapped=false) so Bloom's luminance threshold reads the text as emissive.
const BASE_EMISSIVE = 1.4;
const MAX_EMISSIVE = 3.2;
// Sits on the screen's centre line, so it starts level with the camera's opening eye height.
const WORDMARK_Y = getHeroScreenLayout().centerY;
// Rides just clear of the screen's brightest displacement so the video never pierces the glyphs.
const WORDMARK_Z = SCREEN_Z + SCREEN_DISPLACEMENT + 0.2;
const WORDMARK_SIZE = 1.6;
// Thin extruded body: a handful of stacked glyph copies read as solid sides once the camera is off-axis.
const EXTRUDE_LAYERS = 8;
const EXTRUDE_STEP = 0.015;
const HERO_FOV = 50;
const PARALLAX_STRENGTH = 2.4;
const PARALLAX_EASE = 0.06;
// Vertical drift is damped so the pointer never fights the scroll-driven rise.
const PARALLAX_VERTICAL = 0.3;
// Far enough to clear the top of frame at the wordmark's depth.
const WORDMARK_RISE = 20;
// Preserve the artwork's previous visible size after trimming the source from 1070px to 1008px.
const LOGO_HEIGHT = 5 * (1008 / 1070);
const LOGO_Z = SCREEN_Z + 8;
const LOGO_Y = FLOOR_Y + LOGO_HEIGHT / 2;
// Where the camera settles once the contact section is fully in view.
const CONTACT_EYE_Y = 1.5;
const DISPLACEMENT_START = 1.0;
const DISPLACEMENT_FINISH = 4.0;
const DISPLACEMENT_END_OF_SCROLL = 6.0;

// troika-three-text extends THREE.Mesh with this reactive glyph property.
type TroikaTextMesh = THREE.Mesh & {
  fillOpacity: number;
};

type WordmarkGeometry = { galleryTop: number; contactTop: number };

// Reads live DOM geometry so the descent stays in sync with the gallery/contact sections without prop drilling.
function useWordmarkGeometry() {
  const geometryRef = useRef<WordmarkGeometry>({ galleryTop: 1, contactTop: Number.POSITIVE_INFINITY });

  useEffect(() => {
    const measure = () => {
      geometryRef.current = measureSections();
    };

    measure();
    const resizeObserver = new ResizeObserver(measure);
    observedSections().forEach((node) => resizeObserver.observe(node));
    window.addEventListener("resize", measure, { passive: true });

    return () => {
      window.removeEventListener("resize", measure);
      resizeObserver.disconnect();
    };
  }, []);

  return geometryRef;
}

function currentRise(geometryRef: React.RefObject<WordmarkGeometry>) {
  const { galleryTop } = geometryRef.current;
  const scrollY = window.scrollY;
  const rise = getScrollRise(scrollY, geometryRef.current, window.innerHeight);
  const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, galleryTop + 1);
  const scrollEndProgress = THREE.MathUtils.clamp(
    (scrollY - galleryTop) / Math.max(maxScroll - galleryTop, 1),
    0,
    1,
  );
  Object.assign(window as unknown as Record<string, unknown>, {
    __rise: { ...rise, scrollEndProgress, geom: geometryRef.current, scrollY },
  });
  return { ...rise, scrollEndProgress };
}

// The camera holds still at the screen's centre, then drops and tilts down onto the statue at the end.
function HeroRig({
  geometryRef,
  displacementProgressRef,
}: {
  geometryRef: React.RefObject<WordmarkGeometry>;
  displacementProgressRef: React.RefObject<number>;
}) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const pointer = usePointerPosition();
  const target = useMemo(() => new THREE.Vector3(), []);
  const lookAt = useMemo(() => new THREE.Vector3(), []);
  // Framing distance comes from the un-scaled screen so the oversized one fills more of the frame.
  const fitLayout = useMemo(() => getScreenLayout(HERO_ASPECT), []);
  // Like the photo-view camera, derive the framing position from the live canvas dimensions.
  // Narrow viewports move the camera closer so the entire scene keeps its intended visual scale.
  const distance = useMemo(() => {
    const canvasAspect = size.width / Math.max(size.height, 1);
    return (
      screenFitDistance(HERO_FOV, canvasAspect, fitLayout) *
      getHeroCameraDistanceScale(size.width)
    );
  }, [fitLayout, size.width, size.height]);

  useEffect(() => {
    // r3f's documented pattern: mutate the camera in an effect when the viewport changes.
    /* eslint-disable-next-line react-hooks/immutability */
    camera.aspect = size.width / Math.max(size.height, 1);
    camera.updateProjectionMatrix();
  }, [camera, size]);

  useFrame(() => {
    const { galleryProgress, contactProgress, scrollEndProgress } = currentRise(geometryRef);
    const galleryDisplacement = THREE.MathUtils.lerp(
      DISPLACEMENT_START,
      DISPLACEMENT_FINISH,
      galleryProgress,
    );
    const scrollEndEase = 1 - (1 - scrollEndProgress) ** 3;
    displacementProgressRef.current = THREE.MathUtils.lerp(
      galleryDisplacement,
      DISPLACEMENT_END_OF_SCROLL,
      scrollEndEase,
    );
    const eyeY = HERO_EYE_Y + (CONTACT_EYE_Y - HERO_EYE_Y) * contactProgress;

    target.set(
      -pointer.x * PARALLAX_STRENGTH,
      eyeY + pointer.y * PARALLAX_STRENGTH * PARALLAX_VERTICAL,
      SCREEN_Z + distance,
    );
    // r3f's documented pattern: mutate three.js objects (here, the camera) in useFrame instead of setState.
    camera.position.lerp(target, PARALLAX_EASE);
    // Gaze swings off the screen and onto the statue, which is what pitches the camera down.
    lookAt.set(
      0,
      camera.position.y + (LOGO_Y - camera.position.y) * contactProgress,
      SCREEN_Z + (LOGO_Z - SCREEN_Z) * contactProgress,
    );
    camera.lookAt(lookAt);
  });

  return null;
}

// Sits on the mirror floor; the camera's end-of-scroll tilt is what brings it into frame.
function FloorLogo() {
  const logoTexture = useTexture("/assets/logo.png");

  return (
    <mesh position={[0, LOGO_Y, LOGO_Z]}>
      <planeGeometry args={[LOGO_HEIGHT * LOGO_ASPECT, LOGO_HEIGHT]} />
      <meshBasicMaterial map={logoTexture} transparent toneMapped={false} />
    </mesh>
  );
}

function WordmarkGlyphs({ geometryRef }: { geometryRef: React.RefObject<WordmarkGeometry> }) {
  const textRef = useRef<TroikaTextMesh>(null);
  const wordmarkGroupRef = useRef<THREE.Group>(null);
  const sideGroupRef = useRef<THREE.Group>(null);
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

  useFrame(() => {
    const { galleryProgress } = currentRise(geometryRef);
    const group = wordmarkGroupRef.current;
    // Fades out as it clears the top of frame, so it never hangs over the gallery.
    const fade = 1 - galleryProgress;

    if (group) {
      // r3f's documented pattern: mutate three.js objects in useFrame instead of setState.
      /* eslint-disable-next-line react-hooks/immutability */
      group.position.y = WORDMARK_Y + WORDMARK_RISE * galleryProgress;
      /* eslint-disable-next-line react-hooks/immutability */
      group.visible = fade > 0.001;
    }

    const emissive = BASE_EMISSIVE + (MAX_EMISSIVE - BASE_EMISSIVE) * galleryProgress;
    textMaterial.color.setScalar(emissive * fade);

    const text = textRef.current;
    if (text) text.fillOpacity = fade;
    sideGroupRef.current?.children.forEach((child) => {
      (child as TroikaTextMesh).fillOpacity = fade;
    });

    if (bloomRef.current) {
      const intensity = 0.3 + galleryProgress * 1.4;
      bloomRef.current.intensity = intensity;
      // Faint wide tail stays proportional so it never out-glows the near-field bloom it's softening.
      if (wideBloomRef.current) wideBloomRef.current.intensity = intensity * 0.2;
    }
  });

  return (
    <>
      <group ref={wordmarkGroupRef} position={[0, WORDMARK_Y, WORDMARK_Z]}>
        <Text
          ref={textRef}
          font={WORDMARK_FONT}
          fontSize={WORDMARK_SIZE}
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
              fontSize={WORDMARK_SIZE}
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
  const displacementProgressRef = useRef(DISPLACEMENT_START);
  const enabled = useRenderingEnabled();
  const screenLayout = useMemo(() => getHeroScreenLayout(), []);

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
          camera={{ position: [0, 0, SCREEN_Z + 30], fov: HERO_FOV, near: 0.1, far: 400 }}
          aria-hidden="true"
        >
          <HeroRig
            geometryRef={geometryRef}
            displacementProgressRef={displacementProgressRef}
          />
          <MirrorFloor />
          <RoomShell />
          <ScreenPanel
            manifestUrl={manifestUrl}
            layout={screenLayout}
            displaced
            displacementProgressRef={displacementProgressRef}
          />
          <Suspense fallback={null}>
            <FloorLogo />
          </Suspense>
          <WordmarkGlyphs geometryRef={geometryRef} />
        </Canvas>
      ) : (
        <StaticWordmark />
      )}
    </>
  );
}
