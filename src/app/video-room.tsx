"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { EffectPass, type EffectComposer as EffectComposerImpl } from "postprocessing";
import * as THREE from "three";

import type { GallerySceneItem } from "./gallery-three";
import { createRoomSession, type RoomSession } from "./room-session";

import {
  setVideoRoomOpen,
  useMobileView,
  usePointerPosition,
  useRenderingEnabled,
} from "./scene-utils";
import { useSceneFrameRecorder, useSceneQuality } from "./scene-quality";
import { MirrorFloor, RoomShell, ScreenPanel } from "./room";
import {
  MOBILE_FOV_INCREASE,
  SCREEN_Z,
  getScreenLayout,
  type ScreenLayout,
} from "./scene-layout";

export const OPEN_ROOM_EVENT = "portfolio:open-room";

export type RoomVideo = {
  manifestUrl: string;
  posterUrl: string;
  label: string;
  width: number;
  height: number;
};

export function openVideoRoom(detail: RoomVideo) {
  window.dispatchEvent(new CustomEvent<RoomVideo>(OPEN_ROOM_EVENT, { detail }));
}

// Headroom left around the screen so pointer drift never pushes an edge out of frame.
const FIT_MARGIN = 1.2;
const CAMERA_Z = 6;
const ROOM_FOV = 38;
const PARALLAX_STRENGTH = 2.4;
const PARALLAX_EASE = 0.06;
// Duration of the fade-to-black crossfade when opening/closing the room, in ms - must match the
// transition-duration class applied to the dialog below.
const FADE_MS = 500;
// Eases the camera back to the parallax orientation after escaping walk mode; faster than PARALLAX_EASE so it settles quickly without snapping.
const RECENTER_EASE = 0.12;
const RECENTER_DONE_ANGLE = 0.002;

function RoomRig({
  layout,
  pointerParallax,
  sessionRef,
}: {
  layout: ScreenLayout;
  pointerParallax: boolean;
  sessionRef: React.RefObject<RoomSession | null>;
}) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const domElement = useThree((state) => state.gl.domElement);
  const pointer = usePointerPosition(pointerParallax);
  const target = useMemo(() => new THREE.Vector3(), []);
  const lookAt = useMemo(() => new THREE.Vector3(), []);
  // Must be a camera: Object3D.lookAt aims +Z at the target, cameras look down -Z. Only used while recentering.
  const framer = useMemo(() => new THREE.Camera(), []);

  useEffect(() => {
    if (pointerParallax) return sessionRef.current?.bind(domElement, camera);
  }, [sessionRef, domElement, camera, pointerParallax]);

  // Pull back far enough that the whole screen fits whichever axis is the tighter constraint.
  const distance = useMemo(() => {
    const halfFov = (camera.fov * Math.PI) / 360;
    const canvasAspect = size.width / Math.max(size.height, 1);
    const byHeight = layout.height / 2 / Math.tan(halfFov);
    const byWidth = layout.width / 2 / (Math.tan(halfFov) * canvasAspect);
    return Math.max(byHeight, byWidth) * FIT_MARGIN;
  }, [camera.fov, size.width, size.height, layout.width, layout.height]);

  useFrame((_, delta) => {
    const session = sessionRef.current;
    if (!session) return;
    const { look: lookState } = session;
    // r3f's documented pattern: mutate three.js objects in useFrame instead of setState.
    if (session.walk(camera, delta)) return;

    // Camera drifts opposite the pointer and re-aims every frame off the eased position,
    // same as the hero scene, so rotation never lags behind the drift with a second ease.
    target.set(
      -(pointerParallax ? pointer.x : 0) * PARALLAX_STRENGTH,
      layout.centerY + (pointerParallax ? pointer.y : 0) * PARALLAX_STRENGTH,
      SCREEN_Z + distance,
    );
    lookAt.set(0, layout.centerY, SCREEN_Z);
    camera.position.lerp(target, PARALLAX_EASE);

    if (lookState.recentering) {
      // Slerp back to the parallax orientation after escaping walk mode, then hand off to instant lookAt.
      framer.position.copy(camera.position);
      framer.lookAt(lookAt);
      camera.quaternion.slerp(framer.quaternion, RECENTER_EASE);
      if (camera.quaternion.angleTo(framer.quaternion) < RECENTER_DONE_ANGLE) {
        session.finishRecentering();
      }
    } else {
      camera.lookAt(lookAt);
    }
  });

  return null;
}

function RoomScene({
  sessionRef,
  video,
  mirrorResolutionScale,
  wideBloomLevels,
  lightSampleInterval,
  preferNativeHls,
  recordFrameSample,
  isMobile,
}: {
  sessionRef: React.RefObject<RoomSession | null>;
  video: RoomVideo;
  mirrorResolutionScale: number;
  wideBloomLevels: number | null;
  lightSampleInterval: number | null;
  preferNativeHls: boolean;
  recordFrameSample: (deltaMs: number, source: "video-room") => void;
  isMobile: boolean;
}) {
  const layout = useMemo(
    () => getScreenLayout(video.width / Math.max(video.height, 1)),
    [video.width, video.height],
  );
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

  useFrame((_, delta) => {
    recordFrameSample(delta * 1000, "video-room");
  });

  return (
    <>
      <RoomRig sessionRef={sessionRef} layout={layout} pointerParallax={!isMobile} />
      <MirrorFloor resolutionScale={mirrorResolutionScale} />
      <RoomShell />
      <ScreenPanel
        manifestUrl={video.manifestUrl}
        layout={layout}
        lightSampleInterval={lightSampleInterval}
        preferNativeHls={preferNativeHls}
        telemetrySource="video-room"
      />
      {/* Two bloom passes: a tighter near-field glow plus a very faint, wide tail so the falloff to
          black is imperceptible instead of hitting mipmapBlur's finite mip-chain radius as a hard edge. */}
      <EffectComposer ref={composerRef} frameBufferType={THREE.HalfFloatType}>
        <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.5} intensity={0.4} levels={8} radius={0.75} />
        {wideBloomLevels !== null ? (
          <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.5} intensity={0.08} levels={wideBloomLevels} radius={1.0} />
        ) : null}
      </EffectComposer>
    </>
  );
}

