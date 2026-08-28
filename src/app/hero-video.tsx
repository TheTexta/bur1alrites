"use client";

import { useEffect, useRef, useState } from "react";

import { attachHlsStream } from "@/lib/hls-stream";

type HeroVideoProps = {
  manifestUrl: string;
  posterUrl: string;
};

export function HeroVideo({ manifestUrl, posterUrl }: HeroVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    let controller: Awaited<ReturnType<typeof attachHlsStream>> | null = null;
    let cancelled = false;
    const markReady = () => setReady(true);

    video.addEventListener("canplay", markReady);
    void attachHlsStream(video, manifestUrl, {
      startLevel: 0,
      onFatalError: () => setReady(false),
    })
      .then((nextController) => {
        if (cancelled) {
          nextController.destroy();
          return;
        }

        controller = nextController;
        // Autoplay can still be refused even when muted; failing here just leaves the scrim.
        void video.play().catch(() => {});
      })
      .catch(() => setReady(false));

    return () => {
      cancelled = true;
      controller?.destroy();
      video.removeEventListener("canplay", markReady);
    };
  }, [manifestUrl]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <video
        ref={ref}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`}
        muted
        loop
        playsInline
        preload="auto"
        poster={posterUrl}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
