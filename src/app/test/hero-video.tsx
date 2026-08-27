"use client";

import { useEffect, useRef, useState } from "react";

type HeroVideoProps = {
  src: string;
};

export function HeroVideo({ src }: HeroVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const markReady = () => setReady(true);

    if (video.readyState >= 3) markReady();
    video.addEventListener("canplay", markReady);
    // Autoplay can still be refused even when muted; failing here just leaves the scrim.
    void video.play().catch(() => {});

    return () => video.removeEventListener("canplay", markReady);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <video
        ref={ref}
        src={src}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`}
        muted
        loop
        playsInline
        preload="auto"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
