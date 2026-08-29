"use client";

import { Film, LoaderCircle, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { attachHlsStream, type HlsStreamController } from "@/lib/hls-stream";
import {
  buildPortfolioStreamManifestPath,
  buildPortfolioVideoPosterPath,
} from "@/lib/portfolio/config";
import { buildSupabaseStoragePublicUrl } from "@/lib/supabase/config";
import type { AdminGalleryItem } from "@/lib/gallery";

export function AdminVideoPreview({ item }: { item: AdminGalleryItem }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<HlsStreamController | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const playable = item.status === "published" || item.status === "archived";

  useEffect(() => {
    return () => controllerRef.current?.destroy();
  }, []);

  async function startPreview() {
    const video = videoRef.current;
    if (!video || loading) return;

    setLoading(true);
    setError("");
    try {
      controllerRef.current = await attachHlsStream(
        video,
        buildSupabaseStoragePublicUrl(buildPortfolioStreamManifestPath(item.slug)),
        { startLevel: 0, onFatalError: () => setError("Preview is unavailable.") },
      );
      setActive(true);
      await video.play();
    } catch {
      controllerRef.current?.destroy();
      controllerRef.current = null;
      setActive(false);
      setError("Preview is unavailable.");
    } finally {
      setLoading(false);
    }
  }

  if (!playable) {
    return (
      <div
        role="img"
        aria-label={`${item.title} preview unavailable while ${item.status}`}
        className="mt-4 flex aspect-16/10 w-full items-center justify-center border border-black bg-black px-4 text-center text-white"
      >
        <div>
          {item.status === "processing" ? (
            <LoaderCircle aria-hidden="true" className="mx-auto animate-spin" size={22} />
          ) : (
            <Film aria-hidden="true" className="mx-auto" size={22} />
          )}
          <p className="mt-2 text-xs uppercase tracking-widest">
            {item.status === "processing" ? "Preview processing" : "Preview unavailable"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mt-4 aspect-16/10 w-full overflow-hidden border border-black bg-black">
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        preload="none"
        controls={active}
        poster={buildSupabaseStoragePublicUrl(buildPortfolioVideoPosterPath(item.slug))}
        aria-label={`${item.title} video preview`}
        className="size-full object-contain"
      />
      {!active ? (
        <button
          type="button"
          aria-label={`Play preview for ${item.title}`}
          title="Play preview"
          disabled={loading}
          onClick={() => void startPreview()}
          className="absolute inset-0 grid place-items-center bg-black/10 text-white transition-colors hover:bg-black/35 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-white disabled:cursor-wait"
        >
          <span className="grid size-11 place-items-center border border-white bg-black/60">
            {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" size={20} /> : <Play aria-hidden="true" size={20} fill="currentColor" />}
          </span>
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="absolute inset-x-0 bottom-0 bg-black px-3 py-2 text-xs text-white">
          {error}
        </p>
      ) : null}
    </div>
  );
}