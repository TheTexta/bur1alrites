"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createSceneQualityController,
  parseSceneQualityLevel,
  recordSceneFrame,
  resetSceneQualitySampling,
  setControllerLevel,
  type ScenePerformanceSource,
  type SceneQualityController,
  type SceneQualityLevel,
} from "./scene-quality-controller";

export type { ScenePerformanceSource, SceneQualityLevel } from "./scene-quality-controller";
export { SCENE_QUALITY_LEVELS } from "./scene-quality-controller";

export type SceneQualitySettings = {
  dpr: [number, number];
  mirrorResolutionScale: number;
  screenSegments: number;
  displacementDirections: number;
  wideBloomLevels: number | null;
  lightSampleInterval: number | null;
};

export const SCENE_QUALITY_PRESETS: Record<SceneQualityLevel, SceneQualitySettings> = {
  "very-high": {
    dpr: [1, 2],
    mirrorResolutionScale: 1,
    screenSegments: 180,
    displacementDirections: 8,
    wideBloomLevels: 11,
    lightSampleInterval: 4,
  },
  high: {
    dpr: [1, 1.5],
    mirrorResolutionScale: 0.75,
    screenSegments: 140,
    displacementDirections: 6,
    wideBloomLevels: 9,
    lightSampleInterval: 8,
  },
  balanced: {
    dpr: [1, 1.25],
    mirrorResolutionScale: 0.6,
    screenSegments: 110,
    displacementDirections: 4,
    wideBloomLevels: 7,
    lightSampleInterval: 12,
  },
  low: {
    dpr: [1, 1],
    mirrorResolutionScale: 0.4,
    screenSegments: 56,
    displacementDirections: 2,
    wideBloomLevels: null,
    lightSampleInterval: null,
  },
};

const SESSION_STORAGE_KEY = "bur1alrites:scene-quality:v2";

type VideoPlaybackQualityLike = {
  totalVideoFrames: number;
  droppedVideoFrames: number;
};

export type SceneVideoTelemetry = {
  readyState: number;
  paused: boolean;
  mediaTime: number;
  decodedFrames: number | null;
  droppedFrames: number | null;
};

export type SceneQualityTelemetry = {
  level: SceneQualityLevel;
  activeSource: ScenePerformanceSource | null;
  rawFrameMs: number;
  smoothedFrameMs: number;
  approximateFps: number;
  sampleCount: number;
  longFrameCount: number;
  catastrophicFrameCount: number;
  downgradeCount: number;
  upgradeCount: number;
  videos: Partial<Record<ScenePerformanceSource, SceneVideoTelemetry>>;
};

type SceneQualityContextValue = {
  level: SceneQualityLevel;
  settings: SceneQualitySettings;
  recordFrameSample: (deltaMs: number, source: ScenePerformanceSource) => void;
};

const SceneQualityContext = createContext<SceneQualityContextValue | null>(null);
const videoTelemetryProviders = new Map<ScenePerformanceSource, () => SceneVideoTelemetry>();

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function readPersistedSceneQuality(): SceneQualityLevel | null {
  try {
    const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    return parseSceneQualityLevel(stored);
  } catch {
    return null;
  }
}

function persistSceneQuality(level: SceneQualityLevel) {
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, level);
  } catch {
    // Private browsing and quota failures should not disable adaptive quality.
  }
}

function videoTelemetry(video: HTMLVideoElement): SceneVideoTelemetry {
  const quality = (
    video as HTMLVideoElement & {
      getVideoPlaybackQuality?: () => VideoPlaybackQualityLike;
    }
  ).getVideoPlaybackQuality?.();

  return {
    readyState: video.readyState,
    paused: video.paused,
    mediaTime: Math.round(video.currentTime * 100) / 100,
    decodedFrames: quality?.totalVideoFrames ?? null,
    droppedFrames: quality?.droppedVideoFrames ?? null,
  };
}

