import { describe, expect, it, vi } from "vitest";
import { createViewportVideoPool } from "./viewport-video-pool";
import type { HlsStreamController } from "./hls-stream";

class Video extends EventTarget {
  readyState = 0;
  currentTime = 0;
  paused = true;
  muted = false;
  loop = false;
  playsInline = false;
  preload = "none";
  crossOrigin = "";
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  removeAttribute = vi.fn();
  load = vi.fn();
  decode() { this.readyState = 2; this.dispatchEvent(new Event("loadeddata")); }
}

function controller() { return { destroy: vi.fn(), startLoading: vi.fn(), stopLoading: vi.fn() }; }
function setup() {
  const videos: Video[] = [];
  const controllers: ReturnType<typeof controller>[] = [];
  const attach = vi.fn(async () => { const c = controller(); controllers.push(c); return c; });
  const onReady = vi.fn();
  const pool = createViewportVideoPool(new Map([["a", "a.m3u8"], ["b", "b.m3u8"], ["offscreen", "offscreen.m3u8"]]), {
    preferNative: false, onReady, attach,
    createVideo: () => { const video = new Video(); videos.push(video); return video as unknown as HTMLVideoElement; },
  });
  return { pool, videos, controllers, attach, onReady };
}

describe("viewport preview videos", () => {
  it("decodes visible cards before hover, stops idle buffering, and reuses them immediately", async () => {
    const { pool, videos, controllers, attach, onReady } = setup();
    pool.setVisible("a", true);
    pool.setVisible("b", true);
    await Promise.resolve();
    expect(attach).toHaveBeenCalledTimes(2);
    expect(attach).toHaveBeenCalledWith(videos[0], "a.m3u8", expect.objectContaining({ preview: true, startLevel: 0 }));
    videos.forEach(video => video.decode());
    expect(videos.every(video => video.paused)).toBe(true);
    expect(onReady).not.toHaveBeenCalled();
    expect(controllers[0].stopLoading).toHaveBeenCalled();
    pool.activate("a");
    expect(onReady).toHaveBeenCalledWith("a", videos[0]);
    expect(videos[0].play).toHaveBeenCalledOnce();
    pool.activate("b");
    expect(videos[0].paused).toBe(true);
    expect(controllers[0].destroy).not.toHaveBeenCalled();
    pool.activate("a");
    expect(attach).toHaveBeenCalledTimes(2);
    expect(videos[1].paused).toBe(true);
    pool.dispose();
  });

  it("releases videos scrolled away and retains an active preview only until hover ends", async () => {
    const { pool, controllers } = setup();
    pool.setVisible("a", true);
    pool.setVisible("b", true);
    await Promise.resolve();
    pool.activate("a");
    pool.setVisible("a", false);
    pool.setVisible("b", false);
    expect(controllers[0].destroy).not.toHaveBeenCalled();
    expect(controllers[1].destroy).toHaveBeenCalledOnce();
    pool.deactivate();
    expect(controllers[0].destroy).toHaveBeenCalledOnce();
    pool.dispose();
    expect(controllers[0].destroy).toHaveBeenCalledOnce();
  });

  it("destroys late attachments after scrolling away without disturbing a replacement", async () => {
    const pending: ((controller: HlsStreamController) => void)[] = [];
    const attach = vi.fn(() => new Promise<HlsStreamController>(resolve => pending.push(resolve)));
    const pool = createViewportVideoPool(new Map([["a", "a.m3u8"]]), {
      preferNative: false, onReady: vi.fn(), attach,
      createVideo: () => new Video() as unknown as HTMLVideoElement,
    });
    pool.setVisible("a", true);
    pool.setVisible("a", false);
    pool.setVisible("a", true);
    const stale = controller(); const current = controller();
    pending[0](stale); pending[1](current);
    await Promise.resolve();
    expect(stale.destroy).toHaveBeenCalledOnce();
    expect(current.destroy).not.toHaveBeenCalled();
    pool.dispose();
    expect(current.destroy).toHaveBeenCalledOnce();
    pool.setVisible("a", true);
    expect(attach).toHaveBeenCalledTimes(2);
  });
});
