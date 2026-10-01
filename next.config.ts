import type { NextConfig } from "next";
import {
  CANVAS_IMAGE_DEVICE_SIZES,
  CANVAS_IMAGE_SIZES,
} from "./src/lib/image-optimization";

function mediaImageRemotePattern() {
  const value = process.env.NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_URL;
  if (!value) return [];
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("The image base URL must use HTTPS.");
  return [{ protocol: "https" as const, hostname: url.hostname, port: url.port, pathname: `${url.pathname.replace(/\/$/, "")}/**` }];
}

const nextConfig: NextConfig = {
  images: {
    deviceSizes: CANVAS_IMAGE_DEVICE_SIZES,
    imageSizes: CANVAS_IMAGE_SIZES,
    loader: "custom",
    loaderFile: "./src/lib/media/image-loader.ts",
    qualities: [72, 75],
    remotePatterns: mediaImageRemotePattern(),
    minimumCacheTTL: 60 * 60 * 24 * 30, // 1 month (30 days)
  },
};

export default nextConfig;
