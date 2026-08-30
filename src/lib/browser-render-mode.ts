export type RenderMode = "default" | "webkit-safe";

const APPLE_MOBILE_DEVICE = /\b(?:iPhone|iPad|iPod)\b/i;
const IPAD_DESKTOP_MODE = /\bMacintosh\b/i;
const MOBILE_MARKER = /\bMobile(?:\/|\b)/i;
const DESKTOP_SAFARI = /\bVersion\/\d+(?:\.\d+)*.*\bSafari\//i;
const CHROMIUM_FAMILY = /\b(?:Chrom(?:e|ium)|CriOS|Edg(?:e|A|iOS)?|OPR|Opera|SamsungBrowser)\//i;

export function detectRenderMode(userAgent: string | null | undefined): RenderMode {
  if (!userAgent) return "default";

  const isAppleMobile =
    APPLE_MOBILE_DEVICE.test(userAgent) ||
    (IPAD_DESKTOP_MODE.test(userAgent) && MOBILE_MARKER.test(userAgent));

  if (isAppleMobile) return "webkit-safe";

  if (DESKTOP_SAFARI.test(userAgent) && !CHROMIUM_FAMILY.test(userAgent)) {
    return "webkit-safe";
  }

  return "default";
}
