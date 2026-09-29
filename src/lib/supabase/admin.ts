import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getSupabaseUrl } from "./config";

function serviceRoleKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing required Supabase env var: SUPABASE_SERVICE_ROLE_KEY");
  return key;
}

export function getSupabaseAdminClient() {
  return createClient(getSupabaseUrl(), serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requirePortfolioAdmin(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  const { data, error } = await getSupabaseAdminClient().auth.getUser(token);
  if (error || !data.user) {
    return NextResponse.json({ error: "Your session ended. Sign in again." }, { status: 401 });
  }
  if (data.user.app_metadata?.bur1alrites_admin !== true) {
    return NextResponse.json({ error: "This account cannot manage the portfolio." }, { status: 403 });
  }
  return null;
}
