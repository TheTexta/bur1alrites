"use client";

export default function cloudflareImageLoader({ src, width, quality }: { src: string; width: number; quality?: number }) {
  const base = process.env.NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_URL;
  if (!base) return src;
  try {
    const url = new URL(src);
    const expected = new URL(base);
    if (url.origin !== expected.origin || !url.pathname.startsWith(`${expected.pathname.replace(/\/$/, "")}/`)) return src;
    url.searchParams.set("width", String(width));
    url.searchParams.set("quality", String(quality ?? 75));
    url.searchParams.set("format", "auto");
    return url.toString();
  } catch { return src; }
}
