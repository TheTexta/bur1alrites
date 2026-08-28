import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative } from "node:path";
import { spawn } from "node:child_process";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BUCKET = process.env.SUPABASE_PORTFOLIO_BUCKET ?? "bur1alrites";
const SOURCE_PREFIX = (process.env.HLS_SOURCE_PREFIX ?? "portfolio-images")
  .replace(/^\/+|\/+$/g, "");
const POLL_INTERVAL_SECONDS = positiveInteger(
  process.env.HLS_POLL_INTERVAL_SECONDS,
  300,
);
const HLS_SEGMENT_SECONDS = positiveInteger(
  process.env.HLS_SEGMENT_SECONDS,
  4,
);
const HLS_PRESET = process.env.HLS_FFMPEG_PRESET ?? "slow";
const SOURCE_OBJECT_FILTER = process.env.HLS_SOURCE_OBJECT?.trim() ?? "";
const RUN_ONCE = process.argv.includes("--once");
const CATALOG_ENABLED = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

const VERSIONED_CACHE_CONTROL = "public, max-age=31536000, immutable";
const CURRENT_CACHE_CONTROL = "no-cache";
const HLS_MANIFEST_MIME_TYPE = "application/vnd.apple.mpegurl";
const HLS_REQUIRED_MIME_TYPES = new Set([
  HLS_MANIFEST_MIME_TYPE,
  "video/mp4",
]);

const VARIANT_PROFILES = [
  { id: "540p", shortSide: 540, bitrate: 1_000_000, maxRate: 1_250_000 },
  { id: "720p", shortSide: 720, bitrate: 2_300_000, maxRate: 2_900_000 },
  { id: "1080p", shortSide: 1080, bitrate: 5_000_000, maxRate: 6_500_000 },
];

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requireConfiguration() {
  const missing = [];

  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function authHeaders() {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  };
}

function encodeStoragePath(value) {
  return value
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function storageUrl(path) {
  return `${SUPABASE_URL}/storage/v1${path}`;
}

function objectPathUrl(objectPath) {
  return storageUrl(
    `/object/${encodeURIComponent(BUCKET)}/${encodeStoragePath(objectPath)}`,
  );
}

async function storageRequest(path, init = {}) {
  const response = await fetch(storageUrl(path), {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });

  return response;
}

async function catalogRequest(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function updateCatalogStatus(slug, status, processingError = null) {
  if (!CATALOG_ENABLED) return;

  const response = await catalogRequest(
    `gallery_items?slug=eq.${encodeURIComponent(slug)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status, processing_error: processingError }),
    },
  );

  if (!response.ok) {
    throw new Error(`Could not update catalog status for ${slug}: ${await responseText(response)}`);
  }
}

async function responseText(response) {
  const text = await response.text();
  return text.trim() || response.statusText;
}

async function listObjects(prefix) {
  const response = await storageRequest(`/object/list/${encodeURIComponent(BUCKET)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prefix,
      limit: 1000,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    }),
  });

  if (!response.ok) {
    throw new Error(`Could not list storage objects: ${await responseText(response)}`);
  }

  const objects = await response.json();
  const normalizedPrefix = prefix.replace(/\/+$/, "");

  return objects.map((object) => ({
    ...object,
    name: object.name.startsWith(`${normalizedPrefix}/`)
      ? object.name
      : `${normalizedPrefix}/${object.name}`,
  }));
}

