import type { NextConfig } from "next";
import {
  CANVAS_IMAGE_DEVICE_SIZES,
  CANVAS_IMAGE_SIZES,
} from "./src/lib/image-optimization";

function supabaseImageRemotePattern() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!supabaseUrl) {
    return [];
  }

  const hostname = new URL(supabaseUrl).hostname;

  return [
    {
      protocol: "https" as const,
      hostname,
      pathname: "/storage/v1/object/public/**",
    },
    {
      protocol: "https" as const,
      hostname,
      pathname: "/storage/v1/render/image/public/**",
    },
  ];
}

const nextConfig: NextConfig = {
  images: {
    deviceSizes: CANVAS_IMAGE_DEVICE_SIZES,
    imageSizes: CANVAS_IMAGE_SIZES,
    formats: ["image/avif", "image/webp"],
    qualities: [72, 75],
    remotePatterns: supabaseImageRemotePattern(),
    minimumCacheTTL: 60 * 60 * 24 * 30, // 1 month (30 days)
  },
};

export default nextConfig;
