import { NextResponse } from "next/server";

import { isValidAdminSession } from "@/lib/admin-auth";
import { createGalleryItem, uploadPortfolioSource } from "@/lib/gallery";
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

  if (!(file instanceof File) || !slug || !title || !client || !width || !height || extension === "webp") {
    return NextResponse.json({ error: "A video, slug, title, client, width, and height are required." }, { status: 400 });
  }

  await createGalleryItem({ slug, extension, width, height, title, client, type, year });
  await uploadPortfolioSource(buildPortfolioStoragePath(slug, extension), await file.arrayBuffer(), file.type || "video/quicktime");

  return NextResponse.json({ slug, status: "processing" }, { status: 201 });
}