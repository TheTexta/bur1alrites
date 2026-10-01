const WIDTHS = new Set([64, 96, 128, 160, 192, 220, 256, 320, 384, 448, 480, 512, 640, 750, 768, 828, 960, 1080, 1200, 1600, 1920, 2048, 2560, 3200, 3840, 5120]);
const QUALITIES = new Set([60, 72, 74, 75, 82]);
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|avif|gif)$/i;

function cors(response, head = false) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Range, If-None-Match, If-Modified-Since, If-Range");
  headers.set("Access-Control-Expose-Headers", "ETag, Content-Length, Content-Range, Accept-Ranges");
  headers.set("X-Content-Type-Options", "nosniff");
  if (head) response.body?.cancel().catch(() => {});
  return new Response(head ? null : response.body, { status: response.status, headers });
}

export function assetTarget(url, env) {
  if (!["images.dextery.dev", "media.dextery.dev"].includes(url.hostname)) return null;
  let segments;
  try { segments = url.pathname.split("/").slice(1).map(decodeURIComponent); } catch { return null; }
  const project = segments.shift();
  if (!segments.length || segments.some(segment => !segment || segment === "." || segment === ".." || /[\\/\u0000]/.test(segment))) return null;
  const key = segments.join("/");
  const bucket = project === "bur1alrites" ? env.BUR1ALRITES : project === "elliotmairet" ? env.ELLIOTMAIRET : null;
  if (!bucket || key.startsWith("staging/") || /(^|\/)incoming(\/|$)/.test(key)) return null;
  if (project === "bur1alrites" && !key.startsWith("portfolio-images/")) return null;
  if (url.hostname === "images.dextery.dev" && !IMAGE_EXTENSIONS.test(key)) return null;
  return { bucket, key, project };
}

function imageOptions(url, accept) {
  const allowed = new Set(["width", "quality", "format"]);
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new Error("Invalid image options.");
  const width = url.searchParams.has("width") ? Number(url.searchParams.get("width")) : undefined;
  const quality = url.searchParams.has("quality") ? Number(url.searchParams.get("quality")) : 75;
  if ((width !== undefined && !WIDTHS.has(width)) || !QUALITIES.has(quality) || (url.searchParams.has("format") && url.searchParams.get("format") !== "auto")) throw new Error("Invalid image options.");
  const format = accept.includes("image/avif") ? "avif" : accept.includes("image/webp") ? "webp" : undefined;
  return { width, quality, format, fit: "scale-down", metadata: "none" };
}

