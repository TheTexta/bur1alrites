function trimTrailingSlash(value: string) { return value.replace(/\/+$/, ""); }
function readRequiredPublicEnv(value: string | undefined, name: string) {
  if (!value) throw new Error(`Missing required Supabase env var: ${name}`);
  return value;
}

export function getSupabaseUrl() {
  // Next only inlines NEXT_PUBLIC_* vars for static property access in client bundles.
  return trimTrailingSlash(
    readRequiredPublicEnv(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      "NEXT_PUBLIC_SUPABASE_URL",
    ),
  );
}
