import { readFile } from "node:fs/promises";

async function loadEnvFile(path) {
  try {
    const content = await readFile(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // Environment variables may already be supplied by the shell or host.
  }
}

await loadEnvFile(".env");
await loadEnvFile(".env.local");

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const items = [
  ["img-0722", 1920, 1080], ["img-1254", 1080, 1920], ["img-0723", 1920, 1080],
  ["img-0980", 1920, 1080], ["img-1256", 1080, 1920], ["img-0990", 1920, 1080],
  ["img-2460", 720, 1280], ["img-1365", 1920, 1080], ["img-1398", 1080, 1920],
  ["img-1814", 1920, 1080], ["img-2170", 1280, 720], ["img-2220", 1920, 1080],
  ["img-3356", 1920, 1080], ["img-5258", 1920, 1080], ["img-5264", 1920, 1080],
  ["img-5265", 1920, 1080], ["img-5266", 1920, 1080], ["img-5599", 1920, 1080],
  ["img-5852", 1920, 1080], ["img-5863", 1920, 1080], ["img-6128", 1920, 1080],
  ["img-6165", 1920, 1080],
].map(([slug, width, height], sort_order) => ({
  slug, extension: "mov", width, height, title: `Untitled ${slug.slice(4)}`,
  client: "bur1alrites", type: "clip", year: "2026", status: "published", sort_order,
}));

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const response = await fetch(`${SUPABASE_URL}/rest/v1/gallery_items?on_conflict=slug`, {
  method: "POST",
  headers: {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  },
  body: JSON.stringify(items),
});

if (!response.ok) throw new Error(`Gallery seed failed: ${response.status} ${await response.text()}`);
console.log(`Seeded ${items.length} gallery items.`);