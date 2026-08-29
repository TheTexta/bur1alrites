import { NextResponse } from "next/server";

import { isValidAdminSession } from "@/lib/admin-auth";
import { GalleryRequestError, updateGalleryItem } from "@/lib/gallery";
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
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A valid update is required." }, { status: 400 });
  }

  const values: {
    title?: string;
    client?: string;
    type?: string;
    year?: string;
    status?: "published" | "archived";
  } = {};
  for (const field of ["title", "client", "type", "year"] as const) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      values[field] = typeof body[field] === "string" ? body[field].trim() : "";
    }
  }

  if (Object.values(values).some((value) => !value)) {
    return NextResponse.json({ error: "Metadata fields cannot be empty." }, { status: 400 });
  }

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    if (body.status !== "published" && body.status !== "archived") {
      return NextResponse.json({ error: "Only published and archived visibility can be changed." }, { status: 400 });
    }
    values.status = body.status;
  }

  if (!Object.keys(values).length) {
    return NextResponse.json({ error: "At least one change is required." }, { status: 400 });
  }

  const { slug } = await context.params;
  try {
    const [item] = await updateGalleryItem(slug, values);
    if (!item) {
      return NextResponse.json(
        { error: values.status ? "Processing and failed clips cannot be published or archived." : "Gallery item not found." },
        { status: values.status ? 409 : 404 },
      );
    }

    return NextResponse.json({ item });
  } catch (error) {
    const statusCode = error instanceof GalleryRequestError && error.status < 500 ? error.status : 500;
    return NextResponse.json({ error: "Could not save changes." }, { status: statusCode });
  }
}