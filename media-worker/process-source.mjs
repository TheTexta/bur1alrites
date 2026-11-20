import { basename, extname, join, relative } from "node:path";
import { sourceVersion } from "./r2.mjs";

const VERSIONED_CACHE_CONTROL = "public, max-age=31536000, immutable";
const CURRENT_CACHE_CONTROL = "no-cache";
const HLS_MANIFEST_MIME_TYPE = "application/vnd.apple.mpegurl";
const VARIANT_PROFILES = [
  { id: "540p", shortSide: 540, bitrate: 1_000_000, maxRate: 1_250_000 },
  { id: "720p", shortSide: 720, bitrate: 2_300_000, maxRate: 2_900_000 },
  { id: "1080p", shortSide: 1080, bitrate: 5_000_000, maxRate: 6_500_000 },
];

function even(value) {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function buildVariants(video) {
  const sourceShortSide = Math.min(video.width, video.height);
  const availableProfiles = VARIANT_PROFILES.filter(profile => profile.shortSide <= sourceShortSide);
  const profiles = availableProfiles.length > 0 ? availableProfiles
    : [{ id: "source", shortSide: even(sourceShortSide), bitrate: 1_000_000, maxRate: 1_250_000 }];
  return profiles.map(profile => {
    const landscape = video.width >= video.height;
    const scale = profile.shortSide / sourceShortSide;
    return {
      ...profile,
      width: landscape ? even(video.width * scale) : even(profile.shortSide),
      height: landscape ? even(profile.shortSide) : even(video.height * scale),
    };
  });
}

function contentTypeFor(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".m3u8": return HLS_MANIFEST_MIME_TYPE;
    case ".m4s":
    case ".mp4": return "video/mp4";
    case ".webp": return "image/webp";
    default: throw new Error(`Unsupported generated file: ${filePath}`);
  }
}

export function sourceSlug(sourceName) {
  return basename(sourceName, extname(sourceName)).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function buildMasterPlaylist(variants, version, frameRate) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"];
  for (const variant of variants) {
    const averageBandwidth = Math.round(variant.bitrate * 0.92);
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${variant.maxRate},AVERAGE-BANDWIDTH=${averageBandwidth},CODECS="avc1.640028",RESOLUTION=${variant.width}x${variant.height},FRAME-RATE=${frameRate.toFixed(3)}`,
      `${version}/${variant.id}/index.m3u8`,
    );
  }
  return `${lines.join("\n")}\n`;
}

// Importing this module does not load environment files, start a poller, or perform IO.
// Production supplies real effects; offline tests supply an in-memory adapter.
export function createSourceProcessor({
  headObject, readObjectIfPresent, downloadObject, uploadObject, updateCatalogStatus,
  inspectVideo, encodeVariant, createPoster, statfs, tmpdir, mkdtemp, mkdir,
  listFiles, readFile, rm, log,
}, { sourcePrefix = "portfolio-images" } = {}) {
  return async function processSource(source) {
    const slug = sourceSlug(source.name);
    try {
      const sourceMetadata = await headObject(source.name);
      if (!sourceMetadata) return;
      const version = sourceVersion({ ...source, ...sourceMetadata });
      const basePath = `${sourcePrefix}/streams/${slug}`;
      const masterPath = `${basePath}/master.m3u8`;
      const currentMaster = await readObjectIfPresent(masterPath);
      if (currentMaster?.toString("utf8").includes(`${version}/`)) {
        await updateCatalogStatus(slug, "published");
        log(`skip  ${source.name} (${version} already published)`);
        return;
      }

      log(`start ${source.name} (${version})`);
      await updateCatalogStatus(slug, "processing");
      const sourceBytes = Number(source.metadata?.size ?? 0);
      if (sourceBytes > 0) {
        const { bavail, bsize } = await statfs(tmpdir());
        const freeBytes = bavail * bsize;
        const requiredBytes = sourceBytes + 2 * 1024 * 1024 * 1024;
        if (freeBytes < requiredBytes) {
          throw new Error(`Insufficient temporary disk for ${source.name}: ${Math.ceil(freeBytes / 1024 ** 3)} GiB free, ${Math.ceil(requiredBytes / 1024 ** 3)} GiB needed.`);
        }
      }
      const workDirectory = await mkdtemp(join(tmpdir(), "bur1alrites-hls-"));
      try {
        const sourcePath = join(workDirectory, `source${extname(source.name).toLowerCase()}`);
        await downloadObject(source.name, sourcePath);
        const video = await inspectVideo(sourcePath);
        const variants = buildVariants(video);
        const versionPath = `${basePath}/${version}`;
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
          await uploadObject(`${versionPath}/${relativePath}`, await readFile(filePath), contentTypeFor(filePath), VERSIONED_CACHE_CONTROL);
        }
        await uploadObject(`${sourcePrefix}/posters/${slug}.jpg`, await readFile(posterPath), "image/jpeg", CURRENT_CACHE_CONTROL);
        await uploadObject(masterPath, Buffer.from(buildMasterPlaylist(variants, version, video.frameRate), "utf8"), HLS_MANIFEST_MIME_TYPE, CURRENT_CACHE_CONTROL);
        await updateCatalogStatus(slug, "published");
        log(`done  ${source.name} (${variants.map(({ id }) => id).join(", ")})`);
      } finally {
        await rm(workDirectory, { force: true, recursive: true });
      }
    } catch (error) {
      try {
        await updateCatalogStatus(slug, "failed", String(error.message ?? error));
      } catch (statusError) {
        log(`failed to update catalog for ${source.name}`, statusError);
      }
      throw error;
    }
  };
}
