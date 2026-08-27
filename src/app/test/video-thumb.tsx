"use client";

import { useRef } from "react";

type VideoThumbProps = {
  src: string;
  width: number;
  height: number;
  label: string;
};

export function VideoThumb({ src, width, height, label }: VideoThumbProps) {
  const ref = useRef<HTMLVideoElement>(null);

  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      preload="metadata"
      aria-label={label}
      // Reserve space before metadata loads so the masonry doesn't reflow.
      style={{ aspectRatio: `${width} / ${height}` }}
      onMouseEnter={() => void ref.current?.play().catch(() => {})}
      onMouseLeave={() => {
        const video = ref.current;
        if (!video) return;
        video.pause();
        video.currentTime = 0;
      }}
    />
  );
}
