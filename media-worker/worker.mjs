import { r2Configuration, listObjects as listR2Objects, headObject, getObject, putObject, deleteObject } from "./r2.mjs";
import { createSourceProcessor } from "./process-source.mjs";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

for (const path of [".env", ".env.local"]) {
  try { process.loadEnvFile(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
}

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

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

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requireConfiguration() {
  const missing = [];

  r2Configuration();
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
    `gallery_items?slug=eq.${encodeURIComponent(slug)}&status=neq.archived`,
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
  return (await listR2Objects(prefix)).map(object => ({
    ...object, name: object.Key, updated_at: object.LastModified?.toISOString(),
    metadata: { size: object.Size, eTag: object.ETag },
  }));
}

async function removeAbandonedUploads() {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  for (const object of await listObjects(`${SOURCE_PREFIX}/incoming/`)) {
    if (!object.LastModified || object.LastModified.getTime() >= cutoff) continue;
    const info = await headObject(object.name);
    const sessionId = info?.Metadata?.["upload-session-id"];
    // Only clean a reserved record when this upload never reached its final key.
    if (sessionId && info.Metadata?.["destination-key"] && !(await headObject(info.Metadata["destination-key"]))) {
      const response = await catalogRequest(`gallery_items?upload_session_id=eq.${encodeURIComponent(sessionId)}&status=eq.processing`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not clean an abandoned gallery reservation.");
    }
    await deleteObject(object.name);
    console.log(`Removed abandoned upload ${object.name}.`);
  }
}

async function downloadObject(objectPath, destinationPath) {
  const object = await getObject(objectPath);
  if (!object.Body) throw new Error(`Could not stream ${objectPath}: empty response body.`);
  await pipeline(object.Body, createWriteStream(destinationPath));
}

async function readObjectIfPresent(objectPath) {
  try {
    const object = await getObject(objectPath);
    return Buffer.from(await object.Body.transformToByteArray());
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

async function uploadObject(objectPath, body, contentType, cacheControl) {
  await putObject(objectPath, body, contentType, cacheControl);
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

const processSource = createSourceProcessor({
  headObject, readObjectIfPresent, downloadObject, uploadObject, updateCatalogStatus,
  inspectVideo, encodeVariant, createPoster, statfs, tmpdir, mkdtemp, mkdir,
  listFiles, readFile, rm, log: (...args) => console.log(...args),
}, { sourcePrefix: SOURCE_PREFIX });

function isSourceVideo(source) {
  const relativePath = source.name?.slice(`${SOURCE_PREFIX}/`.length) ?? "";
  return (
    source.name?.startsWith(`${SOURCE_PREFIX}/`) &&
    !relativePath.includes("/") &&
    [".mov", ".mp4"].includes(extname(source.name).toLowerCase())
  );
}

async function runCycle() {
  await removeAbandonedUploads().catch((error) => {
    console.error("Could not clean up abandoned uploads.", error);
  });
  const objects = await listObjects(`${SOURCE_PREFIX}/`);
  const sources = objects
    .filter(isSourceVideo)
    .filter(
      (source) =>
        !SOURCE_OBJECT_FILTER ||
        source.name === `${SOURCE_PREFIX}/${SOURCE_OBJECT_FILTER.replace(/^\/+/, "")}`,
    );

  console.log(`Scanning ${sources.length} video master${sources.length === 1 ? "" : "s"}.`);

  for (const source of sources) {
    try {
      await processSource(source);
    } catch (error) {
      console.error(`failed ${source.name}`, error);
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
