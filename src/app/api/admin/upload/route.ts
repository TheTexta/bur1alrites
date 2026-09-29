import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { createGalleryItem, deleteProcessingGalleryItem, galleryUploadIsConfigured, GalleryRequestError, getGalleryItem } from "@/lib/gallery";
import { buildPortfolioStoragePath, portfolioImageBasePath } from "@/lib/portfolio/config";
import { getSupabaseAdminClient, requirePortfolioAdmin } from "@/lib/supabase/admin";
import { getPortfolioStorageBucket, getSupabaseUrl } from "@/lib/supabase/config";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024 * 1024;
const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mov|mp4)$/;
const SOURCE_CONTENT_TYPES = { mov: "video/quicktime", mp4: "video/mp4" } as const;
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
  return !origin || new URL(origin).origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const unauthorized = await requirePortfolioAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const values = body as Record<string, unknown> | null;
  const fileName = typeof values?.fileName === "string" ? values.fileName : "";
  const extension = sourceExtension(fileName);
  const metadata = extension ? metadataFrom(body, extension) : null;
  const fileSize = Number(values?.fileSize);
  if (!metadata ||
      !Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_SOURCE_BYTES) {
    return NextResponse.json({ error: "Choose a MOV or MP4 video up to 5 GiB and fill in every field." }, { status: 400 });
  }

  try {
    if (!(await galleryUploadIsConfigured())) {
      return NextResponse.json({ error: "Gallery uploads are not configured on the server." }, { status: 503 });
    }
    if (await getGalleryItem(metadata.slug)) {
      return NextResponse.json({ error: "A clip with that slug already exists." }, { status: 409 });
    }
    const uploadPath = `${basePath()}/incoming/${randomUUID()}.${metadata.extension}`;
    return NextResponse.json({
      uploadPath,
      endpoint: `${getSupabaseUrl()}/storage/v1/upload/resumable`,
      bucket: getPortfolioStorageBucket(),
      contentType: SOURCE_CONTENT_TYPES[metadata.extension],
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
  const uploadPath = typeof body?.uploadPath === "string" ? body.uploadPath : "";
  const expectedPrefix = `${basePath()}/incoming/`;
  const uploadMatch = uploadPath.startsWith(expectedPrefix)
    ? UPLOAD_ID_PATTERN.exec(uploadPath.slice(expectedPrefix.length))
    : null;
  const metadata = uploadMatch ? metadataFrom(body, uploadMatch[1] as SourceExtension) : null;
  if (!metadata) {
    return NextResponse.json({ error: "Invalid upload details." }, { status: 400 });
  }

  const bucket = getSupabaseAdminClient().storage.from(getPortfolioStorageBucket());
  const { data: source, error: sourceError } = await bucket.info(uploadPath);
  if (sourceError || !source || !source.size || source.size > MAX_SOURCE_BYTES) {
    return NextResponse.json({ error: "The uploaded video could not be found or is too large." }, { status: 400 });
  }

  let created = false;
  try {
    const [item] = await createGalleryItem(metadata);
    created = true;
    const { error: moveError } = await bucket.move(uploadPath, buildPortfolioStoragePath(metadata.slug, metadata.extension));
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
