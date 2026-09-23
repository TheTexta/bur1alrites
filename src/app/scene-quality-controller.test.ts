import { describe, expect, test } from "vitest";

import {
  createSceneQualityController,
  getInitialSceneQualityLevel,
  parseSceneQualityLevel,
  recordSceneFrame,
  resetSceneQualitySampling,
} from "./scene-quality-controller";
import {
  MAX_SCENE_DPR,
  SCENE_QUALITY_LEVELS,
  SCENE_QUALITY_PRESETS,
} from "./scene-quality";

function sampleRange(
  level: Parameters<typeof createSceneQualityController>[0],
  deltaMs: number,
  durationMs: number,
) {
  const controller = createSceneQualityController(level, 0);
  for (let timestamp = 5000; timestamp <= 5000 + durationMs; timestamp += deltaMs) {
    recordSceneFrame(controller, deltaMs, timestamp, "hero");
  }
  return controller;
}

describe("scene quality controller", () => {
  test("holds very-high quality at a stable 60 FPS", () => {
    const controller = sampleRange("very-high", 1000 / 60, 20000);
    expect(controller.level).toBe("very-high");
    expect(controller.downgradeCount).toBe(0);
  });

  test("starts mobile low and validates persisted levels", () => {
    expect(getInitialSceneQualityLevel(true)).toBe("low");
    expect(getInitialSceneQualityLevel(false)).toBe("very-high");
    expect(parseSceneQualityLevel("balanced")).toBe("balanced");
    expect(parseSceneQualityLevel("ultra")).toBeNull();
  });

  test("downgrades sustained moderately slow rendering", () => {
    const controller = sampleRange("very-high", 25, 3500);
    expect(controller.level).toBe("high");
    expect(controller.downgradeCount).toBe(1);
  });

  test("records long frames and sends catastrophic rendering directly to low", () => {
    const controller = createSceneQualityController("very-high", 0);
    recordSceneFrame(controller, 2000, 5000, "hero");
    recordSceneFrame(controller, 2000, 7000, "hero");

    expect(controller.level).toBe("low");
    expect(controller.sampleCount).toBe(2);
    expect(controller.longFrameCount).toBe(2);
    expect(controller.catastrophicFrameCount).toBe(2);
    expect(controller.smoothedFrameMs).toBeGreaterThan(16.7);
  });

  test("ignores the first sample after a visibility reset", () => {
    const controller = createSceneQualityController("very-high", 0);
    recordSceneFrame(controller, 300, 5000, "hero");
    resetSceneQualitySampling(controller);
    recordSceneFrame(controller, 5000, 10000, "hero");
    recordSceneFrame(controller, 1000 / 60, 10017, "hero");

    expect(controller.level).toBe("very-high");
    expect(controller.catastrophicFrameCount).toBe(1);
    expect(controller.sampleCount).toBe(2);
  });

  test("upgrades only one level after sustained smooth rendering", () => {
    const controller = sampleRange("low", 16, 12500);
    expect(controller.level).toBe("balanced");
    expect(controller.upgradeCount).toBe(1);
  });

  test("quality presets become monotonically cheaper", () => {
    const presets = SCENE_QUALITY_LEVELS.map((level) => SCENE_QUALITY_PRESETS[level]);

    for (let index = 1; index < presets.length; index += 1) {
      const better = presets[index - 1];
      const cheaper = presets[index];
      expect(cheaper.dpr[1]).toBeLessThanOrEqual(better.dpr[1]);
      expect(cheaper.mirrorResolutionScale).toBeLessThanOrEqual(better.mirrorResolutionScale);
      expect(cheaper.screenSegments).toBeLessThanOrEqual(better.screenSegments);
      expect(cheaper.displacementDirections).toBeLessThanOrEqual(better.displacementDirections);
      expect(cheaper.wideBloomLevels ?? 0).toBeLessThanOrEqual(better.wideBloomLevels ?? 0);
      expect(cheaper.lightSampleInterval ?? Number.POSITIVE_INFINITY).toBeGreaterThanOrEqual(
        better.lightSampleInterval ?? Number.POSITIVE_INFINITY,
      );
    }
  });

  test("caps every adaptive quality preset at a mobile-safe pixel ratio", () => {
    for (const preset of Object.values(SCENE_QUALITY_PRESETS)) {
      expect(preset.dpr[1]).toBeLessThanOrEqual(MAX_SCENE_DPR);
    }
  });
});
