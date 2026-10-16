import { attachHlsStream, type HlsStreamController } from "./hls-stream";

type Preview = {
  video: HTMLVideoElement;
  controller: HlsStreamController | null;
  abort: AbortController;
  cleanup: () => void;
  playVersion: number;
  frameRequest: number | null;
  presented: boolean;
  lastTime: number;
  lastFrames: number;
  lastProgress: number;
};

const STALL_TIMEOUT_MS = 8_000;
const RECOVERY_DELAYS_MS = [500, 1_500];

export function createViewportVideoPool(
  manifests: Map<string, string>,
  options: {
    preferNative: boolean;
    onReady: (slug: string, video: HTMLVideoElement) => void;
    onUnavailable?: (slug: string) => void;
    createVideo?: () => HTMLVideoElement;
    attach?: typeof attachHlsStream;
  },
) {
  const previews = new Map<string, Preview>();
  const visible = new Set<string>();
  let active: string | null = null;
  let disposed = false;
  let recoveryAttempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  const page = typeof document === "undefined" ? null : document;
  const browser = typeof window === "undefined" ? null : window;

  const isCurrent = (slug: string, preview: Preview) => previews.get(slug) === preview;
  const canPlay = (slug: string) => !disposed && active === slug && !page?.hidden;

  function clearTimers() {
    if (retryTimer !== null) clearTimeout(retryTimer);
    if (watchdog !== null) clearInterval(watchdog);
    retryTimer = watchdog = null;
  }

  function cancelFrame(preview: Preview) {
    if (preview.frameRequest !== null) {
      preview.video.cancelVideoFrameCallback?.(preview.frameRequest);
      preview.frameRequest = null;
    }
  }

  function release(slug: string) {
    const preview = previews.get(slug);
    if (!preview) return;
    previews.delete(slug);
    const { video, controller } = preview;
    preview.cleanup();
    cancelFrame(preview);
    preview.abort.abort();
    video.pause();
    controller?.destroy();
    video.removeAttribute("src");
    video.preload = "none";
    video.load();
    if (active === slug) options.onUnavailable?.(slug);
  }

  function recover(slug: string) {
    if (!canPlay(slug) || retryTimer !== null || recoveryAttempts >= RECOVERY_DELAYS_MS.length) return;
    // Do not spend the retry budget while the browser knows it is offline.
    if (browser && !browser.navigator.onLine) return;
    const delay = RECOVERY_DELAYS_MS[recoveryAttempts++];
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (canPlay(slug)) start(slug);
    }, delay);
  }

  function fail(slug: string, preview: Preview, retry = true) {
    if (!isCurrent(slug, preview)) return;
    if (active === slug) clearTimers();
    release(slug);
    if (retry) recover(slug);
  }

  function present(slug: string, preview: Preview) {
    if (!isCurrent(slug, preview) || !canPlay(slug) || preview.video.paused || preview.video.readyState < 2) return;
    if (!preview.presented) {
      preview.presented = true;
      options.onReady(slug, preview.video);
    }
  }

  function requestFrame(slug: string, preview: Preview) {
    if (preview.frameRequest !== null || preview.presented || !preview.video.requestVideoFrameCallback) return;
    const version = preview.playVersion;
    preview.frameRequest = preview.video.requestVideoFrameCallback(() => {
      if (!isCurrent(slug, preview) || version !== preview.playVersion) return;
      preview.frameRequest = null;
      present(slug, preview);
    });
  }

  function ready(slug: string, preview: Preview) {
    if (!isCurrent(slug, preview)) return;
    if (canPlay(slug)) {
      requestFrame(slug, preview);
      if (!preview.video.requestVideoFrameCallback) present(slug, preview);
    } else if (preview.video.readyState >= 2) preview.controller?.stopLoading();
  }

  function play(slug: string, preview: Preview) {
    cancelFrame(preview);
    const version = ++preview.playVersion;
    preview.controller?.startLoading();
    requestFrame(slug, preview);
    // Never lock out a new play request behind an older pending promise. A rapid
    // leave/re-enter must issue play() again even before pause() settles that promise.
    void preview.video.play().then(() => {
      if (isCurrent(slug, preview) && version === preview.playVersion && canPlay(slug)) ready(slug, preview);
    }, (error: unknown) => {
      if (!isCurrent(slug, preview) || version !== preview.playVersion || !canPlay(slug)) return;
      const name = (error as { name?: string } | null)?.name;
      fail(slug, preview, name !== "NotAllowedError" && name !== "NotSupportedError");
    });
  }

  function watch(slug: string, preview: Preview) {
    if (watchdog !== null) clearInterval(watchdog);
    preview.lastTime = preview.video.currentTime;
    preview.lastFrames = preview.video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
    preview.lastProgress = Date.now();
    watchdog = setInterval(() => {
      if (!isCurrent(slug, preview) || !canPlay(slug)) return;
      const time = preview.video.currentTime;
      const frames = preview.video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
      // A short looping clip can have the same media time on consecutive ticks.
      if (!preview.video.paused && (time !== preview.lastTime || frames > preview.lastFrames)) {
        preview.lastTime = time;
        preview.lastFrames = frames;
        preview.lastProgress = Date.now();
        present(slug, preview);
      } else if (Date.now() - preview.lastProgress >= STALL_TIMEOUT_MS) {
        fail(slug, preview);
      }
    }, 1_000);
  }

  function ensure(slug: string): Preview | null {
    if (disposed || page?.hidden || !manifests.has(slug)) return null;
    const existing = previews.get(slug);
    if (existing) return existing;
    const video = options.createVideo?.() ?? document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    const preview: Preview = {
      video, controller: null, abort: new AbortController(), cleanup: () => {},
      playVersion: 0, frameRequest: null, presented: false,
      lastTime: 0, lastFrames: 0, lastProgress: Date.now(),
    };
    previews.set(slug, preview);
    const onReady = () => ready(slug, preview);
    const onProgress = () => {
      if (video.currentTime !== preview.lastTime) present(slug, preview);
    };
    const onError = () => fail(slug, preview);
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("seeked", onReady);
    video.addEventListener("playing", onReady);
    video.addEventListener("timeupdate", onProgress);
    video.addEventListener("error", onError);
    preview.cleanup = () => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("seeked", onReady);
      video.removeEventListener("playing", onReady);
      video.removeEventListener("timeupdate", onProgress);
      video.removeEventListener("error", onError);
    };
    void (options.attach ?? attachHlsStream)(video, manifests.get(slug)!, {
      startLevel: 0, preferNative: options.preferNative, preview: true,
      signal: preview.abort.signal, onFatalError: onError,
    }).then(controller => {
      if (previews.get(slug) !== preview) {
        controller.destroy();
        return;
      }
      preview.controller = controller;
      if (canPlay(slug)) play(slug, preview);
      else if (video.readyState >= 2) controller.stopLoading();
    }, () => {
      fail(slug, preview);
    });
    return preview;
  }

  function start(slug: string) {
    const preview = ensure(slug);
    if (preview && canPlay(slug)) {
      watch(slug, preview);
      if (preview.controller) play(slug, preview);
    }
    return preview?.video ?? null;
  }

  function deactivate(slug = active) {
    if (!slug || active !== slug) return;
    clearTimers();
    active = null;
    const preview = previews.get(slug);
    if (preview) {
      preview.playVersion++;
      preview.presented = false;
      cancelFrame(preview);
      preview.video.pause();
      if (preview.video.readyState >= 1) preview.video.currentTime = 0;
      preview.controller?.stopLoading();
    }
    options.onUnavailable?.(slug);
    if (!visible.has(slug)) release(slug);
  }

  const onVisibilityChange = () => {
    clearTimers();
    if (page?.hidden) {
      for (const slug of previews.keys()) release(slug);
    } else {
      for (const slug of visible) ensure(slug);
      if (active && visible.has(active)) start(active);
    }
  };
  const onOnline = () => {
    if (!active || !canPlay(active)) return;
    clearTimers();
    recoveryAttempts = 0;
    start(active);
  };
  page?.addEventListener("visibilitychange", onVisibilityChange);
  browser?.addEventListener("online", onOnline);

  return {
    setVisible(slug: string, inViewport: boolean) {
      if (inViewport) {
        visible.add(slug);
        ensure(slug);
      } else {
        visible.delete(slug);
        if (active === slug) deactivate(slug);
        release(slug);
      }
    },
    activate(slug: string) {
      if (disposed || !manifests.has(slug)) return null;
      if (active !== slug) {
        deactivate();
        recoveryAttempts = 0;
      }
      clearTimers();
      active = slug;
      return start(slug);
    },
    deactivate,
    dispose() {
      disposed = true;
      clearTimers();
      page?.removeEventListener("visibilitychange", onVisibilityChange);
      browser?.removeEventListener("online", onOnline);
      active = null;
      visible.clear();
      for (const slug of previews.keys()) release(slug);
    },
  };
}
