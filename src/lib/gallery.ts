import { getSupabaseUrl } from "./supabase/config";

export type GalleryStatus = "processing" | "published" | "failed" | "archived";

export type GalleryItem = {
  slug: string;
  extension: string;
  width: number;
  height: number;
  title: string;
  client: string;
  type: string;
  year: string;
  status?: GalleryStatus;
  sort_order?: number;
};

export type AdminGalleryItem = GalleryItem & {
  status: GalleryStatus;
  sort_order: number;
  processing_error: string | null;
};

type GalleryRow = AdminGalleryItem & { id: number; created_at: string };

export class GalleryRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

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
    `gallery_items?select=slug,extension,width,height,title,client,type,year,status,sort_order,processing_error,created_at&order=sort_order.asc,created_at.asc${status}`,
  );

  if (!response.ok) {
    if (response.status === 404 || response.status === 42_701) return null;
    throw new Error(`Could not read gallery items: ${response.status}`);
  }

  return (await response.json()) as GalleryRow[];
}

type GalleryItemUpdate = Partial<Pick<GalleryItem, "title" | "client" | "type" | "year">> & {
  status?: Extract<GalleryStatus, "published" | "archived">;
};

export async function updateGalleryItem(slug: string, values: GalleryItemUpdate) {
  const eligibleStatus = values.status ? "&status=in.(published,archived)" : "";
  const response = await galleryRequest(`gallery_items?slug=eq.${encodeURIComponent(slug)}${eligibleStatus}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(values),
  });

  if (!response.ok) throw new GalleryRequestError("Could not update gallery item.", response.status);
  return (await response.json()) as GalleryRow[];
}

export async function createGalleryItem(item: GalleryItem) {
  const response = await galleryRequest("rpc/create_gallery_item", {
    method: "POST",
    body: JSON.stringify({
      item_slug: item.slug,
      item_extension: item.extension,
      item_width: item.width,
      item_height: item.height,
      item_title: item.title,
      item_client: item.client,
      item_type: item.type,
      item_year: item.year,
    }),
  });

  if (!response.ok) throw new GalleryRequestError("Could not create gallery item.", response.status);
  return (await response.json()) as GalleryRow[];
}

export async function deleteProcessingGalleryItem(slug: string) {
  const response = await galleryRequest(
    `gallery_items?slug=eq.${encodeURIComponent(slug)}&status=eq.processing`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new GalleryRequestError("Could not clean up gallery item.", response.status);
}

export async function moveGalleryItem(slug: string, direction: "up" | "down") {
  const response = await galleryRequest("rpc/move_gallery_item", {
    method: "POST",
    body: JSON.stringify({ item_slug: slug, direction }),
  });

  if (!response.ok) throw new GalleryRequestError("Could not reorder gallery item.", response.status);
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