export function registerSceneVideoTelemetry(
  source: ScenePerformanceSource,
  video: HTMLVideoElement,
) {
  const provider = () => videoTelemetry(video);
  videoTelemetryProviders.set(source, provider);

  return () => {
    if (videoTelemetryProviders.get(source) === provider) {
      videoTelemetryProviders.delete(source);
    }
  };
}

function getTelemetry(controller: SceneQualityController): SceneQualityTelemetry {
  const videos: SceneQualityTelemetry["videos"] = {};
  for (const [source, provider] of videoTelemetryProviders) videos[source] = provider();

  return {
    level: controller.level,
    activeSource: controller.activeSource,
    rawFrameMs: Math.round(controller.lastRawFrameMs * 10) / 10,
    smoothedFrameMs: Math.round(controller.smoothedFrameMs * 10) / 10,
    approximateFps: Math.round((1000 / controller.smoothedFrameMs) * 10) / 10,
    sampleCount: controller.sampleCount,
    longFrameCount: controller.longFrameCount,
    catastrophicFrameCount: controller.catastrophicFrameCount,
    downgradeCount: controller.downgradeCount,
    upgradeCount: controller.upgradeCount,
    videos,
  };
}

export function SceneQualityProvider({
  initialLevel,
  children,
}: {
  initialLevel: SceneQualityLevel;
  children: React.ReactNode;
}) {
  const [level, setLevel] = useState(initialLevel);
  const controllerRef = useRef(createSceneQualityController(initialLevel));

  const applyLevel = useCallback((nextLevel: SceneQualityLevel, timestamp = now()) => {
    const controller = controllerRef.current;
    if (!setControllerLevel(controller, nextLevel, timestamp)) return;
    persistSceneQuality(nextLevel);
    setLevel(nextLevel);
  }, []);

  const recordFrameSample = useCallback(
    (deltaMs: number, source: ScenePerformanceSource) => {
      if (document.visibilityState !== "visible") return;
      const controller = controllerRef.current;
      const transition = recordSceneFrame(controller, deltaMs, now(), source);
      if (!transition.changed) return;
      persistSceneQuality(transition.level);
      setLevel(transition.level);
    },
    [],
  );

  useEffect(() => {
    const controller = controllerRef.current;
    controller.mountedAt = now();
    controller.lastChangeAt = controller.mountedAt;

    const persisted = readPersistedSceneQuality();
    if (persisted) applyLevel(persisted, controller.mountedAt);

    const onVisibilityChange = () => resetSceneQualitySampling(controller);
    document.addEventListener("visibilitychange", onVisibilityChange);

    Object.assign(window as unknown as Record<string, unknown>, {
      __setSceneQuality: applyLevel,
      __getSceneQuality: () => controller.level,
      __getSceneQualityTelemetry: () => getTelemetry(controller),
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      videoTelemetryProviders.clear();
      delete (window as unknown as Record<string, unknown>).__setSceneQuality;
      delete (window as unknown as Record<string, unknown>).__getSceneQuality;
      delete (window as unknown as Record<string, unknown>).__getSceneQualityTelemetry;
    };
  }, [applyLevel]);

  const value = useMemo<SceneQualityContextValue>(
    () => ({
      level,
      settings: SCENE_QUALITY_PRESETS[level],
      recordFrameSample,
    }),
    [level, recordFrameSample],
  );

  return <SceneQualityContext.Provider value={value}>{children}</SceneQualityContext.Provider>;
}

function useSceneQualityContext() {
  const context = useContext(SceneQualityContext);
  if (!context) throw new Error("Scene quality hooks require SceneQualityProvider.");
  return context;
}

export function useSceneQualityLevel() {
  return useSceneQualityContext().level;
}

export function useSceneQuality() {
  return useSceneQualityContext().settings;
}

export function useSceneFrameRecorder() {
  return useSceneQualityContext().recordFrameSample;
}
