// Uploads pre-optimized images to Supabase Storage with the long-lived
// cache-control header applied at write time (it cannot be changed afterward
// without a copy-to-self, which is why portfolio needs fix-cache-control).
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BUCKET = process.env.SUPABASE_PORTFOLIO_BUCKET ?? "bur1alrites";
const BASE_PATH = (process.env.NEXT_PUBLIC_PORTFOLIO_IMAGE_BASE_PATH ?? "portfolio-images").replace(/\/$/, "");
// Storage stores this header verbatim, so it must be a full directive.
const CACHE_CONTROL = "max-age=31536000";

const CONTENT_TYPES = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

function requireEnv() {
  const missing = [];
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uploadOne(sourceDir, fileName) {
  // basename() suffix matching is case-sensitive, so strip using the raw extension.
  const rawExtension = extname(fileName);
  const extension = rawExtension.toLowerCase();
  const contentType = CONTENT_TYPES[extension];

  if (!contentType) {
    return { fileName, skipped: true };
  }

  const body = await readFile(join(sourceDir, fileName));
  const objectPath = `${BASE_PATH}/${slugify(basename(fileName, rawExtension))}${extension}`;
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}/${objectPath}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "content-type": contentType,
        "cache-control": CACHE_CONTROL,
        "x-upsert": "true",
      },
      body,
    },
  );

  if (!response.ok) {
    throw new Error(`Upload failed for ${objectPath}: ${response.status} ${await response.text()}`);
  }

  return { fileName, objectPath, skipped: false };
}

async function run() {
  requireEnv();

  const sourceDir = process.argv[2];

  if (!sourceDir) {
    throw new Error("Usage: node scripts/upload-portfolio-images.mjs <source-dir>");
  }

  const fileNames = (await readdir(sourceDir)).sort();
  let uploaded = 0;

  for (const fileName of fileNames) {
    const result = await uploadOne(sourceDir, fileName);

    if (result.skipped) {
      console.log(`skip  ${fileName}`);
      continue;
    }

    uploaded += 1;
    console.log(`ok    ${result.objectPath}`);
  }

  console.log(`\nUploaded ${uploaded} object(s) to ${BUCKET}/${BASE_PATH} with cache-control ${CACHE_CONTROL}.`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
