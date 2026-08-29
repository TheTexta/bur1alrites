import { NextResponse } from "next/server";

import { isValidAdminSession } from "@/lib/admin-auth";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session";
import { GalleryRequestError, moveGalleryItem } from "@/lib/gallery";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const cookie = request.headers.get("cookie") ?? "";
  const session = cookie.match(new RegExp(`${ADMIN_SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!isValidAdminSession(session)) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const direction = body?.direction;
  if (!slug || (direction !== "up" && direction !== "down")) {
    return NextResponse.json({ error: "A slug and move direction are required." }, { status: 400 });
  }

  try {
    return NextResponse.json({ items: await moveGalleryItem(slug, direction) });
  } catch (error) {
    const statusCode = error instanceof GalleryRequestError && error.status < 500 ? error.status : 500;
    return NextResponse.json({ error: "Could not change the gallery order." }, { status: statusCode });
  }
}