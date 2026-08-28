import { getSupabaseUrl } from "./supabase/config";

export type GalleryItem = {
  slug: string;
  extension: string;
  width: number;
  height: number;
  title: string;
  client: string;
  type: string;
  year: string;
  status?: "processing" | "published" | "failed" | "archived";
  sort_order?: number;
};

type GalleryRow = GalleryItem & { id: number; created_at: string };

function serviceRoleKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing required Supabase env var: SUPABASE_SERVICE_ROLE_KEY");
  return key;
}

async function galleryRequest(path: string, init?: RequestInit) {
  return fetch(`${getSupabaseUrl()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey(),
      Authorization: `Bearer ${serviceRoleKey()}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

export async function listGalleryItems(options?: { publishedOnly?: boolean }) {
  const status = options?.publishedOnly ? "&status=eq.published" : "";
  const response = await galleryRequest(
    `gallery_items?select=slug,extension,width,height,title,client,type,year,status,sort_order,created_at&order=sort_order.asc,created_at.asc${status}`,
  );

  if (!response.ok) {
    if (response.status === 404 || response.status === 42_701) return null;
    throw new Error(`Could not read gallery items: ${response.status}`);
  }

  return (await response.json()) as GalleryRow[];
}

export async function updateGalleryItem(slug: string, values: Pick<GalleryItem, "title" | "client" | "type" | "year">) {
  const response = await galleryRequest(`gallery_items?slug=eq.${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(values),
  });

  if (!response.ok) throw new Error(`Could not update gallery item: ${response.status}`);
  return (await response.json()) as GalleryRow[];
}

export async function createGalleryItem(item: GalleryItem) {
  const response = await galleryRequest("gallery_items", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...item, status: "processing" }),
  });

  if (!response.ok) throw new Error(`Could not create gallery item: ${response.status}`);
  return (await response.json()) as GalleryRow[];
}

export async function uploadPortfolioSource(path: string, body: ArrayBuffer, contentType: string) {
  const bucket = process.env.SUPABASE_PORTFOLIO_BUCKET ?? "bur1alrites";
  const response = await fetch(
    `${getSupabaseUrl()}/storage/v1/object/${encodeURIComponent(bucket)}/${path}`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey(),
        Authorization: `Bearer ${serviceRoleKey()}`,
        "content-type": contentType,
        "cache-control": "max-age=31536000",
        "x-upsert": "false",
      },
      body,
      cache: "no-store",
    },
  );

  if (!response.ok) throw new Error(`Could not upload source: ${response.status}`);
}