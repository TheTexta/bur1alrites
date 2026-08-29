"use client";

import { useEffect, useRef, useState } from "react";

import { attachHlsStream } from "@/lib/hls-stream";

const ACTIVATE_PREVIEW_EVENT = "portfolio:activate-preview";

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
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    function handlePreviewActivation(event: Event) {
      const activeVideo = (event as CustomEvent<HTMLVideoElement>).detail;
      const video = ref.current;

      if (!video || activeVideo === video) return;

      video.pause();
      video.currentTime = 0;
      controllerRef.current?.destroy();
      controllerRef.current = null;
      setIsActive(false);
    }

    window.addEventListener(ACTIVATE_PREVIEW_EVENT, handlePreviewActivation);

    return () => {
      window.removeEventListener(ACTIVATE_PREVIEW_EVENT, handlePreviewActivation);
      controllerRef.current?.destroy();
    };
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

  function activatePreview() {
    const video = ref.current;
    if (!video) return;

    window.dispatchEvent(
      new CustomEvent<HTMLVideoElement>(ACTIVATE_PREVIEW_EVENT, {
        detail: video,
      }),
    );
    setIsActive(true);
    void playPreview();
  }

  function deactivatePreview() {
    setIsActive(false);
    stopPreview();
  }

  return (
    <span
      data-active={isActive ? "" : undefined}
      className={`relative block min-h-[60px] w-full overflow-hidden bg-[#050505] transition-[filter] ${isActive ? "grayscale-0 invert-0" : "grayscale invert"}`}
    >
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        poster={posterUrl}
        aria-label={label}
        className="block h-auto w-full"
        // Reserve space before metadata loads so the masonry doesn't reflow.
        style={{ aspectRatio: `${width} / ${height}` }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") activatePreview();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") deactivatePreview();
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;

          if (isActive) deactivatePreview();
          else activatePreview();
        }}
      />
    </span>
  );
}
