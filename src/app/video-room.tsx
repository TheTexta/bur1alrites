"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { EffectPass, type EffectComposer as EffectComposerImpl } from "postprocessing";
import * as THREE from "three";

import { setVideoRoomOpen, usePointerPosition, useRenderingEnabled } from "./scene-utils";
import { useSceneQuality } from "./scene-quality";
import { MirrorFloor, RoomShell, ScreenPanel } from "./room";
import { FLOOR_SIZE, FLOOR_Y, SCREEN_Z, getScreenLayout, type ScreenLayout } from "./scene-layout";

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
const PARALLAX_STRENGTH = 2.4;
const PARALLAX_EASE = 0.06;
// Duration of the fade-to-black crossfade when opening/closing the room, in ms - must match the
// transition-duration class applied to the dialog below.
const FADE_MS = 500;
const LOOK_SENSITIVITY = 0.0022;
const MAX_PITCH = 1.4;
const WALK_EYE_HEIGHT = 5;
const WALK_SPEED = 16;
// Keeps the walker from passing through the screen or wandering off the mirror.
const MIN_SCREEN_DISTANCE = 1;
const MAX_SCREEN_DISTANCE = 72;
const WALK_BOUND_X = FLOOR_SIZE / 2 - 14;
const WALK_KEYS: Record<string, "forward" | "back" | "left" | "right"> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};

// Module-level so the key state survives any remount of the rig mid-walk.
const walkState = { forward: false, back: false, left: false, right: false };
const lookState = { yaw: 0, pitch: 0, locked: false, recentering: false };
const walkPosition = new THREE.Vector3();
// Eases the camera back to the parallax orientation after escaping walk mode; faster than PARALLAX_EASE so it settles quickly without snapping.
const RECENTER_EASE = 0.12;
const RECENTER_DONE_ANGLE = 0.002;

function useWalkKeys() {
  useEffect(() => {
    const setKey = (code: string, pressed: boolean) => {
      const action = WALK_KEYS[code];
      if (action) walkState[action] = pressed;
    };
    const onDown = (event: KeyboardEvent) => setKey(event.code, true);
    const onUp = (event: KeyboardEvent) => setKey(event.code, false);
    const reset = () => {
      walkState.forward = false;
      walkState.back = false;
      walkState.left = false;
      walkState.right = false;
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", reset);

    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", reset);
      reset();
    };
  }, []);
}

// Clicking the canvas captures the cursor; mouse movement then aims the walker.
function useMouseLook(domElement: HTMLCanvasElement, camera: THREE.PerspectiveCamera) {
  useEffect(() => {
    const onClick = () => {
      if (document.pointerLockElement === domElement) return;
      // Chrome returns a promise that rejects when the gesture or document is ineligible.
      Promise.resolve(domElement.requestPointerLock() as unknown).catch(() => {});
    };

    const onMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== domElement) return;
      lookState.yaw -= event.movementX * LOOK_SENSITIVITY;
      lookState.pitch = THREE.MathUtils.clamp(
        lookState.pitch - event.movementY * LOOK_SENSITIVITY,
        -MAX_PITCH,
        MAX_PITCH,
      );
    };

    const onLockChange = () => {
      const locked = document.pointerLockElement === domElement;
      lookState.locked = locked;
      if (!locked) {
        // Walk mode leaves the camera off-center; ease it back instead of snapping to the parallax pose.
        lookState.recentering = true;
        return;
      }

      // Continue from wherever the framed camera was, so taking control never jumps the view.
      walkPosition.copy(camera.position);
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
      lookState.yaw = euler.y;
      lookState.pitch = euler.x;
    };

    domElement.addEventListener("click", onClick);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("pointerlockchange", onLockChange);

    return () => {
      domElement.removeEventListener("click", onClick);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      lookState.locked = false;
    };
  }, [domElement, camera]);
}

