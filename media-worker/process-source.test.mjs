import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createSourceProcessor } from "./process-source.mjs";

const source = {
  name: "portfolio-images/My Clip.MOV", Key: "portfolio-images/My Clip.MOV",
  ETag: '"original"', LastModified: new Date("2026-01-01T00:00:00Z"), metadata: { size: 1024 },
};
const version = createHash("sha256").update([source.Key, source.ETag, source.LastModified.toISOString()].join(":"))
  .digest("hex").slice(0, 12);
const master = "portfolio-images/streams/my-clip/master.m3u8";

function fixture({ metadata = {}, current = null, video = { width: 1920, height: 1080, frameRate: 29.97 } } = {}) {
  const files = new Map();
  const events = [];
  const effects = {
    headObject: vi.fn(async () => metadata),
    readObjectIfPresent: vi.fn(async () => current),
    downloadObject: vi.fn(async (key, path) => { files.set(path, Buffer.from("archival bytes")); events.push(["download", key]); }),
    uploadObject: vi.fn(async (key, body, contentType, cacheControl) => { events.push(["upload", key, body, contentType, cacheControl]); }),
    updateCatalogStatus: vi.fn(async (slug, status, error) => { events.push(["status", slug, status, error]); }),
    inspectVideo: vi.fn(async () => video),
    encodeVariant: vi.fn(async (_source, directory, variant) => {
      for (const name of ["init.mp4", "segment-000.m4s", "index.m3u8"]) files.set(`${directory}/${name}`, Buffer.from(`${variant.id}/${name}`));
    }),
    createPoster: vi.fn(async (_source, path) => { files.set(path, Buffer.from("poster")); }),
    statfs: vi.fn(async () => ({ bavail: 10 * 1024 ** 3, bsize: 1 })),
    tmpdir: () => "/fake-temp",
    mkdtemp: vi.fn(async () => "/fake-temp/work"),
    mkdir: vi.fn(async () => {}),
    listFiles: vi.fn(async () => [...files.keys()]),
    readFile: vi.fn(async path => files.get(path)),
    rm: vi.fn(async () => {}),
    log: vi.fn(),
  };
  return { effects, events, process: createSourceProcessor(effects), files };
}

