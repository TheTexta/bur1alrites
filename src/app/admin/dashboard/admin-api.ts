"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export class AdminSessionExpiredError extends Error {
  constructor(message: string) { super(message); this.name = "AdminSessionExpiredError"; }
}

export async function requestAdminJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
  if (!session) throw new AdminSessionExpiredError("Sign in to continue.");
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${session.access_token}`);
  const response = await fetch(input, { ...init, headers });
  const body = response.headers.get("content-type")?.includes("application/json")
    ? await response.json().catch(() => null)
    : null;

  if (response.status === 401) {
    throw new AdminSessionExpiredError("Your session ended.");
  }

  if (response.status === 413) {
    throw new Error("The server rejected a request that was too large (413).");
  }

  if (!response.ok) {
    throw new Error(body?.error ?? `The request failed (${response.status}).`);
  }

  return body as T;
}
