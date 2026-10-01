import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { inventory, fingerprint, hlsSourceVersion, hashBody, orderMigrationObjects, decodedObjectHeaders } from "./storage-migration.mjs";
import { listObjects, sourceVersion } from "../../media-worker/r2.mjs";

describe("migration reconciliation", () => {
  it("stores decoded bytes without their proxy transport encoding", async () => {
    const original = Buffer.from("original video bytes");
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "video/mp4", "Content-Encoding": "gzip", "Cache-Control": "public, max-age=31536000, immutable" });
      response.end(gzipSync(original));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address");
      const response = await fetch(`http://127.0.0.1:${address.port}`);
      expect(response.headers.get("Content-Encoding")).toBe("gzip");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(original);
      expect(decodedObjectHeaders(response.headers)).toEqual({ ContentType: "video/mp4", CacheControl: "public, max-age=31536000, immutable" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
  it("paginates full source listings, descends folders, and excludes incoming uploads", async () => {
    const request = vi.fn(async (_path: string, init: RequestInit) => {
      const { prefix, offset } = JSON.parse(init.body as string);
      const page = prefix === "photos" ? [{ id: "photo", name: "image.jpg", metadata: { size: 3 } }]
        : offset === 0 ? [...Array.from({ length: 499 }, (_, n) => ({ id: String(n), name: `${n}.jpg`, metadata: { size: 1 } })), { name: "photos", id: null, metadata: null }]
        : [{ id: "last", name: "last.jpg", metadata: { size: 2 } }, { name: "incoming", id: null, metadata: null }];
      return Response.json(page);
    });
    const objects = await inventory(request, "bur1alrites");
    expect(objects).toHaveLength(501);
    expect(objects.some((object: { name: string }) => object.name === "photos/image.jpg")).toBe(true);
    expect(request.mock.calls.map(call => JSON.parse(call[1].body as string))).toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: "", offset: 500 }),
      expect.objectContaining({ prefix: "photos", offset: 0 }),
    ]));
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("keeps original HLS versions even when copied objects have new R2 ETags", () => {
    const source = { name: "portfolio-images/hero.mov", metadata: { eTag: '"supabase-etag"', size: 42 }, updated_at: "2026-09-01T00:00:00.000Z" };
    const original = createHash("sha256").update([source.name, source.metadata.eTag, source.updated_at].join(":")).digest("hex").slice(0, 12);
    const copied = { Key: source.name, ETag: '"r2-etag"', LastModified: new Date(), Metadata: { "hls-source-version": hlsSourceVersion(source) } };
    expect(sourceVersion(copied)).toBe(original);
    expect(fingerprint({ ...source, metadata: { ...source.metadata, eTag: "changed" } })).not.toBe(fingerprint(source));
    expect(sourceVersion({ ...copied, Metadata: undefined })).not.toBe(sourceVersion({ ...copied, Metadata: undefined, ETag: "replacement" }));
  });
  it("publishes stable manifests last and detects changed streamed bytes", async () => {
    expect(orderMigrationObjects([{ name: "streams/hero/master.m3u8" }, { name: "streams/hero/version/segment.m4s" }])[1].name).toBe("streams/hero/master.m3u8");
    const original = await hashBody(Readable.from([Buffer.from("abc"), Buffer.from("def")]));
    const changed = await hashBody(Readable.from([Buffer.from("abcdeg")]));
    expect(original).toEqual({ sha256: createHash("sha256").update("abcdef").digest("hex"), bytes: 6 });
    expect(changed.sha256).not.toBe(original.sha256);
  });
  it("follows R2 continuation tokens and refuses an incomplete listing", async () => {
    const send = vi.fn().mockResolvedValueOnce({ Contents: [{ Key: "a" }], IsTruncated: true, NextContinuationToken: "next-page" }).mockResolvedValueOnce({ Contents: [{ Key: "b" }], IsTruncated: false });
    expect(await listObjects("portfolio-images/", { send }, "bur1alrites")).toEqual([{ Key: "a" }, { Key: "b" }]);
    expect(send.mock.calls[1][0].input.ContinuationToken).toBe("next-page");
    send.mockResolvedValueOnce({ IsTruncated: true });
    await expect(listObjects("portfolio-images/", { send }, "bur1alrites")).rejects.toThrow("continuation token");
  });
});
