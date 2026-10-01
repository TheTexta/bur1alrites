type ImageOptions = { width?: number; quality?: number };

function baseUrl(value: string | undefined, name: string) {
  if (!value) throw new Error(`Missing media environment variable: ${name}`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error(`${name} must be an HTTPS base URL.`);
  return url.toString().replace(/\/+$/, "");
}

function appendPath(base: string, path: string) {
  const segments = path.replace(/^\/+|\/+$/g, "").split("/");
  if (segments.some(segment => !segment || segment === "." || segment === ".." || segment.includes("\\"))) throw new Error("Invalid media path.");
  return `${base}/${segments.map(encodeURIComponent).join("/")}`;
}

export function buildMediaPublicUrl(path: string) {
  return appendPath(baseUrl(process.env.NEXT_PUBLIC_CLOUDFLARE_R2_MEDIA_URL, "NEXT_PUBLIC_CLOUDFLARE_R2_MEDIA_URL"), path);
}

export function buildImagePublicUrl(path: string, options?: ImageOptions) {
  const url = new URL(appendPath(baseUrl(process.env.NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_URL, "NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_URL"), path));
  if (options?.width) url.searchParams.set("width", String(options.width));
  if (options?.quality) url.searchParams.set("quality", String(options.quality));
  if (options) url.searchParams.set("format", "auto");
  return url.toString();
}
