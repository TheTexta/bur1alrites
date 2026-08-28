import { NextResponse } from "next/server";

import { isValidAdminSession } from "@/lib/admin-auth";
import { updateGalleryItem } from "@/lib/gallery";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session";

export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
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
  const values = {
    title: typeof body?.title === "string" ? body.title.trim() : "",
    client: typeof body?.client === "string" ? body.client.trim() : "",
    type: typeof body?.type === "string" ? body.type.trim() : "",
    year: typeof body?.year === "string" ? body.year.trim() : "",
  };

  if (Object.values(values).some((value) => !value)) {
    return NextResponse.json({ error: "All metadata fields are required." }, { status: 400 });
  }

  const { slug } = await context.params;
  return NextResponse.json({ item: (await updateGalleryItem(slug, values))[0] });
}