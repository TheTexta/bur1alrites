import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { createGalleryItem, deleteProcessingGalleryItem, galleryUploadIsConfigured, GalleryRequestError, getGalleryItem } from "@/lib/gallery";
import { buildPortfolioStoragePath, portfolioImageBasePath } from "@/lib/portfolio/config";
import { getSupabaseAdminClient, requirePortfolioAdmin } from "@/lib/supabase/admin";
import { getPortfolioStorageBucket, getSupabaseUrl } from "@/lib/supabase/config";

const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.mov$/;

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function basePath() {
  return portfolioImageBasePath().replace(/^\/+|\/+$/g, "");
}

function metadataFrom(body: unknown) {
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
  return { slug, title, client, type, year, width, height, extension: "mov" };
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || new URL(origin).origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const unauthorized = await requirePortfolioAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const metadata = metadataFrom(body);
  const values = body as Record<string, unknown> | null;
  const fileName = typeof values?.fileName === "string" ? values.fileName : "";
  const fileSize = Number(values?.fileSize);
  if (!metadata || !fileName.toLowerCase().endsWith(".mov") ||
      !Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_SOURCE_BYTES) {
    return NextResponse.json({ error: "Choose a MOV video under 100 MB and fill in every field." }, { status: 400 });
  }

  try {
    if (!(await galleryUploadIsConfigured())) {
      return NextResponse.json({ error: "Gallery uploads are not configured on the server." }, { status: 503 });
    }
    if (await getGalleryItem(metadata.slug)) {
      return NextResponse.json({ error: "A clip with that slug already exists." }, { status: 409 });
    }
    const uploadPath = `${basePath()}/incoming/${randomUUID()}.mov`;
    const bucket = getSupabaseAdminClient().storage.from(getPortfolioStorageBucket());
    const { data, error } = await bucket.createSignedUploadUrl(uploadPath);
    if (error || !data) throw error ?? new Error("Could not sign upload.");
    return NextResponse.json({
      uploadPath,
      token: data.token,
      endpoint: `${getSupabaseUrl()}/storage/v1/upload/resumable`,
      bucket: getPortfolioStorageBucket(),
    });
  } catch (error) {
    console.error("Could not start portfolio upload.", error);
    return NextResponse.json({ error: "Could not start the upload." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const unauthorized = await requirePortfolioAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const metadata = metadataFrom(body);
  const uploadPath = typeof body?.uploadPath === "string" ? body.uploadPath : "";
  const expectedPrefix = `${basePath()}/incoming/`;
  if (!metadata || !uploadPath.startsWith(expectedPrefix) ||
      !UPLOAD_ID_PATTERN.test(uploadPath.slice(expectedPrefix.length))) {
    return NextResponse.json({ error: "Invalid upload details." }, { status: 400 });
  }

  const bucket = getSupabaseAdminClient().storage.from(getPortfolioStorageBucket());
  const { data: source, error: sourceError } = await bucket.info(uploadPath);
  if (sourceError || !source || !source.size || source.size > MAX_SOURCE_BYTES) {
    return NextResponse.json({ error: "The uploaded MOV could not be found or is too large." }, { status: 400 });
  }

  let created = false;
  try {
    const [item] = await createGalleryItem(metadata);
    created = true;
    const { error: moveError } = await bucket.move(uploadPath, buildPortfolioStoragePath(metadata.slug, "mov"));
    if (moveError) throw moveError;
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (created) {
      await deleteProcessingGalleryItem(metadata.slug).catch((cleanupError) => {
        console.error(`Could not clean up failed upload for ${metadata.slug}.`, cleanupError);
      });
    }
    if (error instanceof GalleryRequestError && error.status === 409) {
      return NextResponse.json({ error: "A clip with that slug already exists." }, { status: 409 });
    }
    if (error instanceof GalleryRequestError && error.status === 404) {
      return NextResponse.json({ error: "Gallery uploads are not configured on the server." }, { status: 503 });
    }
    console.error(`Could not finish portfolio upload for ${metadata.slug}.`, error);
    return NextResponse.json({ error: "Could not add the uploaded clip to the gallery." }, { status: 500 });
  }
}
