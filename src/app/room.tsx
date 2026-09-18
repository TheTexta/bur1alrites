"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";

import { attachHlsStream } from "@/lib/hls-stream";
import {
  registerSceneVideoTelemetry,
  type ScenePerformanceSource,
} from "./scene-quality";
import { GRAIN_STRENGTH } from "./scene-utils";
import { CEILING_Y, FLOOR_SIZE, FLOOR_Y, SCREEN_Z, type ScreenLayout } from "./scene-layout";

// Required once before any RectAreaLight can shade correctly.
RectAreaLightUniformsLib.init();

// Tints the mirrored render, keeping the reflection darker than the screen itself.
const FLOOR_TINT = 0x4c5a5e;
// Dark and rough so the screen's RectAreaLight reads as the only real light source in the room.
const WALL_COLOR = 0x141414;
const SCREEN_LIGHT_INTENSITY = 26;
// Dark footage still throws some light, so the room never goes fully black.
const SCREEN_LIGHT_FLOOR = 0.02;
// The video is downscaled before reading pixels back to the CPU for the screen light.
const SAMPLE_SIZE = 8;
const LIGHT_EASE = 0.15;
// Additive highlight boost: scales with color^HIGHLIGHT_POWER, so near-black pixels get
// almost nothing added while bright pixels get pushed past Bloom's threshold.
const HIGHLIGHT_GAIN = 2.5;
const HIGHLIGHT_POWER = 3.0;
// Grain is zero-mean, but negative offsets clip at black while positive ones don't - net lifting
// shadows. This curve darkens back down below SHADOW_KNEE only, leaving highlights/bloom alone.
const SHADOW_KNEE = 0.10;
const SHADOW_DARKEN = 0.015;
// Enough tessellation for the luminance displacement to read as relief rather than facets.
const SCREEN_SEGMENTS = 180;
export const SCREEN_DISPLACEMENT = 1.6;
// Tap radius in UV units; smooths the relief so fine video detail and grain stop rippling the mesh.
const SCREEN_DISPLACEMENT_BLUR = 0.02;
// Cursor pressure is a soft radial multiplier over the luminance displacement.
const POINTER_DISPLACEMENT_RADIUS = 0.5;
const POINTER_DISPLACEMENT_STRENGTH = 0.9;
const POINTER_DISPLACEMENT_EASE = 14;
// A click emits one expanding ring from the pointer's position on the video plane.
const SPLASH_DISPLACEMENT_RADIUS = 5.0;
const SPLASH_DISPLACEMENT_WIDTH = 0.08;
const SPLASH_DISPLACEMENT_STRENGTH = 2.2;
const SPLASH_DURATION = 1.3;

export function MirrorFloor({ resolutionScale = 1 }: { resolutionScale?: number }) {
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  const reflector = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE);
    const mirror = new Reflector(geometry, {
      clipBias: 0.003,
      textureWidth: size.width * dpr * resolutionScale,
      textureHeight: size.height * dpr * resolutionScale,
      color: FLOOR_TINT,
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = FLOOR_Y;
    return mirror;
  }, [size.width, size.height, dpr, resolutionScale]);

  useEffect(
    () => () => {
      reflector.geometry.dispose();
      reflector.dispose();
    },
    [reflector],
  );

  return <primitive object={reflector} />;
}