async function readObject(objectPath) {
  const response = await fetch(objectPathUrl(objectPath), {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Could not read ${objectPath}: ${await responseText(response)}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function readObjectIfPresent(objectPath) {
  const response = await fetch(objectPathUrl(objectPath), {
    headers: authHeaders(),
  });

  if (response.ok) {
    return Buffer.from(await response.arrayBuffer());
  }

  if (response.status === 400 || response.status === 404) {
    return null;
  }

  throw new Error(`Could not read ${objectPath}: ${await responseText(response)}`);
}

async function uploadObject(objectPath, body, contentType, cacheControl) {
  const response = await fetch(objectPathUrl(objectPath), {
    method: "POST",
    headers: {
      ...authHeaders(),
      "content-type": contentType,
      "cache-control": cacheControl,
      "x-upsert": "true",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Could not upload ${objectPath}: ${await responseText(response)}`);
  }
}

async function ensureHlsMimeTypes() {
  const bucketResponse = await storageRequest(`/bucket/${encodeURIComponent(BUCKET)}`);

  if (!bucketResponse.ok) {
    throw new Error(`Could not read bucket settings: ${await responseText(bucketResponse)}`);
  }

  const bucket = await bucketResponse.json();
  const allowedMimeTypes = new Set(bucket.allowed_mime_types ?? []);
  let changed = false;

  for (const mimeType of HLS_REQUIRED_MIME_TYPES) {
    if (!allowedMimeTypes.has(mimeType)) {
      allowedMimeTypes.add(mimeType);
      changed = true;
    }
  }

  if (!changed) return;

  const updateResponse = await storageRequest(`/bucket/${encodeURIComponent(BUCKET)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      public: bucket.public,
      file_size_limit: bucket.file_size_limit,
      allowed_mime_types: [...allowedMimeTypes],
    }),
  });

  if (!updateResponse.ok) {
    throw new Error(`Could not enable HLS MIME types: ${await responseText(updateResponse)}`);
  }

  console.log(`Enabled HLS MIME types for ${BUCKET}.`);
}

function command(commandName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8_000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${commandName} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

function commandOutput(commandName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8_000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`${commandName} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

function parseFraction(value) {
  const [numerator, denominator] = String(value ?? "0/1").split("/").map(Number);

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 30;
  }

  return numerator / denominator;
}

async function inspectVideo(filePath) {
  const output = await commandOutput("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate",
    "-of",
    "json",
    filePath,
  ]);
  const metadata = JSON.parse(output);
  const stream = metadata.streams?.[0];

  if (!stream?.width || !stream?.height) {
    throw new Error(`No video stream found in ${filePath}.`);
  }

  return {
    width: Number(stream.width),
    height: Number(stream.height),
    frameRate: parseFraction(stream.r_frame_rate),
  };
}

function even(value) {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function buildVariants(video) {
  const sourceShortSide = Math.min(video.width, video.height);
  const availableProfiles = VARIANT_PROFILES.filter(
    (profile) => profile.shortSide <= sourceShortSide,
  );
  const profiles = availableProfiles.length > 0
    ? availableProfiles
    : [{ id: "source", shortSide: even(sourceShortSide), bitrate: 1_000_000, maxRate: 1_250_000 }];

  return profiles.map((profile) => {
    const landscape = video.width >= video.height;
    const scale = profile.shortSide / sourceShortSide;
    const width = landscape ? even(video.width * scale) : even(profile.shortSide);
    const height = landscape ? even(profile.shortSide) : even(video.height * scale);

    return {
      ...profile,
      width,
      height,
    };
  });
}

async function encodeVariant(sourcePath, outputDirectory, variant, frameRate) {
  const playlistPath = join(outputDirectory, "index.m3u8");
  const keyFrameInterval = Math.max(1, Math.round(frameRate * HLS_SEGMENT_SECONDS));

  await command("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    sourcePath,
    "-map",
    "0:v:0",
    "-an",
    "-vf",
    `scale=${variant.width}:${variant.height}:flags=lanczos`,
    "-c:v",
    "libx264",
    "-preset",
    HLS_PRESET,
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "21",
    "-b:v",
    String(variant.bitrate),
    "-maxrate",
    String(variant.maxRate),
    "-bufsize",
    String(variant.maxRate * 2),
    "-g",
    String(keyFrameInterval),
    "-keyint_min",
    String(keyFrameInterval),
    "-sc_threshold",
    "0",
    "-force_key_frames",
    `expr:gte(t,n_forced*${HLS_SEGMENT_SECONDS})`,
    "-f",
    "hls",
    "-hls_time",
    String(HLS_SEGMENT_SECONDS),
    "-hls_playlist_type",
    "vod",
    "-hls_flags",
    "independent_segments",
    "-hls_segment_type",
    "fmp4",
    "-hls_fmp4_init_filename",
    "init.mp4",
    "-hls_segment_filename",
    join(outputDirectory, "segment-%03d.m4s"),
    playlistPath,
  ]);
}

async function createPoster(sourcePath, posterPath, video) {
  const posterShortSide = Math.min(960, Math.min(video.width, video.height));
  const landscape = video.width >= video.height;
  const scale = posterShortSide / Math.min(video.width, video.height);
  const width = landscape ? even(video.width * scale) : even(posterShortSide);
  const height = landscape ? even(posterShortSide) : even(video.height * scale);

  await command("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    "0.5",
    "-i",
    sourcePath,
    "-frames:v",
    "1",
    "-vf",
    `scale=${width}:${height}:flags=lanczos`,
    "-c:v",
    "mjpeg",
    "-q:v",
    "3",
    posterPath,
  ]);
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function contentTypeFor(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".m3u8":
      return HLS_MANIFEST_MIME_TYPE;
    case ".m4s":
    case ".mp4":
      return "video/mp4";
    case ".webp":
      return "image/webp";
    default:
      throw new Error(`Unsupported generated file: ${filePath}`);
  }
}

function sourceVersion(source) {
  const fingerprint = [
    source.name,
    source.metadata?.eTag,
    source.updated_at,
  ].join(":");

  return createHash("sha256").update(fingerprint).digest("hex").slice(0, 12);
}

function sourceSlug(sourceName) {
  return basename(sourceName, extname(sourceName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function streamBasePath(slug) {
  return `${SOURCE_PREFIX}/streams/${slug}`;
}

function currentMasterPath(slug) {
  return `${streamBasePath(slug)}/master.m3u8`;
}

function currentPosterPath(slug) {
  return `${SOURCE_PREFIX}/posters/${slug}.jpg`;
}

function buildMasterPlaylist(variants, version, frameRate) {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-INDEPENDENT-SEGMENTS",
  ];

  for (const variant of variants) {
    const averageBandwidth = Math.round(variant.bitrate * 0.92);
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${variant.maxRate},AVERAGE-BANDWIDTH=${averageBandwidth},CODECS="avc1.640028",RESOLUTION=${variant.width}x${variant.height},FRAME-RATE=${frameRate.toFixed(3)}`,
      `${version}/${variant.id}/index.m3u8`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function currentMasterIncludes(masterPath, version) {
  const content = await readObjectIfPresent(masterPath);
  return content?.toString("utf8").includes(`${version}/`) ?? false;
}

async function processSource(source) {
  const slug = sourceSlug(source.name);
  const version = sourceVersion(source);
  const masterPath = currentMasterPath(slug);

  if (await currentMasterIncludes(masterPath, version)) {
    console.log(`skip  ${source.name} (${version} already published)`);
    return;
  }

  console.log(`start ${source.name} (${version})`);
  await updateCatalogStatus(slug, "processing");
  const workDirectory = await mkdtemp(join(tmpdir(), "bur1alrites-hls-"));

  try {
    const sourcePath = join(workDirectory, "source.mov");
    await writeFile(sourcePath, await readObject(source.name));

    const video = await inspectVideo(sourcePath);
    const variants = buildVariants(video);
    const versionPath = `${streamBasePath(slug)}/${version}`;

    for (const variant of variants) {
      const variantDirectory = join(workDirectory, variant.id);
      await mkdir(variantDirectory, { recursive: true });
      await encodeVariant(sourcePath, variantDirectory, variant, video.frameRate);
    }

    const posterPath = join(workDirectory, "poster.jpg");
    await createPoster(sourcePath, posterPath, video);

    for (const filePath of await listFiles(workDirectory)) {
      if (filePath === sourcePath || filePath === posterPath) continue;

      const relativePath = relative(workDirectory, filePath).replaceAll("\\", "/");
      await uploadObject(
        `${versionPath}/${relativePath}`,
        await readFile(filePath),
        contentTypeFor(filePath),
        VERSIONED_CACHE_CONTROL,
      );
    }

    await uploadObject(
      currentPosterPath(slug),
      await readFile(posterPath),
      "image/jpeg",
      CURRENT_CACHE_CONTROL,
    );
    await uploadObject(
      masterPath,
      Buffer.from(buildMasterPlaylist(variants, version, video.frameRate), "utf8"),
      HLS_MANIFEST_MIME_TYPE,
      CURRENT_CACHE_CONTROL,
    );

    await updateCatalogStatus(slug, "published");

    console.log(`done  ${source.name} (${variants.map(({ id }) => id).join(", ")})`);
  } finally {
    await rm(workDirectory, { force: true, recursive: true });
  }
}

function isSourceMov(source) {
  const relativePath = source.name?.slice(`${SOURCE_PREFIX}/`.length) ?? "";
  return (
    source.name?.startsWith(`${SOURCE_PREFIX}/`) &&
    !relativePath.includes("/") &&
    extname(source.name).toLowerCase() === ".mov"
  );
}

async function runCycle() {
  await ensureHlsMimeTypes();
  const objects = await listObjects(`${SOURCE_PREFIX}/`);
  const sources = objects
    .filter(isSourceMov)
    .filter(
      (source) =>
        !SOURCE_OBJECT_FILTER ||
        source.name === `${SOURCE_PREFIX}/${SOURCE_OBJECT_FILTER.replace(/^\/+/, "")}`,
    );

  console.log(`Scanning ${sources.length} MOV master${sources.length === 1 ? "" : "s"}.`);

  for (const source of sources) {
    try {
      await processSource(source);
    } catch (error) {
      console.error(`failed ${source.name}`, error);
      try {
        await updateCatalogStatus(sourceSlug(source.name), "failed", String(error.message ?? error));
      } catch (statusError) {
        console.error(`failed to update catalog for ${source.name}`, statusError);
      }
    }
  }
}

async function main() {
  requireConfiguration();

  do {
    await runCycle();

    if (!RUN_ONCE) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_SECONDS * 1_000));
    }
  } while (!RUN_ONCE);
}

main().catch((error) => {
  console.error("HLS worker failed to start.", error);
  process.exit(1);
});