export function VideoRoom({
  preferNativeHls,
  isMobile,
  items,
}: {
  preferNativeHls: boolean;
  isMobile: boolean;
  items: GallerySceneItem[];
}) {
  const [video, setVideo] = useState<RoomVideo | null>(null);
  // Drives the crossfade: false both before entering and while leaving, true once faded in.
  const [visible, setVisible] = useState(false);
  const [walking, setWalking] = useState(false);
  const enabled = useRenderingEnabled();
  const mobileView = useMobileView(isMobile);
  const quality = useSceneQuality();
  const recordFrameSample = useSceneFrameRecorder();
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<RoomSession | null>(null);
  if (sessionRef.current === null) sessionRef.current = createRoomSession(setVideoRoomOpen);

  const close = useCallback(() => {
    setVisible(false);
    // Keep the room mounted until the fade-out finishes instead of cutting it out instantly.
    closeTimeoutRef.current = setTimeout(() => setVideo(null), FADE_MS);
  }, []);

  useEffect(() => sessionRef.current?.connect({ window, document }, setWalking), []);

  useEffect(() => {
    if (mobileView || !enabled) sessionRef.current?.releaseControls();
  }, [mobileView, enabled]);

  // The hero scene sits fully behind this dialog once it's open, so pause its render loop too.
  useEffect(() => {
    const session = sessionRef.current;
    if (video) session?.open();
    return () => session?.close();
  }, [video]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      // Reset here (a normal event handler) rather than in the effect below, which only flips it on.
      setVisible(false);
      setVideo((event as CustomEvent<RoomVideo>).detail);
    };
    window.addEventListener(OPEN_ROOM_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ROOM_EVENT, onOpen);
  }, []);

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("video");
    const item = items.find((entry) => entry.slug === slug && entry.manifestUrl);
    if (!item?.manifestUrl) return;

    openVideoRoom({
      manifestUrl: item.manifestUrl,
      posterUrl: item.previewUrl,
      label: `${item.title}, ${item.client}, ${item.type}, ${item.year}`,
      width: item.width,
      height: item.height,
    });
  }, [items]);

  useEffect(() => {
    if (!video) return;
    // Flip to visible next frame so the opacity transition actually runs instead of snapping in.
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [video]);

  useEffect(() => {
    const session = sessionRef.current;
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
      session?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!video) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // While the cursor is captured, Escape releases it instead of closing the room.
      if (event.key === "Escape" && !document.pointerLockElement) close();
    };
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousScrollY = window.scrollY;
    root.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();

    return () => {
      root.style.overflow = previousOverflow;
      window.scrollTo(0, previousScrollY);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [video, close]);

  if (!video) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={video.label}
      className={`video-room-viewport fixed inset-0 z-50 bg-black transition-opacity duration-500 ease-in-out ${visible ? "opacity-100" : "opacity-0"}`}
    >
      {enabled ? (
        <Canvas
          style={{ position: "absolute", inset: 0, cursor: walking ? "none" : "pointer" }}
          dpr={quality.dpr}
          // MSAA and precision are fixed at context creation; mobile gets the cheaper context.
          gl={{
            antialias: !mobileView,
            powerPreference: "high-performance",
            precision: mobileView ? "mediump" : "highp",
          }}
          camera={{
            position: [0, 0, CAMERA_Z],
            fov: ROOM_FOV + (mobileView ? MOBILE_FOV_INCREASE : 0),
            near: 0.1,
            far: 200,
          }}
          aria-hidden="true"
        >
          <RoomScene
            sessionRef={sessionRef}
            video={video}
            mirrorResolutionScale={quality.mirrorResolutionScale}
            wideBloomLevels={quality.wideBloomLevels}
            lightSampleInterval={quality.lightSampleInterval}
            preferNativeHls={preferNativeHls}
            recordFrameSample={recordFrameSample}
            isMobile={mobileView}
          />
        </Canvas>
      ) : (
        <video
          src={video.manifestUrl}
          poster={video.posterUrl}
          controls
          autoPlay
          loop
          playsInline
          aria-label={video.label}
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}

      <button
        ref={closeRef}
        type="button"
        onClick={close}
        className={`absolute right-5 top-5 z-10 rounded-none border-0 bg-transparent px-4 py-2 text-[13px] uppercase tracking-wide text-white underline-offset-4 transition-opacity duration-300 hover:underline focus:outline-none focus-visible:underline ${walking ? "pointer-events-none opacity-0" : "opacity-100"}`}
      >
        Close
      </button>

      <p
        className={`pointer-events-none absolute inset-x-0 bottom-6 z-10 text-center text-[13px] uppercase text-white/70 transition-opacity duration-300 ${walking ? "opacity-0" : "opacity-100"}`}
      >
        {video.label}
      </p>

      {enabled && !mobileView ? (
        <p
          className={`pointer-events-none absolute inset-x-0 top-6 z-10 text-center text-[11px] uppercase tracking-wide text-white/40 transition-opacity duration-300 ${walking ? "opacity-0" : "opacity-100"}`}
        >
          Click to look around &middot; WASD to move &middot; Esc to release
        </p>
      ) : null}
    </div>
  );
}