export function RoomShell() {
  const roomHalf = FLOOR_SIZE / 2;
  const wallHeight = CEILING_Y - FLOOR_Y;
  const wallCenterY = FLOOR_Y + wallHeight / 2;

  return (
    <group>
      {/* Normal faces down, into the room. */}
      <mesh position={[0, CEILING_Y, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={1} metalness={0} />
      </mesh>
      {/* Back wall behind the screen; default plane normal (+Z) already faces into the room. */}
      <mesh position={[0, wallCenterY, -roomHalf]}>
        <planeGeometry args={[FLOOR_SIZE, wallHeight]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={1} metalness={0} />
      </mesh>
      <mesh position={[-roomHalf, wallCenterY, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[FLOOR_SIZE, wallHeight]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={1} metalness={0} />
      </mesh>
      <mesh position={[roomHalf, wallCenterY, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[FLOOR_SIZE, wallHeight]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}

export function ScreenPanel({
  manifestUrl,
  layout,
  displaced = false,
  displacementProgressRef,
  playing,
  segments = SCREEN_SEGMENTS,
  displacementDirections = 8,
  lightSampleInterval = 4,
  preferNativeHls = false,
  telemetrySource,
}: {
  manifestUrl: string;
  layout: ScreenLayout;
  displaced?: boolean;
  displacementProgressRef?: React.RefObject<number>;
  playing?: boolean;
  segments?: number;
  displacementDirections?: number;
  lightSampleInterval?: number | null;
  preferNativeHls?: boolean;
  telemetrySource?: ScenePerformanceSource;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const textureRef = useRef<THREE.VideoTexture | null>(null);
  const lightRef = useRef<THREE.RectAreaLight>(null);
  const samplerRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameRef = useRef(0);
  const shouldPlayRef = useRef(playing ?? true);
  const pointerActiveRef = useRef(false);
  const pointerNdcRef = useRef(new THREE.Vector2());
  const pendingSplashNdcRef = useRef<THREE.Vector2 | null>(null);
  const splashStartedAtRef = useRef(-1);
  const sampledColor = useMemo(() => new THREE.Color(1, 1, 1), []);
  const grainShaderRef = useRef<THREE.WebGLProgramParametersWithUniforms | null>(null);
  const camera = useThree((state) => state.camera);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const interactionPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 0, 1), -SCREEN_Z),
    [],
  );
  const interactionPoint = useMemo(() => new THREE.Vector3(), []);
  const pointerUv = useMemo(() => new THREE.Vector2(), []);
  const splashUv = useMemo(() => new THREE.Vector2(), []);

  useEffect(() => {
    shouldPlayRef.current = playing ?? true;
    const video = videoRef.current;
    if (!video) return;
    if (shouldPlayRef.current) void video.play().catch(() => {});
    else video.pause();
  }, [playing]);

  useEffect(() => {
    if (!displaced) return;

    const setPointer = (event: PointerEvent) => {
      pointerNdcRef.current.set(
        (event.clientX / Math.max(window.innerWidth, 1)) * 2 - 1,
        1 - (event.clientY / Math.max(window.innerHeight, 1)) * 2,
      );
      pointerActiveRef.current = true;
    };
    const onPointerMove = (event: PointerEvent) => setPointer(event);
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      setPointer(event);
      pendingSplashNdcRef.current = pointerNdcRef.current.clone();
    };
    const deactivatePointer = () => {
      pointerActiveRef.current = false;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerleave", deactivatePointer);
    window.addEventListener("blur", deactivatePointer);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerleave", deactivatePointer);
      window.removeEventListener("blur", deactivatePointer);
      pointerActiveRef.current = false;
      pendingSplashNdcRef.current = null;
      splashStartedAtRef.current = -1;
    };
  }, [displaced]);

  useEffect(() => {
    // Rect area lights are unlit until their LTC lookup textures are loaded.
    RectAreaLightUniformsLib.init();

    if (lightSampleInterval === null) {
      samplerRef.current = null;
      const light = lightRef.current;
      if (light) {
        light.color.set(0xffffff);
        light.intensity = SCREEN_LIGHT_FLOOR * SCREEN_LIGHT_INTENSITY;
      }
      return;
    }

    const sampler = document.createElement("canvas");
    sampler.width = SAMPLE_SIZE;
    sampler.height = SAMPLE_SIZE;
    samplerRef.current = sampler.getContext("2d", { willReadFrequently: true });

    return () => {
      samplerRef.current = null;
    };
  }, [lightSampleInterval]);

  // Owns the <video>/HLS lifecycle only, so quality changes that only affect the shader
  // (displacementDirections) never tear down and restart the stream.
  useEffect(() => {
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    videoRef.current = video;
    const unregisterTelemetry = telemetrySource
      ? registerSceneVideoTelemetry(telemetrySource, video)
      : () => {};

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    textureRef.current = texture;

    let controller: Awaited<ReturnType<typeof attachHlsStream>> | null = null;
    let cancelled = false;

    void attachHlsStream(video, manifestUrl, {
      startLevel: 0,
      preferNative: preferNativeHls,
    })
      .then((nextController) => {
        if (cancelled) {
          nextController.destroy();
          return;
        }
        controller = nextController;
        if (shouldPlayRef.current) void video.play().catch(() => {});
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unregisterTelemetry();
      controller?.destroy();
      texture.dispose();
      textureRef.current = null;
      videoRef.current = null;
    };
  }, [manifestUrl, preferNativeHls, telemetrySource]);

  useEffect(() => {
    const mesh = meshRef.current;
    const texture = textureRef.current;
    if (!mesh || !texture) return;

    // Built-in material so three handles the texture's colour space for the composer.
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      toneMapped: false,
      // Harmless fallback for the (non-post-processed) direct render path; see EffectPass.dithering above for the real fix.
      dithering: true,
    });
    // Highlight-only boost so shadows stay put while bright areas clear the Bloom threshold,
    // plus animated grain to mask compression artifacts and sell the projector feel.
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      if (displaced) {
        shader.uniforms.uDisplacementProgress = {
          value: displacementProgressRef?.current ?? 1,
        };
        shader.uniforms.uPointerUv = { value: new THREE.Vector2(0.5, 0.5) };
        shader.uniforms.uPointerStrength = { value: 0 };
        shader.uniforms.uSplashUv = { value: new THREE.Vector2(0.5, 0.5) };
        shader.uniforms.uSplashProgress = { value: 1 };
        shader.uniforms.uScreenAspect = { value: layout.width / Math.max(layout.height, 0.0001) };
        // The fragment stage's `map` sampler isn't visible to the vertex shader, so bind the
        // texture again under a name the displacement can read.
        shader.uniforms.uDisplaceMap = { value: texture };
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            `#include <common>
            uniform sampler2D uDisplaceMap;
            uniform float uDisplacementProgress;
            uniform vec2 uPointerUv;
            uniform float uPointerStrength;
            uniform vec2 uSplashUv;
            uniform float uSplashProgress;
            uniform float uScreenAspect;

            float screenLuminance(vec2 p) {
              // The sampled texel is sRGB-encoded; without linearising, mid-tones read far brighter than they are.
              vec3 linear = pow(texture2D(uDisplaceMap, clamp(p, 0.0, 1.0)).rgb, vec3(2.2));
              return dot(linear, vec3(0.2126, 0.7152, 0.0722));
            }

            // Vertex texture fetch always reads mip 0, so the blur has to be an explicit tap kernel.
            // Ring weight is fixed at 0.8 total (split 60/40 near/far) regardless of tap count, so
            // lower-quality presets with fewer directions still normalize to the same brightness.
            float blurredLuminance(vec2 p) {
              ${displacementDirections > 0
                ? `float total = screenLuminance(p) * 0.2;
              for (int i = 0; i < ${displacementDirections}; i++) {
                float angle = float(i) * ${((2 * Math.PI) / displacementDirections).toFixed(6)};
                vec2 direction = vec2(cos(angle), sin(angle));
                total += screenLuminance(p + direction * ${SCREEN_DISPLACEMENT_BLUR.toFixed(3)} * 0.5) * ${((0.8 / displacementDirections) * 0.6).toFixed(4)};
                total += screenLuminance(p + direction * ${SCREEN_DISPLACEMENT_BLUR.toFixed(3)}) * ${((0.8 / displacementDirections) * 0.4).toFixed(4)};
              }
              return total;`
                : `return screenLuminance(p);`}
            }

            float screenDistance(vec2 a, vec2 b) {
              vec2 delta = a - b;
              delta.x *= uScreenAspect;
              return length(delta);
            }`,
          )
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
            // Black anchors the panel and only highlights lift, so dark areas keep their flat footprint.
            float pointerDistance = screenDistance(uv, uPointerUv);
            float pointerPressure = 1.0 - smoothstep(
              ${(POINTER_DISPLACEMENT_RADIUS * 0.2).toFixed(3)},
              ${POINTER_DISPLACEMENT_RADIUS.toFixed(3)},
              pointerDistance
            );

            float splashDistance = screenDistance(uv, uSplashUv);
            float splashRadius = uSplashProgress * ${SPLASH_DISPLACEMENT_RADIUS.toFixed(3)};
            float splashRing = 1.0 - smoothstep(
              ${SPLASH_DISPLACEMENT_WIDTH.toFixed(3)},
              ${(SPLASH_DISPLACEMENT_WIDTH * 1.75).toFixed(3)},
              abs(splashDistance - splashRadius)
            );
            float splashEnvelope = pow(1.0 - uSplashProgress, 2.0);
            float interactionMultiplier = 1.0
              + pointerPressure * uPointerStrength * ${POINTER_DISPLACEMENT_STRENGTH.toFixed(2)}
              + splashRing * splashEnvelope * ${SPLASH_DISPLACEMENT_STRENGTH.toFixed(2)};

            transformed.z += blurredLuminance(uv)
              * ${SCREEN_DISPLACEMENT.toFixed(2)}
              * uDisplacementProgress
              * interactionMultiplier;`,
          );
      }
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform float uTime;
          float grainHash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453 + uTime);
          }`,
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          diffuseColor.rgb += pow(diffuseColor.rgb, vec3(${HIGHLIGHT_POWER.toFixed(1)})) * ${HIGHLIGHT_GAIN.toFixed(1)};
          diffuseColor.rgb += (grainHash(gl_FragCoord.xy) - 0.5) * ${GRAIN_STRENGTH.toFixed(3)};
          float shadowMask = 1.0 - smoothstep(0.0, ${SHADOW_KNEE.toFixed(2)}, dot(diffuseColor.rgb, vec3(0.333)));
          diffuseColor.rgb = max(diffuseColor.rgb - ${SHADOW_DARKEN.toFixed(3)} * shadowMask, 0.0);`,
        );
      grainShaderRef.current = shader;
    };
    mesh.material = material;

    return () => {
      (mesh.material as THREE.Material | undefined)?.dispose();
      grainShaderRef.current = null;
    };
  }, [manifestUrl, displaced, displacementProgressRef, layout.width, layout.height, displacementDirections]);

  useFrame((state, delta) => {
    const shader = grainShaderRef.current;
    if (shader) {
      shader.uniforms.uTime.value = state.clock.elapsedTime;
      if (displaced && shader.uniforms.uDisplacementProgress) {
        shader.uniforms.uDisplacementProgress.value = displacementProgressRef?.current ?? 1;

        const uvFromNdc = (ndc: THREE.Vector2, target: THREE.Vector2) => {
          raycaster.setFromCamera(ndc, camera);
          if (!raycaster.ray.intersectPlane(interactionPlane, interactionPoint)) return false;

          target.set(
            interactionPoint.x / layout.width + 0.5,
            (interactionPoint.y - layout.centerY) / layout.height + 0.5,
          );
          return target.x >= 0 && target.x <= 1 && target.y >= 0 && target.y <= 1;
        };

        const pointerOverScreen =
          pointerActiveRef.current && uvFromNdc(pointerNdcRef.current, pointerUv);
        if (pointerOverScreen) shader.uniforms.uPointerUv.value.copy(pointerUv);
        shader.uniforms.uPointerStrength.value = THREE.MathUtils.damp(
          shader.uniforms.uPointerStrength.value,
          pointerOverScreen ? 1 : 0,
          POINTER_DISPLACEMENT_EASE,
          delta,
        );

        const pendingSplash = pendingSplashNdcRef.current;
        if (pendingSplash) {
          if (uvFromNdc(pendingSplash, splashUv)) {
            shader.uniforms.uSplashUv.value.copy(splashUv);
            splashStartedAtRef.current = state.clock.elapsedTime;
          }
          pendingSplashNdcRef.current = null;
        }

        const splashStartedAt = splashStartedAtRef.current;
        const splashProgress = splashStartedAt < 0
          ? 1
          : THREE.MathUtils.clamp(
              (state.clock.elapsedTime - splashStartedAt) / SPLASH_DURATION,
              0,
              1,
            );
        shader.uniforms.uSplashProgress.value = splashProgress;
        if (splashProgress >= 1) splashStartedAtRef.current = -1;
      }
    }

    const element = videoRef.current;
    if (element) {
      if (shouldPlayRef.current && element.paused) void element.play().catch(() => {});
      else if (!shouldPlayRef.current && !element.paused) element.pause();
    }

    if (lightSampleInterval === null) return;
    frameRef.current += 1;
    if (frameRef.current % lightSampleInterval !== 0) return;

    const video = videoRef.current;
    const light = lightRef.current;
    const context = samplerRef.current;
    if (!video || !light || !context || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    let red = 0;
    let green = 0;
    let blue = 0;
    try {
      context.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
      for (let i = 0; i < pixels.length; i += 4) {
        // Linearise each sample so the average matches how the renderer treats light.
        red += (pixels[i] / 255) ** 2.2;
        green += (pixels[i + 1] / 255) ** 2.2;
        blue += (pixels[i + 2] / 255) ** 2.2;
      }
    } catch {
      // A tainted frame just leaves the previous lighting in place.
      return;
    }

    const count = SAMPLE_SIZE * SAMPLE_SIZE;
    red /= count;
    green /= count;
    blue /= count;

    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    // Linear means are tiny for dark footage; the perceptual curve keeps the spill visible.
    const brightness = SCREEN_LIGHT_FLOOR + luminance ** (1 / 2.2);
    // Normalise hue away from brightness so dim frames keep their colour instead of going black.
    const peak = Math.max(red, green, blue, 0.0001);
    sampledColor.setRGB(red / peak, green / peak, blue / peak);

    // r3f's documented pattern: mutate three.js objects in useFrame instead of setState.
    light.color.lerp(sampledColor, LIGHT_EASE);
    light.intensity = THREE.MathUtils.lerp(light.intensity, brightness * SCREEN_LIGHT_INTENSITY, LIGHT_EASE);
  });

  return (
    <group position={[0, layout.centerY, SCREEN_Z]}>
      <mesh ref={meshRef}>
        <planeGeometry
          args={
            displaced
              ? [layout.width, layout.height, segments, segments]
              : [layout.width, layout.height]
          }
        />
      </mesh>
      {/* The screen is the only light source; rotated so the panel emits toward the camera. */}
      <rectAreaLight
        ref={lightRef}
        args={[
          0xffffff,
          lightSampleInterval === null ? SCREEN_LIGHT_FLOOR * SCREEN_LIGHT_INTENSITY : 0,
          layout.width,
          layout.height,
        ]}
        rotation={[0, Math.PI, 0]}
      />
    </group>
  );
}
