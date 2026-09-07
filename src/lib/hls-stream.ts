export type HlsStreamController = {
  destroy: () => void;
  startLoading: () => void;
  stopLoading: () => void;
};

type AttachHlsStreamOptions = {
  startLevel?: number;
  onFatalError?: () => void;
  preferNative?: boolean;
};

const HLS_MIME_TYPE = "application/vnd.apple.mpegurl";

export async function attachHlsStream(
  video: HTMLVideoElement,
  manifestUrl: string,
  options: AttachHlsStreamOptions = {},
): Promise<HlsStreamController> {
  if (options.preferNative && video.canPlayType(HLS_MIME_TYPE)) {
    video.src = manifestUrl;

    return {
      destroy: () => {
        video.removeAttribute("src");
        video.load();
      },
      startLoading: () => {},
      stopLoading: () => {},
    };
  }

  const { default: Hls } = await import("hls.js");

  if (Hls.isSupported()) {
    const player = new Hls({
      autoStartLoad: true,
      capLevelToPlayerSize: true,
      maxBufferLength: 12,
      startLevel: options.startLevel ?? -1,
    });

    player.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        options.onFatalError?.();
      }
    });
    player.loadSource(manifestUrl);
    player.attachMedia(video);

    return {
      destroy: () => player.destroy(),
      startLoading: () => player.startLoad(),
      stopLoading: () => player.stopLoad(),
    };
  }

  if (video.canPlayType(HLS_MIME_TYPE)) {
    video.src = manifestUrl;

    return {
      destroy: () => {
        video.removeAttribute("src");
        video.load();
      },
      startLoading: () => {},
      stopLoading: () => {},
    };
  }

  throw new Error("This browser cannot play HLS video.");
}
