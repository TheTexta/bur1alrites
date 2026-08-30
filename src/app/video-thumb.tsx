"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { RenderMode } from "@/lib/browser-render-mode";
import { attachHlsStream } from "@/lib/hls-stream";

const ACTIVATE_PREVIEW_EVENT = "portfolio:activate-preview";
const WEBKIT_PRELOAD_MARGIN = "25% 0px";

type StreamController = Awaited<ReturnType<typeof attachHlsStream>>;

type VideoThumbProps = {
  manifestUrl: string;
  posterUrl: string;
  width: number;
  height: number;
  label: string;
  renderMode: RenderMode;
};

export function VideoThumb({
  manifestUrl,
  posterUrl,
  width,
  height,
  label,
  renderMode,
}: VideoThumbProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const activeRef = useRef(false);
  const nearViewportRef = useRef(false);
  const controllerRef = useRef<StreamController | null>(null);
  const attachPromiseRef = useRef<Promise<StreamController> | null>(null);
  const loadingRef = useRef(false);
  const [isActive, setIsActive] = useState(false);
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const isWebKitSafe = renderMode === "webkit-safe";

  useEffect(() => {
    function handlePreviewActivation(event: Event) {
      const activeVideo = (event as CustomEvent<HTMLVideoElement>).detail;
      const video = ref.current;

      if (!video || activeVideo === video || !activeRef.current) return;

      video.pause();
      video.currentTime = 0;
      activeRef.current = false;
      setIsActive(false);
      setHasFirstFrame(false);

      if (!isWebKitSafe || !nearViewportRef.current) {
        attachPromiseRef.current = null;
        controllerRef.current?.destroy();
        controllerRef.current = null;
      }
    }

    window.addEventListener(ACTIVATE_PREVIEW_EVENT, handlePreviewActivation);

    return () => {
      window.removeEventListener(ACTIVATE_PREVIEW_EVENT, handlePreviewActivation);
      activeRef.current = false;
      attachPromiseRef.current = null;
      controllerRef.current?.destroy();
    };
  }, [isWebKitSafe]);

  useEffect(() => {
    const video = ref.current;
    if (!video || !isWebKitSafe) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        nearViewportRef.current = entry.isIntersecting;

        if (entry.isIntersecting) {
          video.preload = "auto";

          if (!controllerRef.current && !attachPromiseRef.current) {
            const request = attachHlsStream(video, manifestUrl, {
              startLevel: 0,
              preferNative: true,
            });
            attachPromiseRef.current = request;

            void request.then(
              (controller) => {
                if (attachPromiseRef.current === request) {
                  controllerRef.current = controller;
                  attachPromiseRef.current = null;
                } else {
                  controller.destroy();
                }
              },
              () => {
                if (attachPromiseRef.current === request) {
                  attachPromiseRef.current = null;
                }
              },
            );
          }

          return;
        }

        video.preload = "none";

        if (!activeRef.current) {
          attachPromiseRef.current = null;
          controllerRef.current?.destroy();
          controllerRef.current = null;
        }
      },
      { rootMargin: WEBKIT_PRELOAD_MARGIN, threshold: 0.01 },
    );

    observer.observe(video);

    return () => {
      nearViewportRef.current = false;
      observer.disconnect();
    };
  }, [isWebKitSafe, manifestUrl]);

  async function playPreview() {
    const video = ref.current;
    if (!video || loadingRef.current) return;

    loadingRef.current = true;
    let request: Promise<StreamController> | null = null;

    try {
      if (!controllerRef.current) {
        request = attachPromiseRef.current;

        if (!request) {
          request = attachHlsStream(video, manifestUrl, {
            startLevel: 0,
            preferNative: isWebKitSafe,
          });
          attachPromiseRef.current = request;
        }

        const controller = await request;

        if (controllerRef.current !== controller && attachPromiseRef.current !== request) {
          return;
        }

        if (!activeRef.current) {
          if (isWebKitSafe && nearViewportRef.current) {
            controllerRef.current = controller;
            if (attachPromiseRef.current === request) attachPromiseRef.current = null;
          } else {
            controller.destroy();
          }
          return;
        }

        controllerRef.current = controller;
        if (attachPromiseRef.current === request) attachPromiseRef.current = null;
      }

      await video.play();

      if (isWebKitSafe && activeRef.current && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        setHasFirstFrame(true);
      }
    } catch {
      if (request && attachPromiseRef.current === request) {
        attachPromiseRef.current = null;
      }
      // The poster remains visible if a stream is not ready yet.
    } finally {
      loadingRef.current = false;
    }
  }

  function stopPreview() {
    activeRef.current = false;
    setHasFirstFrame(false);

    const video = ref.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }

    if (!isWebKitSafe || !nearViewportRef.current) {
      attachPromiseRef.current = null;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    }
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
    void playPreview();
  }

  function deactivatePreview() {
    setIsActive(false);
    stopPreview();
  }

  return (
    <span
      data-active={isActive ? "" : undefined}
      className={`relative block min-h-[60px] w-full overflow-hidden ${isWebKitSafe ? "" : `transition-[filter] ${isActive ? "grayscale-0 invert-0" : "grayscale invert"}`}`}
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
        onLoadedData={() => {
          if (isWebKitSafe && activeRef.current) setHasFirstFrame(true);
        }}
      />
      {isWebKitSafe ? (
        <Image
          src={posterUrl}
          alt=""
          aria-hidden="true"
          width={width}
          height={height}
          sizes="(max-width: 767px) 100vw, (max-width: 991px) 50vw, (max-width: 1279px) 33vw, 25vw"
          unoptimized
          className={`pointer-events-none absolute inset-0 z-10 h-full w-full object-cover transition-[filter] duration-150 ${isActive ? "grayscale-0 invert-0" : "grayscale invert"} ${isActive && hasFirstFrame ? "opacity-0 transition-[filter,opacity]" : "opacity-100"}`}
        />
      ) : null}
    </span>
  );
}
