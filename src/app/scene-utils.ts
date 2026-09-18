"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useThree } from "@react-three/fiber";

let cachedWebGLAvailability: boolean | undefined;

export function isWebGLAvailable() {
  if (typeof window === "undefined") return false;
  if (cachedWebGLAvailability !== undefined) return cachedWebGLAvailability;

  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    cachedWebGLAvailability = !!context;
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    cachedWebGLAvailability = false;
  }

  return cachedWebGLAvailability;
}

export function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function subscribeToReducedMotionChange(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function getServerRenderCapabilitySnapshot() {
  return false;
}

// useSyncExternalStore keeps the server/hydration snapshot at `false` so enabling
// WebGL after mount never causes a hydration mismatch.
export function useRenderingEnabled() {
  return useSyncExternalStore(
    subscribeToReducedMotionChange,
    () => isWebGLAvailable() && !prefersReducedMotion(),
    getServerRenderCapabilitySnapshot,
  );
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribeToReducedMotionChange, prefersReducedMotion, getServerRenderCapabilitySnapshot);
}

// Lets the fully-obscured HeroScene canvas know to stop rendering while VideoRoom covers it,
// without unmounting it (which would flash a blank frame when the room closes).
const videoRoomOpenState = { open: false };
const videoRoomOpenListeners = new Set<() => void>();

export function setVideoRoomOpen(open: boolean) {
  if (videoRoomOpenState.open === open) return;
  videoRoomOpenState.open = open;
  videoRoomOpenListeners.forEach((listener) => listener());
}

function subscribeToVideoRoomOpen(callback: () => void) {
  videoRoomOpenListeners.add(callback);
  return () => videoRoomOpenListeners.delete(callback);
}

export function useVideoRoomOpen() {
  return useSyncExternalStore(subscribeToVideoRoomOpen, () => videoRoomOpenState.open, () => false);
}

// Shared between the video room's screen shader grain (video-room.tsx) and the gallery preview
// grain overlay (gallery-grain.tsx) so both use the exact same noise strength.
export const GRAIN_STRENGTH = 0.035;

// Module-level (not a ref) so the value survives Suspense-driven remounts of whichever component reads it.
const pointerState = { x: 0, y: 0 };

// Tracks the pointer in normalized (-1..1) viewport coordinates for camera-parallax rigs.
export function usePointerPosition() {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      pointerState.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointerState.y = (event.clientY / window.innerHeight) * 2 - 1;
      invalidate();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [invalidate]);

  return pointerState;
}
