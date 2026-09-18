"use client";

import { useSyncExternalStore } from "react";

// "very-high" preserves the original, uncapped rendering pipeline exactly as it shipped.
export type SceneQualityLevel = "very-high" | "high" | "balanced" | "low";

export type SceneQualitySettings = {
  // WebGL MSAA is fixed at context creation, so antialiasing is intentionally not part of this
  // preset - it can't be toggled live without remounting the Canvas/renderer. Kept constant at
  // `true` in both Canvases instead.
  dpr: [number, number];
  // Multiplies the mirror reflector's render-target dimensions (already `size * dpr`) per axis.
  mirrorResolutionScale: number;
  // Displaced screen's plane subdivisions per axis.
  screenSegments: number;
  // Angular taps in the vertex-shader luminance blur ring; 0 skips the ring and samples only the centre.
  displacementDirections: number;
  // Second (wide, faint) Bloom pass's mip levels; null removes that pass entirely.
  wideBloomLevels: number | null;
};

export const SCENE_QUALITY_PRESETS: Record<SceneQualityLevel, SceneQualitySettings> = {
  "very-high": {
    dpr: [1, 2],
    mirrorResolutionScale: 1,
    screenSegments: 180,
    displacementDirections: 8,
    wideBloomLevels: 11,
  },
  high: {
    dpr: [1.5, 2],
    mirrorResolutionScale: 1,
    screenSegments: 180,
    displacementDirections: 8,
    wideBloomLevels: 11,
  },
  balanced: {
    dpr: [1.25, 1.5],
    mirrorResolutionScale: 0.6,
    screenSegments: 110,
    displacementDirections: 4,
    wideBloomLevels: 7,
  },
  low: {
    dpr: [1, 1],
    mirrorResolutionScale: 0.4,
    screenSegments: 56,
    displacementDirections: 2,
    wideBloomLevels: null,
  },
};

// Worst-to-best is used elsewhere; this order is best-to-worst, so upgrades/downgrades are just ±1 index.
export const SCENE_QUALITY_LEVELS: SceneQualityLevel[] = ["very-high", "high", "balanced", "low"];

const SESSION_STORAGE_KEY = "bur1alrites:scene-quality";

function readPersistedSceneQuality(): SceneQualityLevel | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    return stored && (SCENE_QUALITY_LEVELS as string[]).includes(stored) ? (stored as SceneQualityLevel) : null;
  } catch {
    return null;
  }
}

function persistSceneQuality(level: SceneQualityLevel) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, level);
  } catch {
    // Private-browsing/storage-quota failures just skip persistence for this tab.
  }
}

// Reused across a single browsing session (not localStorage) so reloads/navigation during the same
// visit resume at the level the controller already learned, without permanently condemning a machine
// that happened to be under thermal/battery pressure for one session.
let sceneQualityLevel: SceneQualityLevel = readPersistedSceneQuality() ?? "very-high";
const sceneQualityListeners = new Set<() => void>();

export function setSceneQuality(level: SceneQualityLevel) {
  if (sceneQualityLevel === level) return;
  sceneQualityLevel = level;
  // Any change (manual or automatic) starts the post-change cooldown, since shader recompilation
  // and render-target resizing can themselves briefly produce bad frames.
  controller.lastChangeAt = now();
  persistSceneQuality(level);
  sceneQualityListeners.forEach((listener) => listener());
}

// Manual QA hook (e.g. `window.__setSceneQuality("low")` in devtools) for verifying the hero
// video/HLS stream survives quality switches uninterrupted; same pattern as hero-scene's `__rise`.
if (typeof window !== "undefined") {
  Object.assign(window as unknown as Record<string, unknown>, {
    __setSceneQuality: setSceneQuality,
    __getSceneQuality: () => sceneQualityLevel,
    __getSceneQualityTelemetry: () => getSceneQualityTelemetry(),
  });
}

export function getSceneQualityLevel() {
  return sceneQualityLevel;
}

function subscribeToSceneQuality(callback: () => void) {
  sceneQualityListeners.add(callback);
  return () => sceneQualityListeners.delete(callback);
}

function getServerSceneQualitySnapshot(): SceneQualityLevel {
  return "very-high";
}

export function useSceneQualityLevel(): SceneQualityLevel {
  return useSyncExternalStore(subscribeToSceneQuality, getSceneQualityLevel, getServerSceneQualitySnapshot);
}

export function useSceneQuality(): SceneQualitySettings {
  return SCENE_QUALITY_PRESETS[useSceneQualityLevel()];
}

