import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

for (const path of [".env", ".env.local"]) {
  try {
    for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // Deployment environments can provide variables without local env files.
  }
}

const [email, access = "grant"] = process.argv.slice(2);
if (!email || !["grant", "revoke"].includes(access)) {
  throw new Error("Usage: npm run admin:access -- <email> [grant|revoke]");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (error) throw error;
const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
if (!user) throw new Error("Supabase Auth user not found.");

const { error: updateError } = await client.auth.admin.updateUserById(user.id, {
  app_metadata: { ...user.app_metadata, bur1alrites_admin: access === "grant" },
});
if (updateError) throw updateError;
console.log(`Portfolio admin access ${access === "grant" ? "granted" : "revoked"} for ${user.email}.`);