function matchesEtag(value, etag) {
  return value && (value === "*" || value.split(",").some(tag => tag.trim().replace(/^W\//, "") === etag.replace(/^W\//, "")));
}

async function rawAsset(request, target) {
  const { bucket, key } = target;
  const head = request.method === "HEAD";
  // Evaluate validators against the complete object before applying Range.
  const metadata = await bucket.head(key);
  if (!metadata) return new Response("Not found.", { status: 404 });
  const version = new URL(request.url).searchParams.get("v");
  if (version && version !== metadata.etag) return new Response("Source version changed.", { status: 412 });
  const headers = new Headers();
  metadata.writeHttpMetadata(headers);
  // These objects were copied from Node fetch's decoded response bodies.
  // A legacy proxy transport encoding must never be applied to their byte ranges.
  if (metadata.customMetadata?.["supabase-fingerprint"] && metadata.customMetadata?.sourcesha256) headers.delete("Content-Encoding");
  headers.set("ETag", metadata.httpEtag);
  headers.set("Last-Modified", metadata.uploaded.toUTCString());
  headers.set("Accept-Ranges", "bytes");
  const noneMatch = request.headers.get("If-None-Match");
  const modifiedSince = request.headers.get("If-Modified-Since");
  if (matchesEtag(noneMatch, metadata.httpEtag) ||
      !noneMatch && modifiedSince && Math.floor(metadata.uploaded.getTime() / 1000) <= Math.floor(Date.parse(modifiedSince) / 1000)) {
    return new Response(null, { status: 304, headers });
  }
  let range;
  const rangeHeader = request.headers.get("Range");
  const ifRange = request.headers.get("If-Range");
  const canRange = !ifRange || ifRange === metadata.httpEtag || Date.parse(ifRange) >= Math.floor(metadata.uploaded.getTime() / 1000) * 1000;
  if (!head && rangeHeader && canRange) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    const start = match?.[1] ? Number(match[1]) : Math.max(0, metadata.size - Number(match?.[2]));
    const end = match?.[1] ? (match[2] ? Math.min(Number(match[2]), metadata.size - 1) : metadata.size - 1) : metadata.size - 1;
    if (!match || !match[1] && !match[2] || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= metadata.size || !match[1] && Number(match[2]) === 0) {
      headers.set("Content-Range", `bytes */${metadata.size}`);
      return new Response(null, { status: 416, headers });
    }
    range = { offset: start, length: end - start + 1 };
    headers.set("Content-Range", `bytes ${start}-${end}/${metadata.size}`);
  }
  headers.set("Content-Length", String(range?.length ?? metadata.size));
  if (head) return new Response(null, { headers });
  const object = await bucket.get(key, { range, onlyIf: { etagMatches: metadata.etag } });
  if (!object) return new Response("Not found.", { status: 404 });
  if (!("body" in object)) return new Response("Object changed; retry the request.", { status: 412 });
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

const worker = {
  async fetch(request, env, context = { waitUntil: promise => promise.catch(() => {}) }) {
    const url = new URL(request.url);
    const target = assetTarget(url, env);
    if (!target) return cors(new Response("Not found.", { status: 404 }));
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    if (!["GET", "HEAD"].includes(request.method)) return cors(new Response("Method not allowed.", { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } }));
    try {
      if (url.hostname === "media.dextery.dev" || !url.search) {
        const cache = globalThis.caches?.default;
        // Isolate entries from the pre-cutover transport-encoding metadata bug.
        const cacheUrl = new URL(request.url);
        cacheUrl.searchParams.set("__assets_cache", "3");
        const cacheRequest = new Request(cacheUrl, { method: "GET" });
        const conditional = ["Range", "If-Range", "If-None-Match", "If-Modified-Since"].some(name => request.headers.has(name));
        if (cache && !conditional) {
          const cached = await cache.match(cacheRequest);
          if (cached) return cors(cached, request.method === "HEAD");
        }
        const response = cors(await rawAsset(request, target));
        const cacheControl = response.headers.get("Cache-Control") ?? "";
        if (cache && request.method === "GET" && response.status === 200 && !/(no-cache|no-store|private)/i.test(cacheControl) && /max-age=[1-9]/i.test(cacheControl)) {
          context.waitUntil(cache.put(cacheRequest, response.clone()).catch(() => {}));
        }
        return response;
      }
      let options;
      try { options = imageOptions(url, request.headers.get("Accept") ?? ""); }
      catch { return cors(new Response("Invalid image options.", { status: 400 })); }
      const source = await target.bucket.head(target.key);
      if (!source) return cors(new Response("Not found.", { status: 404 }));
      let transformKey = target.key;
      let transformSource = source;
      const deliveryKey = source.customMetadata?.["cf-image-source"];
      if (target.project === "elliotmairet" && /^__image-sources\/[a-f0-9]{64}\.webp$/.test(deliveryKey ?? "")) {
        const delivery = await target.bucket.head(deliveryKey);
        if (!delivery || !source.customMetadata?.sourcesha256 || delivery.customMetadata?.sourcesha256 !== source.customMetadata.sourcesha256) {
          return cors(new Response("Image delivery source unavailable.", { status: 503 }));
        }
        transformKey = deliveryKey;
        transformSource = delivery;
      }
      const sourceUrl = new URL(`https://media.dextery.dev/${target.project}/${transformKey.split("/").map(encodeURIComponent).join("/")}`);
      sourceUrl.searchParams.set("v", transformSource.etag);
      const response = await fetch(sourceUrl, { cf: { image: options }, headers: { Accept: request.headers.get("Accept") ?? "*/*" } });
      const headers = new Headers(response.headers);
      headers.set("Vary", "Accept");
      if (source.httpMetadata?.cacheControl) headers.set("Cache-Control", source.httpMetadata.cacheControl);
      if (response.ok) {
        const etag = headers.get("ETag") ?? `W/"${source.etag}-${transformSource.etag}-${options.width ?? 'original'}-${options.quality}-${options.format ?? 'default'}-v1"`;
        const modified = new Date(Math.max(source.uploaded.getTime(), transformSource.uploaded.getTime()));
        headers.set("ETag", etag);
        headers.set("Last-Modified", modified.toUTCString());
        const noneMatch = request.headers.get("If-None-Match");
        const modifiedSince = request.headers.get("If-Modified-Since");
        if (matchesEtag(noneMatch, etag) || !noneMatch && modifiedSince && Math.floor(modified.getTime() / 1000) <= Math.floor(Date.parse(modifiedSince) / 1000)) {
          await response.body?.cancel();
          headers.delete("Content-Length");
          return cors(new Response(null, { status: 304, headers }));
        }
      }
      return cors(new Response(response.body, { status: response.status, headers }), request.method === "HEAD");
    } catch {
      console.error("Asset delivery failed.", { project: target.project, key: target.key });
      return cors(new Response("Asset delivery temporarily unavailable.", { status: 502 }));
    }
  },
};

export default worker;
