import { NextResponse } from "next/server";

import { isValidAdminSession } from "@/lib/admin-auth";
import { listGalleryItems } from "@/lib/gallery";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session";

export async function GET(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const session = cookie.match(new RegExp(`${ADMIN_SESSION_COOKIE}=([^;]+)`))?.[1];

  if (!isValidAdminSession(session)) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  return NextResponse.json({ items: (await listGalleryItems()) ?? [] });
}