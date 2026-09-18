export type SceneQualityLevel = "very-high" | "high" | "balanced" | "low";

export type ScenePerformanceSource = "hero" | "video-room";

export const SCENE_QUALITY_LEVELS: SceneQualityLevel[] = [
  "very-high",
  "high",
  "balanced",
  "low",
];

export const LONG_FRAME_THRESHOLD_MS = 100;
export const CATASTROPHIC_FRAME_THRESHOLD_MS = 250;
export const CATASTROPHIC_FRAME_COUNT = 2;

const WARMUP_MS = 3000;
const EMA_ALPHA = 0.1;
const EMA_SAMPLE_CAP_MS = CATASTROPHIC_FRAME_THRESHOLD_MS;
const DOWNGRADE_THRESHOLD_MS = 20;
const DOWNGRADE_SUSTAIN_MS = 1800;
const EMERGENCY_THRESHOLD_MS = 29;
const EMERGENCY_SUSTAIN_MS = 500;
const UPGRADE_THRESHOLD_MS = 17.2;
const UPGRADE_SUSTAIN_MS = 12000;
const COOLDOWN_MS = 5000;

export type SceneQualityController = {
  level: SceneQualityLevel;
  smoothedFrameMs: number;
  lastRawFrameMs: number;
  mountedAt: number;
  lastChangeAt: number;
  badSince: number | null;
  emergencyBadSince: number | null;
  goodSince: number | null;
  consecutiveCatastrophicFrames: number;
  ignoreNextSample: boolean;
  activeSource: ScenePerformanceSource | null;
  sampleCount: number;
  longFrameCount: number;
  catastrophicFrameCount: number;
  downgradeCount: number;
  upgradeCount: number;
};

export type SceneQualityTransition = {
  level: SceneQualityLevel;
  changed: boolean;
};

export function getInitialSceneQualityLevel(isMobile: boolean): SceneQualityLevel {
  return isMobile ? "low" : "very-high";
}

export function parseSceneQualityLevel(value: string | null): SceneQualityLevel | null {
  return value && (SCENE_QUALITY_LEVELS as string[]).includes(value)
    ? (value as SceneQualityLevel)
    : null;
}

export function createSceneQualityController(
  level: SceneQualityLevel,
  timestamp = 0,
): SceneQualityController {
  return {
    level,
    smoothedFrameMs: 1000 / 60,
    lastRawFrameMs: 0,
    mountedAt: timestamp,
    lastChangeAt: timestamp,
    badSince: null,
    emergencyBadSince: null,
    goodSince: null,
    consecutiveCatastrophicFrames: 0,
    ignoreNextSample: false,
    activeSource: null,
    sampleCount: 0,
    longFrameCount: 0,
    catastrophicFrameCount: 0,
    downgradeCount: 0,
    upgradeCount: 0,
  };
}

function resetWindows(controller: SceneQualityController) {
  controller.badSince = null;
  controller.emergencyBadSince = null;
  controller.goodSince = null;
  controller.consecutiveCatastrophicFrames = 0;
}

export function setControllerLevel(
  controller: SceneQualityController,
  level: SceneQualityLevel,
  timestamp: number,
) {
  if (controller.level === level) return false;
  controller.level = level;
  controller.lastChangeAt = timestamp;
  resetWindows(controller);
  return true;
}

export function resetSceneQualitySampling(controller: SceneQualityController) {
  resetWindows(controller);
  controller.ignoreNextSample = true;
  controller.activeSource = null;
}

export function recordSceneFrame(
  controller: SceneQualityController,
  deltaMs: number,
  timestamp: number,
  source: ScenePerformanceSource,
): SceneQualityTransition {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return { level: controller.level, changed: false };
  }

  if (controller.ignoreNextSample) {
    controller.ignoreNextSample = false;
    return { level: controller.level, changed: false };
  }

  controller.activeSource = source;
  controller.lastRawFrameMs = deltaMs;
  controller.sampleCount += 1;

  if (deltaMs > LONG_FRAME_THRESHOLD_MS) controller.longFrameCount += 1;
  if (deltaMs > CATASTROPHIC_FRAME_THRESHOLD_MS) {
    controller.catastrophicFrameCount += 1;
  }

  if (timestamp - controller.mountedAt < WARMUP_MS) {
    controller.consecutiveCatastrophicFrames = 0;
    return { level: controller.level, changed: false };
  }

  if (deltaMs > CATASTROPHIC_FRAME_THRESHOLD_MS) {
    controller.consecutiveCatastrophicFrames += 1;
  } else {
    controller.consecutiveCatastrophicFrames = 0;
  }

  const boundedDelta = Math.min(deltaMs, EMA_SAMPLE_CAP_MS);
  controller.smoothedFrameMs =
    controller.smoothedFrameMs * (1 - EMA_ALPHA) + boundedDelta * EMA_ALPHA;

  if (
    controller.consecutiveCatastrophicFrames >= CATASTROPHIC_FRAME_COUNT &&
    controller.level !== "low"
  ) {
    controller.downgradeCount += 1;
    setControllerLevel(controller, "low", timestamp);
    return { level: controller.level, changed: true };
  }

  if (timestamp - controller.lastChangeAt < COOLDOWN_MS) {
    return { level: controller.level, changed: false };
  }

  const currentIndex = SCENE_QUALITY_LEVELS.indexOf(controller.level);

  const downgrade = () => {
    if (currentIndex >= SCENE_QUALITY_LEVELS.length - 1) return false;
    controller.downgradeCount += 1;
    return setControllerLevel(
      controller,
      SCENE_QUALITY_LEVELS[currentIndex + 1],
      timestamp,
    );
  };

  if (controller.smoothedFrameMs > EMERGENCY_THRESHOLD_MS) {
    controller.emergencyBadSince ??= timestamp;
    if (timestamp - controller.emergencyBadSince >= EMERGENCY_SUSTAIN_MS) {
      return { level: controller.level, changed: downgrade() };
    }
  } else {
    controller.emergencyBadSince = null;
  }

  if (controller.smoothedFrameMs > DOWNGRADE_THRESHOLD_MS) {
    controller.badSince ??= timestamp;
    if (timestamp - controller.badSince >= DOWNGRADE_SUSTAIN_MS) {
      return { level: controller.level, changed: downgrade() };
    }
  } else {
    controller.badSince = null;
  }

  if (controller.smoothedFrameMs < UPGRADE_THRESHOLD_MS) {
    controller.goodSince ??= timestamp;
    if (
      timestamp - controller.goodSince >= UPGRADE_SUSTAIN_MS &&
      currentIndex > 0
    ) {
      controller.upgradeCount += 1;
      const changed = setControllerLevel(
        controller,
        SCENE_QUALITY_LEVELS[currentIndex - 1],
        timestamp,
      );
      return { level: controller.level, changed };
    }
  } else {
    controller.goodSince = null;
  }

  return { level: controller.level, changed: false };
}
