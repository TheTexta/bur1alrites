export const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";
export const GLASS_TARGET_ID = "contact";

const GLOW_CURVE = 20;
const TEXT_BLUR_START_COVERAGE = 0.45;
const TEXT_BLUR_CURVE = 3;
const FADE_OUT_CURVE = 4;
const GLASS_CURVE = 2;

type WordmarkMotionInput = {
  scrollY: number;
  viewportHeight: number;
  galleryTop: number;
  contactTop: number;
};

export type WordmarkMotion = {
  glowProgress: number;
  textBlurProgress: number;
  fadeProgress: number;
  contactProgress: number;
};

export function clampProgress(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

export function smoothstep(start: number, end: number, value: number) {
  const progress = clampProgress((value - start) / Math.max(end - start, Number.EPSILON));
  return progress * progress * (3 - 2 * progress);
}

export function getWordmarkMotion({
  scrollY,
  viewportHeight,
  galleryTop,
  contactTop,
}: WordmarkMotionInput): WordmarkMotion {
  const viewport = Math.max(viewportHeight, 1);
  const heroProgress = clampProgress(scrollY / viewport);
  const galleryProgress = clampProgress(scrollY / Math.max(galleryTop, 1));
  const blurStart = viewport * TEXT_BLUR_START_COVERAGE;
  const smearProgress = scrollY <= blurStart
    ? 0
    : clampProgress((scrollY - blurStart) / Math.max(galleryTop - blurStart, 1));
  const contactEntry = clampProgress((scrollY + viewport - contactTop) / viewport);

  return {
    glowProgress: heroProgress ** GLOW_CURVE,
    textBlurProgress: smearProgress ** TEXT_BLUR_CURVE,
    fadeProgress: galleryProgress ** FADE_OUT_CURVE,
    contactProgress: contactEntry ** GLASS_CURVE,
  };
}