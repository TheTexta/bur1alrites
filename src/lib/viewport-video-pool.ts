import { attachHlsStream, type HlsStreamController } from "./hls-stream";

type Preview = {
  video: HTMLVideoElement;
  controller: HlsStreamController | null;
  ready: () => void;
};

export function createViewportVideoPool(
  manifests: Map<string, string>,
  options: {
    preferNative: boolean;
    onReady: (slug: string, video: HTMLVideoElement) => void;
    createVideo?: () => HTMLVideoElement;
    attach?: typeof attachHlsStream;
  },
) {
  const previews = new Map<string, Preview>();
  const visible = new Set<string>();
  let active: string | null = null;
  let disposed = false;

  function release(slug: string) {
    const preview = previews.get(slug);
    if (!preview) return;
    previews.delete(slug);
    const { video, controller, ready } = preview;
    video.removeEventListener("loadeddata", ready);
    video.removeEventListener("seeked", ready);
    video.pause();
    controller?.destroy();
    video.removeAttribute("src");
    video.preload = "none";
    video.load();
  }

  function ensure(slug: string): Preview | null {
    if (disposed || !manifests.has(slug)) return null;
    const existing = previews.get(slug);
    if (existing) return existing;
    const video = options.createVideo?.() ?? document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    const preview: Preview = {
      video, controller: null,
      ready: () => {
        if (previews.get(slug) !== preview) return;
        if (active === slug) options.onReady(slug, video);
        else preview.controller?.stopLoading();
      },
    };
    previews.set(slug, preview);
    video.addEventListener("loadeddata", preview.ready);
    video.addEventListener("seeked", preview.ready);
    void (options.attach ?? attachHlsStream)(video, manifests.get(slug)!, {
      startLevel: 0, preferNative: options.preferNative, preview: true,
    }).then(controller => {
      if (previews.get(slug) !== preview) {
        controller.destroy();
        return;
      }
      preview.controller = controller;
      if (active === slug) {
        controller.startLoading();
        void video.play().catch(() => {});
      } else if (video.readyState >= 2) controller.stopLoading();
      if (video.readyState >= 2) preview.ready();
    }, () => {
      if (previews.get(slug) === preview) release(slug);
    });
    return preview;
  }

  function deactivate(slug = active) {
    if (!slug || active !== slug) return;
    active = null;
    const preview = previews.get(slug);
    if (preview) {
      preview.video.pause();
      preview.video.currentTime = 0;
      preview.controller?.stopLoading();
    }
    if (!visible.has(slug)) release(slug);
  }

  return {
    setVisible(slug: string, inViewport: boolean) {
      if (inViewport) {
        visible.add(slug);
        ensure(slug);
      } else {
        visible.delete(slug);
        if (active !== slug) release(slug);
      }
    },
    activate(slug: string) {
      if (active !== slug) deactivate();
      active = slug;
      const preview = ensure(slug);
      if (!preview) { active = null; return null; }
      if (preview.controller) {
        preview.controller.startLoading();
        void preview.video.play().catch(() => {});
      }
      if (preview.video.readyState >= 2) preview.ready();
      return preview.video;
    },
    deactivate,
    dispose() {
      disposed = true;
      active = null;
      visible.clear();
      for (const slug of previews.keys()) release(slug);
    },
  };
}