function RoomRig({ layout }: { layout: ScreenLayout }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const domElement = useThree((state) => state.gl.domElement);
  const pointer = usePointerPosition();
  const target = useMemo(() => new THREE.Vector3(), []);
  const lookAt = useMemo(() => new THREE.Vector3(), []);
  const heading = useMemo(() => new THREE.Vector3(), []);
  const strafe = useMemo(() => new THREE.Vector3(), []);
  const motion = useMemo(() => new THREE.Vector3(), []);
  // Must be a camera: Object3D.lookAt aims +Z at the target, cameras look down -Z. Only used while recentering.
  const framer = useMemo(() => new THREE.Camera(), []);

  useWalkKeys();
  useMouseLook(domElement, camera);

  // Pull back far enough that the whole screen fits whichever axis is the tighter constraint.
  const distance = useMemo(() => {
    const halfFov = (camera.fov * Math.PI) / 360;
    const canvasAspect = size.width / Math.max(size.height, 1);
    const byHeight = layout.height / 2 / Math.tan(halfFov);
    const byWidth = layout.width / 2 / (Math.tan(halfFov) * canvasAspect);
    return Math.max(byHeight, byWidth) * FIT_MARGIN;
  }, [camera.fov, size.width, size.height, layout.width, layout.height]);

  useFrame((_, delta) => {
    // r3f's documented pattern: mutate three.js objects in useFrame instead of setState.
    if (lookState.locked) {
      const { yaw, pitch } = lookState;
      heading.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      strafe.set(Math.cos(yaw), 0, -Math.sin(yaw));
      motion.set(0, 0, 0);

      if (walkState.forward) motion.add(heading);
      if (walkState.back) motion.sub(heading);
      if (walkState.right) motion.add(strafe);
      if (walkState.left) motion.sub(strafe);
      if (motion.lengthSq() > 0) walkPosition.addScaledVector(motion.normalize(), WALK_SPEED * delta);

      walkPosition.x = THREE.MathUtils.clamp(walkPosition.x, -WALK_BOUND_X, WALK_BOUND_X);
      walkPosition.z = THREE.MathUtils.clamp(
        walkPosition.z,
        SCREEN_Z + MIN_SCREEN_DISTANCE,
        SCREEN_Z + MAX_SCREEN_DISTANCE,
      );
      walkPosition.y = FLOOR_Y + WALK_EYE_HEIGHT;

      camera.position.copy(walkPosition);
      camera.rotation.set(pitch, yaw, 0, "YXZ");
      return;
    }

    // Camera drifts opposite the pointer and re-aims every frame off the eased position,
    // same as the hero scene, so rotation never lags behind the drift with a second ease.
    target.set(
      -pointer.x * PARALLAX_STRENGTH,
      layout.centerY + pointer.y * PARALLAX_STRENGTH,
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
        lookState.recentering = false;
      }
    } else {
      camera.lookAt(lookAt);
    }
  });

  return null;
}

function RoomScene({
  video,
  mirrorResolutionScale,
  wideBloomLevels,
}: {
  video: RoomVideo;
  mirrorResolutionScale: number;
  wideBloomLevels: number | null;
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

  return (
    <>
      <RoomRig layout={layout} />
      <MirrorFloor resolutionScale={mirrorResolutionScale} />
      <RoomShell />
      <ScreenPanel manifestUrl={video.manifestUrl} layout={layout} />
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

export function VideoRoom() {
  const [video, setVideo] = useState<RoomVideo | null>(null);
  // Drives the crossfade: false both before entering and while leaving, true once faded in.
  const [visible, setVisible] = useState(false);
  const [walking, setWalking] = useState(false);
  const enabled = useRenderingEnabled();
  const quality = useSceneQuality();
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    setVisible(false);
    // Keep the room mounted until the fade-out finishes instead of cutting it out instantly.
    closeTimeoutRef.current = setTimeout(() => setVideo(null), FADE_MS);
  }, []);

  useEffect(() => {
    const onLockChange = () => setWalking(!!document.pointerLockElement);
    document.addEventListener("pointerlockchange", onLockChange);
    return () => document.removeEventListener("pointerlockchange", onLockChange);
  }, []);

  // The hero scene sits fully behind this dialog once it's open, so pause its render loop too.
  useEffect(() => {
    setVideoRoomOpen(video !== null);
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
    if (!video) return;
    // Flip to visible next frame so the opacity transition actually runs instead of snapping in.
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [video]);

  useEffect(() => () => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!video) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // While the cursor is captured, Escape releases it instead of closing the room.
      if (event.key === "Escape" && !document.pointerLockElement) close();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [video, close]);

  if (!video) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={video.label}
      className={`fixed inset-0 z-50 bg-black transition-opacity duration-500 ease-in-out ${visible ? "opacity-100" : "opacity-0"}`}
    >
      {enabled ? (
        <Canvas
          style={{ position: "absolute", inset: 0, cursor: walking ? "none" : "pointer" }}
          dpr={quality.dpr}
          // MSAA is fixed at WebGL context creation, so this stays constant rather than tracking quality.
          gl={{ antialias: true, powerPreference: "high-performance" }}
          camera={{ position: [0, 0, CAMERA_Z], fov: 38, near: 0.1, far: 200 }}
          aria-hidden="true"
        >
          <RoomScene
            video={video}
            mirrorResolutionScale={quality.mirrorResolutionScale}
            wideBloomLevels={quality.wideBloomLevels}
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
        className={`absolute selection:border-white right-5 top-5 z-10 border border-white/30 px-4 py-2 text-[13px] uppercase tracking-wide text-white transition-[colors,opacity] duration-300 hover:bg-white hover:text-black ${walking ? "pointer-events-none opacity-0" : "opacity-100"}`}
      >
        Close
      </button>

      <p
        className={`pointer-events-none absolute inset-x-0 bottom-6 z-10 text-center text-[13px] uppercase text-white/70 transition-opacity duration-300 ${walking ? "opacity-0" : "opacity-100"}`}
      >
        {video.label}
      </p>

      {enabled ? (
        <p
          className={`pointer-events-none absolute inset-x-0 top-6 z-10 text-center text-[11px] uppercase tracking-wide text-white/40 transition-opacity duration-300 ${walking ? "opacity-0" : "opacity-100"}`}
        >
          Click to look around &middot; WASD to move &middot; Esc to release
        </p>
      ) : null}
    </div>
  );
}
