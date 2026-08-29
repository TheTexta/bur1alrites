"use client";

import { useEffect, useRef, useState } from "react";

import { attachHlsStream } from "@/lib/hls-stream";

type VideoThumbProps = {
  manifestUrl: string;
  posterUrl: string;
  width: number;
  height: number;
  label: string;
};

export function VideoThumb({
  manifestUrl,
  posterUrl,
  width,
  height,
  label,
}: VideoThumbProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const controllerRef =
    useRef<Awaited<ReturnType<typeof attachHlsStream>> | null>(null);
  const loadingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    return () => controllerRef.current?.destroy();
  }, []);

  async function playPreview() {
    const video = ref.current;
    if (!video || loadingRef.current) return;

    loadingRef.current = true;

    try {
      if (!controllerRef.current) {
        controllerRef.current = await attachHlsStream(video, manifestUrl, {
          startLevel: 0,
        });
      }

      await video.play();
    } catch {
      // The poster remains visible if a stream is not ready yet.
    } finally {
      loadingRef.current = false;
    }
  }

  function stopPreview() {
    const video = ref.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }

    controllerRef.current?.destroy();
    controllerRef.current = null;
  }

  return (
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="none"
      poster={posterUrl}
      aria-label={label}
      // Lets the wrapper drop its invert on tap, since touch never fires :hover.
      data-playing={isPlaying ? "" : undefined}
      // Reserve space before metadata loads so the masonry doesn't reflow.
      style={{ aspectRatio: `${width} / ${height}` }}
      onPlaying={() => setIsPlaying(true)}
      onPause={() => setIsPlaying(false)}
      onMouseEnter={() => void playPreview()}
      onMouseLeave={stopPreview}
      onTouchStart={() => (isPlaying ? stopPreview() : void playPreview())}
    />
  );
}
