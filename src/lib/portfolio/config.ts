const DEFAULT_IMAGE_BASE_PATH = "portfolio-images";
const DEFAULT_EXTENSION = "webp";

// Supabase Storage only accepts cacheControl at write time; set it on upload.
export const PORTFOLIO_CACHE_CONTROL_SECONDS = "31536000";
export const PORTFOLIO_CACHE_CONTROL_HEADER = `max-age=${PORTFOLIO_CACHE_CONTROL_SECONDS}`;

export function portfolioImageBasePath() {
  return process.env.NEXT_PUBLIC_PORTFOLIO_IMAGE_BASE_PATH ?? DEFAULT_IMAGE_BASE_PATH;
}

export function normalizePortfolioStoragePath(path: string) {
  return path.replace(/^\/+/, "");
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "webp", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);

export function normalizePortfolioExtension(extension: string | undefined) {
  const normalized = String(extension ?? "")
    .replace(/^\.+/, "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return DEFAULT_EXTENSION;
  }

  if (normalized === "jpeg") {
    return "jpg";
  }

  if (IMAGE_EXTENSIONS.has(normalized) || VIDEO_EXTENSIONS.has(normalized)) {
    return normalized;
  }

  return DEFAULT_EXTENSION;
}

export function isPortfolioVideoPath(path: string) {
  return VIDEO_EXTENSIONS.has(path.split(".").pop()?.toLowerCase() ?? "");
}

export function buildPortfolioStoragePath(slug: string, extension?: string) {
  const base = portfolioImageBasePath().replace(/\/$/, "");
  return `${base}/${slug}.${normalizePortfolioExtension(extension)}`;
}

export function buildPortfolioStreamManifestPath(slug: string) {
  const base = portfolioImageBasePath().replace(/\/$/, "");
  return `${base}/streams/${slug}/master.m3u8`;
}

export function buildPortfolioVideoPosterPath(slug: string) {
  const base = portfolioImageBasePath().replace(/\/$/, "");
  return `${base}/posters/${slug}.jpg`;
}
