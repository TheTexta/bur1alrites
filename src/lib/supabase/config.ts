export type TransformOptions = {
  width?: number;
  height?: number;
  resize?: "cover" | "contain" | "fill";
  format?: "origin";
  quality?: number;
};

const DEFAULT_PORTFOLIO_BUCKET = "bur1alrites";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function readRequiredPublicEnv(
  value: string | undefined,
  name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY",
) {
  if (!value) {
    throw new Error(`Missing required Supabase env var: ${name}`);
  }

  return value;
}

function normalizeObjectPath(value: string) {
  return value.replace(/^\/|\/$/g, "").replace(/\/+/g, "/");
}

function encodeStoragePath(value: string) {
  return normalizeObjectPath(value)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function appendTransformOptions(
  searchParams: URLSearchParams,
  options: TransformOptions | undefined,
) {
  if (!options) {
    return;
  }

  if (options.width) {
    searchParams.set("width", String(options.width));
  }

  if (options.height) {
    searchParams.set("height", String(options.height));
  }

  if (options.resize) {
    searchParams.set("resize", options.resize);
  }

  if (options.format) {
    searchParams.set("format", options.format);
  }

  if (options.quality) {
    searchParams.set("quality", String(options.quality));
  }
}

function buildSupabaseStorageUrl(
  route: "object" | "render/image",
  objectPath: string,
  bucket: string,
  options?: TransformOptions,
) {
  const encodedBucket = encodeURIComponent(bucket);
  const encodedObjectPath = encodeStoragePath(objectPath);
  const url = new URL(
    `${route}/public/${encodedBucket}/${encodedObjectPath}`,
    `${getSupabaseUrl()}/storage/v1/`,
  );

  appendTransformOptions(url.searchParams, options);

  return url.toString();
}

export function getSupabaseUrl() {
  // Next only inlines NEXT_PUBLIC_* vars for static property access in client bundles.
  return trimTrailingSlash(
    readRequiredPublicEnv(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      "NEXT_PUBLIC_SUPABASE_URL",
    ),
  );
}

export function getPortfolioStorageBucket() {
  return (
    process.env.SUPABASE_PORTFOLIO_BUCKET ??
    process.env.NEXT_PUBLIC_SUPABASE_PORTFOLIO_BUCKET ??
    DEFAULT_PORTFOLIO_BUCKET
  );
}

export function getSupabaseProjectHostname() {
  return new URL(getSupabaseUrl()).hostname;
}

export function buildSupabaseStoragePublicUrl(
  objectPath: string,
  bucket = getPortfolioStorageBucket(),
) {
  return buildSupabaseStorageUrl("object", objectPath, bucket);
}

export function buildSupabaseStorageRenderUrl(
  objectPath: string,
  options: TransformOptions,
  bucket = getPortfolioStorageBucket(),
) {
  return buildSupabaseStorageUrl("render/image", objectPath, bucket, options);
}
