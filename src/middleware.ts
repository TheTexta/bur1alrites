import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/admin/login" || request.nextUrl.pathname === "/api/admin/logout") {
    return NextResponse.next();
  }

  if (request.cookies.has(ADMIN_SESSION_COOKIE)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/admin/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const loginUrl = new URL("/admin", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/dashboard/:path*", "/api/admin/:path*"],
};