export type HlsStreamController = {
  destroy: () => void;
  startLoading: () => void;
  stopLoading: () => void;
};

type AttachHlsStreamOptions = {
  startLevel?: number;
  onFatalError?: () => void;
  preferNative?: boolean;
  preview?: boolean;
  signal?: AbortSignal;
};

const HLS_MIME_TYPE = "application/vnd.apple.mpegurl";

// Aborting an attachment must destroy it synchronously. A late promise cleanup may
// otherwise detach a newer stream attached to the same HTML thumbnail element.
function ownStream(controller: HlsStreamController, signal?: AbortSignal): HlsStreamController {
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    signal?.removeEventListener("abort", destroy);
    controller.destroy();
  };
  signal?.addEventListener("abort", destroy, { once: true });
  if (signal?.aborted) destroy();
  return {
    destroy,
    startLoading: () => { if (!destroyed) controller.startLoading(); },
    stopLoading: () => { if (!destroyed) controller.stopLoading(); },
  };
}

function attachNativeStream(
  video: HTMLVideoElement,
  manifestUrl: string,
  options: AttachHlsStreamOptions,
) {
  const onError = () => options.onFatalError?.();
  video.addEventListener("error", onError);
  video.src = manifestUrl;
  return ownStream({
    destroy: () => {
      video.removeEventListener("error", onError);
      video.removeAttribute("src");
      video.load();
    },
    startLoading: () => {},
    stopLoading: () => {},
  }, options.signal);
}

export async function attachHlsStream(
  video: HTMLVideoElement,
  manifestUrl: string,
  options: AttachHlsStreamOptions = {},
): Promise<HlsStreamController> {
  options.signal?.throwIfAborted();
  if (options.preferNative && video.canPlayType(HLS_MIME_TYPE)) {
    return attachNativeStream(video, manifestUrl, options);
  }

  const { default: Hls } = await import("hls.js");
  options.signal?.throwIfAborted();

  if (Hls.isSupported()) {
    const player = new Hls({
      autoStartLoad: true,
      capLevelToPlayerSize: !options.preview,
      maxBufferLength: options.preview ? 4 : 12,
      ...(options.preview ? { maxMaxBufferLength: 4 } : {}),
      startLevel: options.startLevel ?? -1,
    });
    if (options.preview) player.autoLevelCapping = 0;

    player.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        options.onFatalError?.();
      }
    });
    player.loadSource(manifestUrl);
    player.attachMedia(video);

    return ownStream({
      destroy: () => player.destroy(),
      startLoading: () => player.startLoad(),
      stopLoading: () => player.stopLoad(),
    }, options.signal);
  }

  if (video.canPlayType(HLS_MIME_TYPE)) {
    return attachNativeStream(video, manifestUrl, options);
  }

  throw new Error("This browser cannot play HLS video.");
}
