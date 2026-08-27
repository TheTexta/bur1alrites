export const CANVAS_IMAGE_DEVICE_SIZES = [
  640, 750, 828, 1080, 1200, 1920, 2048, 3840,
];

export const CANVAS_IMAGE_SIZES = [
  64, 96, 128, 160, 192, 220, 256, 320, 384, 448, 512,
];

export const CANVAS_IMAGE_WIDTHS = [
  ...new Set([...CANVAS_IMAGE_SIZES, ...CANVAS_IMAGE_DEVICE_SIZES]),
].sort((left, right) => left - right);

export const CANVAS_IMAGE_QUALITY = 60;

export const MIN_RENDER_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
