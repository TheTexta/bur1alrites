import { NextResponse } from "next/server";

import { isValidAdminSession } from "@/lib/admin-auth";
import { createGalleryItem, deleteProcessingGalleryItem, GalleryRequestError, uploadPortfolioSource } from "@/lib/gallery";
import { buildPortfolioStoragePath, normalizePortfolioExtension } from "@/lib/portfolio/config";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session";

function sessionFrom(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.match(new RegExp(`${ADMIN_SESSION_COOKIE}=([^;]+)`))?.[1];
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  if (!isValidAdminSession(sessionFrom(request))) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const rawName = typeof form.get("slug") === "string" ? String(form.get("slug")) : "";
  const slug = slugify(rawName);
  const extension = normalizePortfolioExtension(file instanceof File ? file.name.split(".").pop() : "mov");
  const width = Number(form.get("width"));
  const height = Number(form.get("height"));
  const title = String(form.get("title") ?? "").trim();
  const client = String(form.get("client") ?? "").trim();
  const type = String(form.get("type") ?? "clip").trim();
  const year = String(form.get("year") ?? new Date().getFullYear()).trim();

  if (!(file instanceof File) || !slug || !title || !client || !type || !year) {
    return NextResponse.json({ error: "A video and all descriptive fields are required." }, { status: 400 });
  }

  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    return NextResponse.json({ error: "The selected video's dimensions could not be read." }, { status: 400 });
  }

  if (extension !== "mov") {
    return NextResponse.json({ error: "Choose a MOV video for the media processor." }, { status: 400 });
  }

  let created = false;
  try {
    const [item] = await createGalleryItem({ slug, extension, width, height, title, client, type, year });
    created = true;
    await uploadPortfolioSource(buildPortfolioStoragePath(slug, extension), await file.arrayBuffer(), file.type || "video/quicktime");

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    let cleanupFailed = false;
    if (created) {
      await deleteProcessingGalleryItem(slug).catch((cleanupError) => {
        cleanupFailed = true;
        console.error(`Could not clean up failed upload for ${slug}.`, cleanupError);
      });
    }
    const statusCode = error instanceof GalleryRequestError && error.status === 409 ? 409 : 500;
    const message = cleanupFailed
      ? "Upload failed and its processing record could not be removed."
      : statusCode === 409
        ? "A clip with that slug already exists."
        : "Could not upload the clip.";
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}