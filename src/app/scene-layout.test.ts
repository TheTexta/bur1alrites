import { describe, expect, test } from "vitest";

import { getDisplacementProgress, getScrollRise } from "./scene-layout";

describe("hero displacement scroll timing", () => {
  const galleryTop = 800;
  const contactTop = 3600;
  const viewportHeight = 800;
  const stops = [1, 4, 10] as const;

  test("reaches the finish value when the contact camera transition begins", () => {
    const { contactTransitionStart, contactProgress } = getScrollRise(
      2800,
      { galleryTop, contactTop },
      viewportHeight,
    );

    expect(contactTransitionStart).toBe(2800);
    expect(contactProgress).toBe(0);
    expect(getDisplacementProgress(0, contactTransitionStart, contactTop, ...stops)).toBe(1);
    expect(getDisplacementProgress(galleryTop, contactTransitionStart, contactTop, ...stops)).toBeLessThan(4);
    expect(getDisplacementProgress(contactTransitionStart - 1, contactTransitionStart, contactTop, ...stops)).toBeLessThan(4);
    expect(getDisplacementProgress(contactTransitionStart, contactTransitionStart, contactTop, ...stops)).toBe(4);
  });

  test("reaches the final value at the end of the page", () => {
    const { contactTransitionStart } = getScrollRise(
      0,
      { galleryTop, contactTop },
      viewportHeight,
    );
    const scrollEnd = 5200;

    expect(getDisplacementProgress(contactTop, contactTransitionStart, scrollEnd, ...stops)).toBeLessThan(10);
    expect(getDisplacementProgress(scrollEnd, contactTransitionStart, scrollEnd, ...stops)).toBe(10);
    expect(getDisplacementProgress(scrollEnd + 100, contactTransitionStart, scrollEnd, ...stops)).toBe(10);
  });
});
