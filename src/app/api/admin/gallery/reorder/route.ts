import { NextResponse } from "next/server";

import { GalleryRequestError, moveGalleryItem } from "@/lib/gallery";
import { requirePortfolioAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const unauthorized = await requirePortfolioAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const direction = body?.direction;
  if (!slug || (direction !== "up" && direction !== "down")) {
    return NextResponse.json({ error: "A slug and move direction are required." }, { status: 400 });
  }

  try {
    return NextResponse.json({ items: await moveGalleryItem(slug, direction) });
  } catch (error) {
    if (error instanceof GalleryRequestError && error.status === 404) {
      return NextResponse.json({ error: "Gallery ordering is not configured on the server." }, { status: 503 });
    }
    const statusCode = error instanceof GalleryRequestError && error.status < 500 ? error.status : 500;
    return NextResponse.json({ error: "Could not change the gallery order." }, { status: statusCode });
  }
}
