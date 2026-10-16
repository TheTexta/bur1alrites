"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { RenderMode } from "@/lib/browser-render-mode";
import { createViewportVideoPool } from "@/lib/viewport-video-pool";
import { getVideoPreviewHref } from "./preview-navigation-bridge";
import { OPEN_ROOM_EVENT, openVideoRoom } from "./video-room";

const ACTIVATE_PREVIEW_EVENT = "portfolio:activate-preview";
const PRELOAD_MARGIN = "25% 0px";

type VideoThumbProps = {
  slug: string;
  manifestUrl: string;
  posterUrl: string;
  width: number;
  height: number;
  label: string;
  renderMode: RenderMode;
  playInFrameOnTap: boolean;
};

export function VideoThumb({
  slug,
  manifestUrl,
  posterUrl,
  width,
  height,
  label,
  renderMode,
  playInFrameOnTap,
}: VideoThumbProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const activeRef = useRef(false);
  const poolRef = useRef<ReturnType<typeof createViewportVideoPool> | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const isWebKitSafe = renderMode === "webkit-safe";

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const pool = createViewportVideoPool(new Map([[slug, manifestUrl]]), {
      preferNative: isWebKitSafe,
      createVideo: () => video,
      onReady: () => {
        if (activeRef.current) setHasFirstFrame(true);
      },
      onUnavailable: () => setHasFirstFrame(false),
    });
    poolRef.current = pool;

    function deactivate() {
      activeRef.current = false;
      setIsActive(false);
      setHasFirstFrame(false);
      pool.deactivate();
    }

    function handlePreviewActivation(event: Event) {
      const activeVideo = (event as CustomEvent<HTMLVideoElement>).detail;
      if (activeVideo !== video && activeRef.current) deactivate();
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting && activeRef.current) deactivate();
        pool.setVisible(slug, entry.isIntersecting);
      },
      { rootMargin: PRELOAD_MARGIN, threshold: 0.01 },
    );

    observer.observe(video);
    window.addEventListener(ACTIVATE_PREVIEW_EVENT, handlePreviewActivation);
    window.addEventListener("blur", deactivate);
    window.addEventListener(OPEN_ROOM_EVENT, deactivate);

    return () => {
      window.removeEventListener(ACTIVATE_PREVIEW_EVENT, handlePreviewActivation);
      window.removeEventListener("blur", deactivate);
      window.removeEventListener(OPEN_ROOM_EVENT, deactivate);
      observer.disconnect();
      activeRef.current = false;
      poolRef.current = null;
      pool.dispose();
    };
  }, [isWebKitSafe, manifestUrl, slug]);

  function stopPreview() {
    activeRef.current = false;
    setIsActive(false);
    setHasFirstFrame(false);
    poolRef.current?.deactivate();
  }

  function activatePreview() {
    const video = ref.current;
    if (!video) return;

    window.dispatchEvent(
      new CustomEvent<HTMLVideoElement>(ACTIVATE_PREVIEW_EVENT, {
        detail: video,
      }),
    );
    activeRef.current = true;
    setIsActive(true);
    setHasFirstFrame(false);
    poolRef.current?.activate(slug);
  }

  function deactivatePreview() {
    stopPreview();
  }

  return (
    <button
      type="button"
      data-preview-href={getVideoPreviewHref(slug)}
      aria-label={
        playInFrameOnTap
          ? `${isActive ? "Pause" : "Play"} ${label}`
          : `Open ${label}`
      }
      aria-pressed={playInFrameOnTap ? isActive : undefined}
      data-active={isActive ? "" : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") activatePreview();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") deactivatePreview();
      }}
      onClick={() => {
        if (playInFrameOnTap) {
          if (isActive) deactivatePreview();
          else activatePreview();
          return;
        }

        stopPreview();
        openVideoRoom({ manifestUrl, posterUrl, label, width, height });
      }}
      className={`group relative block min-h-[60px] w-full appearance-none overflow-hidden border-0 p-0 text-inherit ${isWebKitSafe ? "" : `transition-[filter] focus-visible:grayscale-0 focus-visible:invert-0 ${isActive ? "grayscale-0 invert-0" : "grayscale invert"}`}`}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {/* Pointer events stay on the wrapper above, so the hit-test box never moves and
          hover/invert state can't flicker. */}
      <span className="absolute inset-0 block">
        <video
          ref={ref}
          muted
          loop
          playsInline
          preload="none"
          poster={posterUrl}
          aria-hidden="true"
          className="pointer-events-none block h-full w-full object-cover"
        />
        <Image
          src={posterUrl}
          alt=""
          aria-hidden="true"
          width={width}
          height={height}
          sizes="(max-width: 767px) 100vw, (max-width: 991px) 50vw, (max-width: 1279px) 33vw, 25vw"
          unoptimized
          className={`pointer-events-none absolute inset-0 z-10 h-full w-full object-cover transition-[filter,opacity] duration-150 ${isWebKitSafe ? `group-focus-visible:grayscale-0 group-focus-visible:invert-0 ${isActive ? "grayscale-0 invert-0" : "grayscale invert"}` : ""} ${isActive && hasFirstFrame ? "opacity-0" : "opacity-100"}`}
        />
      </span>
    </button>
  );
}