describe("importable source processing operation", () => {
  it("imports without loading environment files, starting a process, or making requests", async () => {
    vi.resetModules();
    const loadEnv = vi.spyOn(process, "loadEnvFile").mockImplementation(() => { throw new Error("environment read"); });
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    try {
      const imported = await import("./process-source.mjs");
      expect(imported.createSourceProcessor).toBeTypeOf("function");
      expect(loadEnv).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      loadEnv.mockRestore();
      fetch.mockRestore();
    }
  });

  it.each([version, "migrated-fingerprint"])("reuses the exact current fingerprint %s without download, encoding, disk or upload", async fingerprint => {
    const f = fixture({ metadata: fingerprint === version ? {} : { Metadata: { "hls-source-version": fingerprint } }, current: Buffer.from(`#EXTM3U\n${fingerprint}/540p/index.m3u8\n`) });
    await f.process(source);
    expect(f.effects.updateCatalogStatus).toHaveBeenCalledExactlyOnceWith("my-clip", "published");
    for (const effect of ["downloadObject", "encodeVariant", "mkdtemp", "statfs", "uploadObject", "rm"]) expect(f.effects[effect]).not.toHaveBeenCalled();
  });

  it("publishes immutable variants before poster, stable master and success, without overwriting the original", async () => {
    const f = fixture();
    await f.process(source);
    const uploads = f.events.filter(([kind]) => kind === "upload");
    expect(uploads).toHaveLength(11);
    expect(uploads.slice(0, 9).every(([, key, , , cache]) => key.startsWith(`portfolio-images/streams/my-clip/${version}/`) && cache === "public, max-age=31536000, immutable")).toBe(true);
    expect(uploads.slice(-2).map(([, key]) => key)).toEqual(["portfolio-images/posters/my-clip.jpg", master]);
    expect(uploads.at(-1)[2].toString()).toBe([
      "#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS",
      '#EXT-X-STREAM-INF:BANDWIDTH=1250000,AVERAGE-BANDWIDTH=920000,CODECS="avc1.640028",RESOLUTION=960x540,FRAME-RATE=29.970', `${version}/540p/index.m3u8`,
      '#EXT-X-STREAM-INF:BANDWIDTH=2900000,AVERAGE-BANDWIDTH=2116000,CODECS="avc1.640028",RESOLUTION=1280x720,FRAME-RATE=29.970', `${version}/720p/index.m3u8`,
      '#EXT-X-STREAM-INF:BANDWIDTH=6500000,AVERAGE-BANDWIDTH=4600000,CODECS="avc1.640028",RESOLUTION=1920x1080,FRAME-RATE=29.970', `${version}/1080p/index.m3u8`, "",
    ].join("\n"));
    expect(uploads.at(-1).slice(3)).toEqual(["application/vnd.apple.mpegurl", "no-cache"]);
    expect(f.events.at(-1)).toEqual(["status", "my-clip", "published", undefined]);
    expect(uploads.some(([, key]) => key === source.name)).toBe(false);
    expect(f.effects.rm).toHaveBeenCalledExactlyOnceWith("/fake-temp/work", { force: true, recursive: true });
  });

  it.each([
    [{ width: 1080, height: 1920, frameRate: 24 }, [[540, 960], [720, 1280], [1080, 1920]]],
    [{ width: 321, height: 241, frameRate: 30 }, [[318, 240]]],
  ])("preserves portrait and small-source variant selection (%j)", async (video, dimensions) => {
    const f = fixture({ video });
    await f.process(source);
    expect(f.effects.encodeVariant.mock.calls.map(([, , { width, height }]) => [width, height])).toEqual(dimensions);
    expect(f.effects.encodeVariant.mock.calls.map(([, , variant]) => variant.id)).toEqual(dimensions.length === 1 ? ["source"] : ["540p", "720p", "1080p"]);
  });

  it.each(["downloadObject", "inspectVideo", "encodeVariant", "createPoster", "listFiles", "readFile"])("cleans temporary files and records failure when %s fails", async effect => {
    const f = fixture();
    f.effects[effect].mockRejectedValue(new Error("injected failure"));
    await expect(f.process(source)).rejects.toThrow("injected failure");
    expect(f.effects.rm).toHaveBeenCalledOnce();
    expect(f.effects.updateCatalogStatus).toHaveBeenLastCalledWith("my-clip", "failed", "injected failure");
    expect(f.events.some(([kind, , status]) => kind === "status" && status === "published")).toBe(false);
    expect(f.events.some(([kind, key]) => kind === "upload" && key === master)).toBe(false);
  });

  it.each([1, 5, 10, 11])("never reports success after upload %i fails", async failedUpload => {
    const f = fixture();
    let count = 0;
    f.effects.uploadObject.mockImplementation(async (key) => {
      if (++count === failedUpload) throw new Error("upload failed");
      f.events.push(["upload", key]);
    });
    await expect(f.process(source)).rejects.toThrow("upload failed");
    expect(f.effects.updateCatalogStatus).not.toHaveBeenCalledWith("my-clip", "published");
    expect(f.events.some(([kind, key]) => kind === "upload" && key === master)).toBe(false);
    expect(f.effects.rm).toHaveBeenCalledOnce();
  });

  it("fails before allocating temp files when disk is insufficient, and skips disappeared sources", async () => {
    const f = fixture();
    f.effects.statfs.mockResolvedValue({ bavail: 10, bsize: 1 });
    await expect(f.process(source)).rejects.toThrow("Insufficient temporary disk");
    expect(f.effects.mkdtemp).not.toHaveBeenCalled();
    expect(f.effects.uploadObject).not.toHaveBeenCalled();
    f.effects.headObject.mockResolvedValue(null);
    f.effects.updateCatalogStatus.mockClear();
    await f.process(source);
    expect(f.effects.updateCatalogStatus).not.toHaveBeenCalled();
  });
});
