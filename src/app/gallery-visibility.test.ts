import { describe, expect, it } from "vitest";

import { GALLERY_PREVIEW_ROOT_MARGIN, isInGalleryRenderRange } from "./gallery-visibility";

function rect(left: number, top: number, width = 100, height = 100) {
  return { left, top, right: left + width, bottom: top + height };
}

describe("gallery parallax render overscan", () => {
  const viewport = { width: 1000, height: 800 };

  it("keeps cards inside the viewport renderable", () => {
    expect(isInGalleryRenderRange(rect(100, 100), viewport)).toBe(true);
  });

  it.each([
    ["above", rect(100, -259)],
    ["below", rect(100, 959)],
    ["left", rect(-299, 100)],
    ["right", rect(1199, 100)],
    ["corner", rect(-299, -259)],
  ])("keeps cards just inside the 20%% buffer %s renderable", (_, bounds) => {
    expect(isInGalleryRenderRange(bounds, viewport)).toBe(true);
  });

  it.each([
    ["above", rect(100, -260)],
    ["below", rect(100, 960)],
    ["left", rect(-300, 100)],
    ["right", rect(1200, 100)],
  ])("hides cards outside the 20%% buffer %s", (_, bounds) => {
    expect(isInGalleryRenderRange(bounds, viewport)).toBe(false);
  });

  it("uses each viewport axis independently, including after resizing", () => {
    const bounds = rect(1100, 900);
    expect(isInGalleryRenderRange(bounds, viewport)).toBe(true);
    expect(isInGalleryRenderRange(bounds, { width: 900, height: 800 })).toBe(false);
    expect(isInGalleryRenderRange(bounds, { width: 1000, height: 700 })).toBe(false);
    expect(isInGalleryRenderRange(rect(100, 1799), { width: 800, height: 1500 })).toBe(true);
    expect(isInGalleryRenderRange(rect(100, 1800), { width: 800, height: 1500 })).toBe(false);
  });

  it("extends desktop video preloading horizontally without reducing its vertical margin", () => {
    expect(GALLERY_PREVIEW_ROOT_MARGIN).toBe("25% 20%");
  });
});