// --- Automatic quality controller -----------------------------------------------------------
// Driven by measured frame time from the hero Canvas (the persistently heaviest workload on the
// page - mirror/bloom/displacement keep rendering regardless of scroll position), not hardware
// detection. Downgrades react quickly; upgrades demand much longer sustained good performance, so
// the level doesn't oscillate as workload naturally varies while scrolling.
function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// Frames while the tab isn't visible, or unusually large deltas from tab-switches/OS scheduling
// pauses, are ignored entirely rather than clamped, so they never pollute the smoothed average.
const MAX_SAMPLE_DELTA_MS = 100;
// Lets initial shader/texture/video compilation settle before judging performance.
const WARMUP_MS = 3000;
const EMA_ALPHA = 0.1;
const DOWNGRADE_THRESHOLD_MS = 20;
const DOWNGRADE_SUSTAIN_MS = 1800;
const EMERGENCY_THRESHOLD_MS = 29;
const EMERGENCY_SUSTAIN_MS = 500;
// A 60Hz display's RAF delta sits around 16.67ms even when the GPU has huge headroom to spare -
// frame delta alone can't distinguish "capable of 61 FPS" from "capable of 200 FPS" once
// vsync-limited. 15ms would mean "we're rendering faster than the display can show", which a
// vsync-capped browser essentially never reports; 17.2ms instead means "we've held ~60 FPS
// consistently", which is the only thing this signal can actually tell us.
const UPGRADE_THRESHOLD_MS = 17.2;
const UPGRADE_SUSTAIN_MS = 12000;
// Recompiling shaders / resizing render targets after a change can itself produce a few bad
// frames, so further automatic changes are suppressed for a while after any change.
const COOLDOWN_MS = 5000;

const controller = {
  smoothedFrameMs: 1000 / 60,
  mountedAt: now(),
  lastChangeAt: 0,
  badSince: null as number | null,
  emergencyBadSince: null as number | null,
  goodSince: null as number | null,
  downgradeCount: 0,
  upgradeCount: 0,
};

export type SceneQualityTelemetry = {
  level: SceneQualityLevel;
  smoothedFrameMs: number;
  downgradeCount: number;
  upgradeCount: number;
};

export function getSceneQualityTelemetry(): SceneQualityTelemetry {
  return {
    level: sceneQualityLevel,
    smoothedFrameMs: Math.round(controller.smoothedFrameMs * 10) / 10,
    downgradeCount: controller.downgradeCount,
    upgradeCount: controller.upgradeCount,
  };
}

// Called once per hero-Canvas frame (see `ScenePerformanceMonitor` in hero-scene.tsx) with the
// frame delta in milliseconds.
export function recordFrameSample(deltaMs: number) {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  if (!Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > MAX_SAMPLE_DELTA_MS) return;

  const timestamp = now();
  if (timestamp - controller.mountedAt < WARMUP_MS) return;

  controller.smoothedFrameMs = controller.smoothedFrameMs * (1 - EMA_ALPHA) + deltaMs * EMA_ALPHA;

  if (timestamp - controller.lastChangeAt < COOLDOWN_MS) return;

  const frameMs = controller.smoothedFrameMs;
  const currentIndex = SCENE_QUALITY_LEVELS.indexOf(sceneQualityLevel);

  const downgrade = () => {
    controller.downgradeCount += 1;
    controller.badSince = null;
    controller.emergencyBadSince = null;
    controller.goodSince = null;
    setSceneQuality(SCENE_QUALITY_LEVELS[currentIndex + 1]);
  };

  if (frameMs > EMERGENCY_THRESHOLD_MS) {
    controller.emergencyBadSince ??= timestamp;
    if (timestamp - controller.emergencyBadSince >= EMERGENCY_SUSTAIN_MS && currentIndex < SCENE_QUALITY_LEVELS.length - 1) {
      downgrade();
      return;
    }
  } else {
    controller.emergencyBadSince = null;
  }

  if (frameMs > DOWNGRADE_THRESHOLD_MS) {
    controller.badSince ??= timestamp;
    if (timestamp - controller.badSince >= DOWNGRADE_SUSTAIN_MS && currentIndex < SCENE_QUALITY_LEVELS.length - 1) {
      downgrade();
      return;
    }
  } else {
    controller.badSince = null;
  }

  if (frameMs < UPGRADE_THRESHOLD_MS) {
    controller.goodSince ??= timestamp;
    if (timestamp - controller.goodSince >= UPGRADE_SUSTAIN_MS && currentIndex > 0) {
      controller.upgradeCount += 1;
      controller.goodSince = null;
      setSceneQuality(SCENE_QUALITY_LEVELS[currentIndex - 1]);
      return;
    }
  } else {
    controller.goodSince = null;
  }
}

