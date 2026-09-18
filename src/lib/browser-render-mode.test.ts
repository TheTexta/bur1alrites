import { describe, expect, test } from "vitest";

import { detectMobileDevice } from "./browser-render-mode";

describe("detectMobileDevice", () => {
  test("uses the client hint when available", () => {
    expect(detectMobileDevice("desktop", "?1")).toBe(true);
    expect(detectMobileDevice("desktop", "?0")).toBe(false);
  });

  test("recognizes iOS and Android devices", () => {
    expect(detectMobileDevice("Mozilla/5.0 (iPhone) Mobile/15E148 Safari/604.1")).toBe(true);
    expect(detectMobileDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140 Mobile")).toBe(true);
    expect(detectMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1.15")).toBe(false);
  });
});
