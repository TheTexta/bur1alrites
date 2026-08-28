export type HlsStreamController = {
  destroy: () => void;
};

type AttachHlsStreamOptions = {
  startLevel?: number;
  onFatalError?: () => void;
};

const HLS_MIME_TYPE = "application/vnd.apple.mpegurl";

export async function attachHlsStream(
  video: HTMLVideoElement,
  manifestUrl: string,
  options: AttachHlsStreamOptions = {},
): Promise<HlsStreamController> {
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
    };
  }

  if (video.canPlayType(HLS_MIME_TYPE)) {
    video.src = manifestUrl;

    return {
      destroy: () => {
        video.removeAttribute("src");
        video.load();
      },
    };
  }

  throw new Error("This browser cannot play HLS video.");
}
