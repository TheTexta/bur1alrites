// Room geometry and the scroll-driven rise. Framework-free (no three, no React) so both
// the 3D scene and the server-rendered page read the same numbers.

export const FLOOR_SIZE = 160;
export const FLOOR_Y = -6;
export const CEILING_Y = FLOOR_Y + 42;
export const SCREEN_Z = -30;
const SCREEN_MAX_WIDTH = 22;
const SCREEN_MAX_HEIGHT = 12;
// Keep the screen flush with the mirror so no seam appears behind the floor figure.
const SCREEN_FLOOR_GAP = 0;
// Headroom left around the screen so pointer drift never pushes an edge out of frame.
const FIT_MARGIN = 1.2;

export const LOGO_ASPECT = 704 / 1008;
export const HERO_ASPECT = 16 / 9;
export const MOBILE_FOV_INCREASE = 10;

export type ScreenLayout = { width: number; height: number; centerY: number };

// Portrait clips are height-bound and landscape clips width-bound, so both limits apply.
export function getScreenLayout(aspect: number): ScreenLayout {
  const width = Math.min(SCREEN_MAX_WIDTH, SCREEN_MAX_HEIGHT * aspect);
  const height = width / aspect;
  return { width, height, centerY: FLOOR_Y + SCREEN_FLOOR_GAP + height / 2 };
}

// Pull back far enough that the whole screen fits whichever axis is the tighter constraint.
export function screenFitDistance(fovDeg: number, aspect: number, layout: ScreenLayout) {
  const halfFov = (fovDeg * Math.PI) / 360;
  const byHeight = layout.height / 2 / Math.tan(halfFov);
  const byWidth = layout.width / 2 / (Math.tan(halfFov) * Math.max(aspect, 0.0001));
  return Math.max(byHeight, byWidth) * FIT_MARGIN;
}

// The hero's screen is oversized; framing distance still comes from the un-scaled layout below, so
// enlarging it fills more of the frame instead of pushing the camera back.
const HERO_SCREEN_SCALE = 1.8;
// Match the photo-viewer's responsive framing by moving the hero camera closer as the viewport
// narrows. The lower bound keeps the camera from getting excessively close on tiny screens.
const HERO_CAMERA_REFERENCE_WIDTH = 1024;
const HERO_CAMERA_MIN_DISTANCE_SCALE = 1 / 2.6;

export function getHeroCameraDistanceScale(viewportWidth: number) {
  const safeWidth = Math.max(viewportWidth, 1);
  return Math.max(
    Math.min(safeWidth / HERO_CAMERA_REFERENCE_WIDTH, 1),
    HERO_CAMERA_MIN_DISTANCE_SCALE,
  );
}

export function getHeroScreenLayout(): ScreenLayout {
  const base = getScreenLayout(HERO_ASPECT);
  const height = base.height * HERO_SCREEN_SCALE;
  return {
    width: base.width * HERO_SCREEN_SCALE,
    height,
    centerY: FLOOR_Y + SCREEN_FLOOR_GAP + height / 2,
  };
}

// Starts level with the screen's centre, so the camera never has to pitch to frame it.
export const HERO_EYE_Y = getHeroScreenLayout().centerY;

export type SectionMetrics = { galleryTop: number; contactTop: number };

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

// The camera and room never move. Scroll instead lifts the wordmark out of frame while the gallery
// rises over it; the statue reveal is held back until the gallery is running out.
export function getScrollRise(
  scrollY: number,
  { galleryTop, contactTop }: SectionMetrics,
  viewportHeight: number,
) {
  const crossing = Math.max(galleryTop, 1);
  const revealEnd = Number.isFinite(contactTop) ? Math.max(contactTop, crossing + 1) : crossing * 2;
  // One screen of scroll, so the tilt starts as the gallery's last row clears the viewport.
  const revealStart = Math.max(revealEnd - viewportHeight, crossing);

  return {
    galleryProgress: clamp01(scrollY / crossing),
    contactTransitionStart: revealStart,
    contactProgress: clamp01((scrollY - revealStart) / Math.max(revealEnd - revealStart, 1)),
  };
}

export function getDisplacementProgress(
  scrollY: number,
  contactTransitionStart: number,
  scrollEnd: number,
  start: number,
  finish: number,
  endOfScroll: number,
) {
  // The first phase ends when the camera begins its contact reveal.
  const toContact = clamp01(scrollY / Math.max(contactTransitionStart, 1));
  // The second phase reaches its final value at the document's last scroll position.
  const afterContact = clamp01(
    (scrollY - contactTransitionStart) / Math.max(scrollEnd - contactTransitionStart, 1),
  );
  const easedAfterContact = 1 - (1 - afterContact) ** 3;
  const beforeContactValue = start + (finish - start) * toContact;
  return beforeContactValue + (endOfScroll - beforeContactValue) * easedAfterContact;
}
