import { NextResponse } from "next/server";

import { requirePortfolioAdmin } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const unauthorized = await requirePortfolioAdmin(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({ ok: true });
}
