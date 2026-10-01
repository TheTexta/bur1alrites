import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { assetTarget } from "./worker.mjs";

function bucket() {
  const object = { etag: "revision-one", httpEtag: '"revision-one"', size: 10, uploaded: new Date("2026-09-01T00:00:00Z"), httpMetadata: { cacheControl: "no-cache" }, writeHttpMetadata(headers: Headers) { headers.set("Content-Type", "image/jpeg"); headers.set("Cache-Control", "no-cache"); } };
  return { head: vi.fn(async () => object), get: vi.fn(async (_key: string, options: { range?: { offset: number; length: number } }) => ({ ...object, body: new Response(options.range ? "2345" : "0123456789").body })) };
}
function setup() { return { BUR1ALRITES: bucket(), ELLIOTMAIRET: bucket() }; }
afterEach(() => vi.unstubAllGlobals());

describe("shared asset delivery", () => {
  it("routes project prefixes without changing encoded object keys", () => {
    const env = setup();
    expect(assetTarget(new URL("https://images.dextery.dev/elliotmairet/uploads/photo%20name.jpg"), env)).toEqual({ project: "elliotmairet", key: "uploads/photo name.jpg", bucket: env.ELLIOTMAIRET });
    expect(assetTarget(new URL("https://media.dextery.dev/bur1alrites/portfolio-images/streams/hero/master.m3u8"), env)?.bucket).toBe(env.BUR1ALRITES);
  });
  it.each([
    "https://images.dextery.dev/unknown/uploads/a.jpg",
    "https://media.dextery.dev/elliotmairet/staging/a.jpg",
    "https://images.dextery.dev/bur1alrites/portfolio-images/incoming/a.jpg",
    "https://media.dextery.dev/bur1alrites/secrets/a.txt",
    "https://images.dextery.dev/bur1alrites/portfolio-images/a.mov",
    "https://images.dextery.dev/elliotmairet/uploads/%2Fstaging.jpg",
  ])("rejects unsupported or private asset paths: %s", async url => {
    expect((await worker.fetch(new Request(url), setup())).status).toBe(404);
  });
  it("returns byte ranges with public CORS and original metadata", async () => {
    const env = setup();
    const response = await worker.fetch(new Request("https://media.dextery.dev/bur1alrites/portfolio-images/a.mp4", { headers: { Range: "bytes=2-5" } }), env);
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.text()).toBe("2345");
    expect(env.BUR1ALRITES.get).toHaveBeenCalledWith("portfolio-images/a.mp4", { range: { offset: 2, length: 4 }, onlyIf: { etagMatches: "revision-one" } });
  });
  it("serves migrated byte ranges without inherited proxy compression headers", async () => {
    const env = setup();
    const original = await env.BUR1ALRITES.head();
    env.BUR1ALRITES.head = vi.fn(async () => ({
      ...original,
      customMetadata: { "supabase-fingerprint": "verified-source", sourcesha256: "checksum" },
      writeHttpMetadata(headers: Headers) {
        original.writeHttpMetadata(headers);
        headers.set("Content-Encoding", "gzip");
      },
    }));
    const response = await worker.fetch(new Request("https://media.dextery.dev/bur1alrites/portfolio-images/a.mp4", { headers: { Range: "bytes=2-5", "Accept-Encoding": "identity" } }), env);
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(await response.text()).toBe("2345");
  });
  it("honors ETag revalidation before loading object bodies", async () => {
    const env = setup();
    const response = await worker.fetch(new Request("https://media.dextery.dev/elliotmairet/uploads/a.jpg", { headers: { "If-None-Match": 'W/"revision-one"' } }), env);
    expect(response.status).toBe(304);
    expect(env.ELLIOTMAIRET.get).not.toHaveBeenCalled();
  });
  it("ignores Range when If-Range does not match", async () => {
    const response = await worker.fetch(new Request("https://media.dextery.dev/elliotmairet/uploads/a.jpg", { headers: { Range: "bytes=2-5", "If-Range": '"old"' } }), setup());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("0123456789");
  });
  it("rejects unsatisfiable ranges", async () => {
    const response = await worker.fetch(new Request("https://media.dextery.dev/elliotmairet/uploads/a.jpg", { headers: { Range: "bytes=20-30" } }), setup());
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */10");
  });
  it("answers HEAD and preflight without reading bodies", async () => {
    const env = setup();
    const url = "https://media.dextery.dev/elliotmairet/uploads/a.jpg";
    const response = await worker.fetch(new Request(url, { method: "HEAD" }), env);
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(await response.text()).toBe("");
    expect((await worker.fetch(new Request(url, { method: "OPTIONS" }), env)).status).toBe(204);
    expect(env.ELLIOTMAIRET.get).not.toHaveBeenCalled();
  });
  it("resizes using an ETag-versioned media source and format negotiation", async () => {
    const fetchMock = vi.fn(async (url: URL, options: unknown) => { void url; void options; return new Response("resized", { headers: { "Content-Type": "image/avif" } }); });
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(new Request("https://images.dextery.dev/bur1alrites/portfolio-images/posters/a.jpg?width=960&quality=75&format=auto", { headers: { Accept: "image/avif,image/webp" } }), setup());
    expect(await response.text()).toBe("resized");
    expect(String(fetchMock.mock.calls[0][0])).toContain("media.dextery.dev/bur1alrites/portfolio-images/posters/a.jpg?v=revision-one");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cf: { image: { width: 960, quality: 75, format: "avif" } } });
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Vary")).toBe("Accept");
  });
  it.each(["width=999999", "quality=1", "image=https://external.example/a.jpg", "width=960&width=1080"])("rejects uncontrolled transformations: %s", async query => {
    expect((await worker.fetch(new Request(`https://images.dextery.dev/elliotmairet/uploads/a.jpg?${query}`), setup())).status).toBe(400);
  });
  it("transforms oversized photographs through a verified delivery source while preserving originals", async () => {
    const env = setup();
    const original = await env.ELLIOTMAIRET.head();
    const key = `__image-sources/${"a".repeat(64)}.webp`;
    env.ELLIOTMAIRET.head = vi.fn(async (requested?: string) => requested === key
      ? { ...original, etag: "delivery-two", customMetadata: { sourcesha256: "original-checksum" } }
      : { ...original, customMetadata: { "cf-image-source": key, sourcesha256: "original-checksum" } });
    const fetchMock = vi.fn(async (url: URL) => { void url; return new Response("resized"); });
    vi.stubGlobal("fetch", fetchMock);
    const url = "https://images.dextery.dev/elliotmairet/uploads/a.jpg";
    expect((await worker.fetch(new Request(`${url}?width=640`), env)).status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`https://media.dextery.dev/elliotmairet/${key}?v=delivery-two`);
    const originalResponse = await worker.fetch(new Request(url), env);
    expect(await originalResponse.text()).toBe("0123456789");
    expect(env.ELLIOTMAIRET.get.mock.calls[0][0]).toBe("uploads/a.jpg");
  });
  it("refuses a delivery source with a different original checksum", async () => {
    const env = setup();
    const original = await env.ELLIOTMAIRET.head();
    const key = `__image-sources/${"a".repeat(64)}.webp`;
    env.ELLIOTMAIRET.head = vi.fn(async (requested?: string) => requested === key
      ? { ...original, customMetadata: { sourcesha256: "wrong" } }
      : { ...original, customMetadata: { "cf-image-source": key, sourcesha256: "expected" } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await worker.fetch(new Request("https://images.dextery.dev/elliotmairet/uploads/a.jpg?width=640"), env)).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("revalidates transformed variants and gives different formats distinct validators", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("resized", { headers: { "Content-Type": "image/webp", "Content-Length": "7" } })));
    const url = "https://images.dextery.dev/elliotmairet/uploads/a.jpg?width=960&format=auto";
    const first = await worker.fetch(new Request(url, { headers: { Accept: "image/webp" } }), setup());
    const etag = first.headers.get("ETag")!;
    const revalidated = await worker.fetch(new Request(url, { headers: { Accept: "image/webp", "If-None-Match": etag } }), setup());
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("Content-Length")).toBeNull();
    expect(await revalidated.text()).toBe("");
    const other = await worker.fetch(new Request(url, { headers: { Accept: "image/avif", "If-None-Match": etag } }), setup());
    expect(other.status).toBe(200);
    expect(other.headers.get("ETag")).not.toBe(etag);
  });
});
