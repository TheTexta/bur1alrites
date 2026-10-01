import { randomUUID } from "node:crypto";
import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, ListPartsCommand, UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";

import { galleryUploadIsConfigured, GalleryRequestError, getGalleryItem, reserveGalleryUpload } from "@/lib/gallery";
import { buildPortfolioStoragePath, portfolioImageBasePath } from "@/lib/portfolio/config";
import { requirePortfolioAdmin } from "@/lib/supabase/admin";
import { MAX_SOURCE_BYTES, UPLOAD_PART_BYTES, SOURCE_CONTENT_TYPES, signUploadSession, readUploadSession, validateUploadParts, type UploadSession } from "@/lib/r2/upload-session";
import { r2Configuration, r2Client, r2Bucket, objectCommand, headObject, copyObject, deleteObject } from "../../../../../media-worker/r2.mjs";

type SourceExtension = keyof typeof SOURCE_CONTENT_TYPES;

function sourceExtension(fileName: string): SourceExtension | null {
  const extension = /\.([^.]+)$/.exec(fileName)?.[1].toLowerCase();
  return extension === "mov" || extension === "mp4" ? extension : null;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function basePath() {
  return portfolioImageBasePath().replace(/^\/+|\/+$/g, "");
}

function metadataFrom(body: unknown, extension: SourceExtension) {
  if (!body || typeof body !== "object") return null;
  const values = body as Record<string, unknown>;
  const slug = slugify(typeof values.slug === "string" ? values.slug : "");
  const title = typeof values.title === "string" ? values.title.trim() : "";
  const client = typeof values.client === "string" ? values.client.trim() : "";
  const type = typeof values.type === "string" ? values.type.trim() : "";
  const year = typeof values.year === "string" ? values.year.trim() : "";
  const width = Number(values.width);
  const height = Number(values.height);
  if (!slug || !title || !client || !type || !year ||
      !Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) return null;
  return { slug, title, client, type, year, width, height, extension };
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  try { return !origin || new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}


async function authorize(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  return requirePortfolioAdmin(request);
}

function sessionFrom(body: { session?: unknown } | null) {
  const session = readUploadSession(body?.session, r2Configuration().secretAccessKey);
  if (session.bucket !== r2Bucket() || session.key !== `${basePath()}/incoming/${session.id}.${session.metadata.extension}`) throw new Error("Invalid upload session.");
  return session;
}

function failed(error: unknown) {
  if (error instanceof GalleryRequestError && error.status === 409) return NextResponse.json({ error: "A clip with that slug already exists." }, { status: 409 });
  if (error instanceof GalleryRequestError && error.status === 404) return NextResponse.json({ error: "Apply the R2 upload reservation migration before uploading." }, { status: 503 });
  // Never log signed upload URLs, tokens, or SDK request details.
  console.error("Portfolio upload operation failed.", { name: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "The upload could not be completed. Retry or check server configuration." }, { status: 500 });
}

export async function POST(request: Request) {
  const unauthorized = await authorize(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  const extension = sourceExtension(typeof body?.fileName === "string" ? body.fileName : "");
  const metadata = extension ? metadataFrom(body, extension) : null;
  const size = Number(body?.fileSize);
  if (!metadata || !Number.isSafeInteger(size) || size <= 0 || size > MAX_SOURCE_BYTES) return NextResponse.json({ error: "Choose a MOV or MP4 video up to 5 GiB and fill in every field." }, { status: 400 });
  try {
    if (!(await galleryUploadIsConfigured())) return NextResponse.json({ error: "Apply the R2 upload reservation migration before uploading." }, { status: 503 });
    const destination = buildPortfolioStoragePath(metadata.slug, metadata.extension);
    if (await getGalleryItem(metadata.slug) || await headObject(destination)) return NextResponse.json({ error: "A clip with that slug already exists." }, { status: 409 });
    const id = randomUUID();
    const key = `${basePath()}/incoming/${id}.${metadata.extension}`;
    const result = await r2Client().send(objectCommand(CreateMultipartUploadCommand, key, {
      ContentType: SOURCE_CONTENT_TYPES[metadata.extension], CacheControl: "public, max-age=31536000",
      Metadata: { "upload-session-id": id, "destination-key": destination },
    }));
    if (!result.UploadId) throw new Error("R2 did not return an upload ID.");
    const session: UploadSession = { id, key, bucket: r2Bucket(), uploadId: result.UploadId, size, metadata, expires: Date.now() + 24 * 60 * 60 * 1000 };
    return NextResponse.json({ session: signUploadSession(session, r2Configuration().secretAccessKey), partSize: UPLOAD_PART_BYTES, partCount: Math.ceil(size / UPLOAD_PART_BYTES) });
  } catch (error) { return failed(error); }
}

export async function PATCH(request: Request) {
  const unauthorized = await authorize(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  let session;
  try { session = sessionFrom(body); } catch { return NextResponse.json({ error: "Your upload session expired or is invalid." }, { status: 400 }); }
  const numbers = body?.partNumbers;
  const count = Math.ceil(session.size / UPLOAD_PART_BYTES);
  if (!Array.isArray(numbers) || !numbers.length || numbers.length > 6 || new Set(numbers).size !== numbers.length || numbers.some(n => !Number.isInteger(n) || n < 1 || n > count)) return NextResponse.json({ error: "Invalid upload part numbers." }, { status: 400 });
  try {
    const parts = await Promise.all(numbers.map(async (partNumber: number) => ({
      partNumber,
      url: await getSignedUrl(r2Client(), objectCommand(UploadPartCommand, session.key, { UploadId: session.uploadId, PartNumber: partNumber, ContentLength: Math.min(UPLOAD_PART_BYTES, session.size - (partNumber - 1) * UPLOAD_PART_BYTES) }), { expiresIn: 900 }),
    })));
    return NextResponse.json({ parts });
  } catch (error) { return failed(error); }
}

export async function PUT(request: Request) {
  const unauthorized = await authorize(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  let session;
  try { session = sessionFrom(body); } catch { return NextResponse.json({ error: "Your upload session expired or is invalid." }, { status: 400 }); }
  try {
    const destination = buildPortfolioStoragePath(session.metadata.slug, session.metadata.extension);
    const final = await headObject(destination);
    if (final) {
      const item = await getGalleryItem(session.metadata.slug);
      if (final.Metadata?.["upload-session-id"] === session.id && final.ContentLength === session.size && item?.upload_session_id === session.id) return NextResponse.json({ item });
      return NextResponse.json({ error: "A clip with that slug already exists." }, { status: 409 });
    }
    let source = await headObject(session.key);
    if (!source) {
      const result = await r2Client().send(objectCommand(ListPartsCommand, session.key, { UploadId: session.uploadId }));
      if (result.IsTruncated) return NextResponse.json({ error: "Unexpected upload part count." }, { status: 400 });
      let parts;
      try { parts = validateUploadParts(result.Parts ?? [], session.size); }
      catch { return NextResponse.json({ error: "The upload is incomplete or has an invalid size." }, { status: 400 }); }
      try {
        await r2Client().send(objectCommand(CompleteMultipartUploadCommand, session.key, { UploadId: session.uploadId, MultipartUpload: { Parts: parts } }));
      } catch (error) {
        // Another completion request may have succeeded while its response was lost.
        if (!(await headObject(session.key))) throw error;
      }
      source = await headObject(session.key);
    }
    if (!source || source.ContentLength !== session.size || source.Metadata?.["upload-session-id"] !== session.id || source.ContentType !== SOURCE_CONTENT_TYPES[session.metadata.extension]) return NextResponse.json({ error: "The uploaded video does not match this upload session." }, { status: 400 });
    const item = await reserveGalleryUpload(session.id, session.metadata);
    try {
      await copyObject(session.key, destination, { CopySourceIfMatch: source.ETag, IfNoneMatch: "*" });
    } catch (error) {
      const existing = await headObject(destination);
      if (existing?.Metadata?.["upload-session-id"] !== session.id || existing.ContentLength !== session.size) throw error;
    }
    await deleteObject(session.key).catch(() => console.error("Staging cleanup will be retried by the worker."));
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) { return failed(error); }
}

export async function DELETE(request: Request) {
  const unauthorized = await authorize(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  let session;
  try { session = sessionFrom(body); } catch { return NextResponse.json({ error: "Your upload session expired or is invalid." }, { status: 400 }); }
  try {
    try { await r2Client().send(objectCommand(AbortMultipartUploadCommand, session.key, { UploadId: session.uploadId })); }
    catch (error) { if (!(error instanceof Error && error.name === "NoSuchUpload")) throw error; }
    await deleteObject(session.key);
    return NextResponse.json({ aborted: true });
  } catch (error) { return failed(error); }
}
