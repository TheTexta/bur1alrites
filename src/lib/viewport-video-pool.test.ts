import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createViewportVideoPool } from "./viewport-video-pool";
import type { attachHlsStream, HlsStreamController } from "./hls-stream";

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
  load = vi.fn(() => { this.readyState = 0; this.currentTime = 0; });
  decode() { this.readyState = 2; this.dispatchEvent(new Event("loadeddata")); }
}

function controller() { return { destroy: vi.fn(), startLoading: vi.fn(), stopLoading: vi.fn() }; }
const pools: ReturnType<typeof createViewportVideoPool>[] = [];
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

function setup(createVideo?: () => Video) {
  const videos: Video[] = [];
  const controllers: ReturnType<typeof controller>[] = [];
  const attach = vi.fn<typeof attachHlsStream>(async () => { const c = controller(); controllers.push(c); return c; });
  const onReady = vi.fn();
  const onUnavailable = vi.fn();
  const pool = createViewportVideoPool(new Map([["a", "a.m3u8"], ["b", "b.m3u8"], ["offscreen", "offscreen.m3u8"]]), {
    preferNative: false, onReady, onUnavailable, attach,
    createVideo: () => { const video = createVideo?.() ?? new Video(); videos.push(video); return video as unknown as HTMLVideoElement; },
  });
  pools.push(pool);
  return { pool, videos, controllers, attach, onReady, onUnavailable };
}

describe("viewport preview videos", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const pool of pools.splice(0)) pool.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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
    await settle();
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

  it("releases videos and cancels recovery when scrolled away, even while active", async () => {
    const { pool, controllers } = setup();
    pool.setVisible("a", true);
    pool.setVisible("b", true);
    await Promise.resolve();
    pool.activate("a");
    pool.setVisible("a", false);
    pool.setVisible("b", false);
    expect(controllers[0].destroy).toHaveBeenCalledOnce();
    expect(controllers[1].destroy).toHaveBeenCalledOnce();
    pool.deactivate();
    expect(controllers[0].destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
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
    pools.push(pool);
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

  it("does not drop a rapid leave/re-enter behind a pending play promise", async () => {
    const { pool, videos, attach, onReady } = setup();
    pool.setVisible("a", true);
    await settle();
    const video = videos[0];
    video.decode();
    let finish!: () => void;
    video.play.mockImplementationOnce(() => new Promise<void>(resolve => {
      video.paused = false;
      finish = resolve;
    }));
    pool.activate("a");
    pool.deactivate();
    pool.activate("a");
    finish();
    await settle();
    expect(video.play).toHaveBeenCalledTimes(2);
    expect(video.paused).toBe(false);
    expect(onReady).toHaveBeenCalledOnce();
    expect(attach).toHaveBeenCalledOnce();
  });

  it("ignores rejection from an interrupted, superseded play request", async () => {
    const { pool, videos, controllers, onReady } = setup();
    pool.setVisible("a", true);
    await settle();
    videos[0].decode();
    let reject!: (error: Error) => void;
    videos[0].play.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
    pool.activate("a");
    pool.deactivate();
    pool.activate("a");
    reject(new DOMException("Interrupted", "AbortError"));
    await settle();
    expect(controllers[0].destroy).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("discards a fatal preloading failure and creates a fresh stream on hover", async () => {
    const { pool, videos, controllers, attach } = setup();
    pool.setVisible("a", true);
    await settle();
    const options = attach.mock.calls[0][2]!;
    options.onFatalError!();
    expect(options.signal!.aborted).toBe(true);
    expect(controllers[0].destroy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(attach).toHaveBeenCalledOnce();
    pool.activate("a");
    await settle();
    expect(attach).toHaveBeenCalledTimes(2);
    expect(videos[1].play).toHaveBeenCalledOnce();
  });

  it("replaces an active fatal stream and publishes the replacement video only", async () => {
    const { pool, videos, controllers, attach, onReady, onUnavailable } = setup();
    pool.setVisible("a", true);
    await settle();
    videos[0].decode();
    pool.activate("a");
    await settle();
    expect(onReady).toHaveBeenLastCalledWith("a", videos[0]);
    attach.mock.calls[0][2]!.onFatalError!();
    expect(onUnavailable).toHaveBeenCalledWith("a");
    expect(controllers[0].destroy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    videos[1].decode();
    await settle();
    expect(onReady).toHaveBeenLastCalledWith("a", videos[1]);
    // A late error from the old player must not destroy its replacement.
    attach.mock.calls[0][2]!.onFatalError!();
    expect(controllers[1].destroy).not.toHaveBeenCalled();
  });

  it("bounds automatic retries and allows a new hover to try again", async () => {
    const { pool, attach } = setup();
    attach.mockRejectedValue(new Error("Network unavailable"));
    pool.setVisible("a", true);
    pool.activate("a");
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attach).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    pool.deactivate();
    pool.activate("a");
    await settle();
    expect(attach).toHaveBeenCalledTimes(4);
  });

  it.each(["NotAllowedError", "NotSupportedError"])("does not automatically retry %s", async (name) => {
    const { pool, videos, attach, onReady, onUnavailable } = setup();
    pool.setVisible("a", true);
    await settle();
    videos[0].decode();
    videos[0].play.mockRejectedValue(new DOMException("Cannot play", name));
    pool.activate("a");
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onReady).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith("a");
    expect(attach).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers from a current interrupted play request", async () => {
    const { pool, videos, attach } = setup();
    pool.setVisible("a", true);
    await settle();
    videos[0].play.mockRejectedValue(new DOMException("Interrupted", "AbortError"));
    pool.activate("a");
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    expect(attach).toHaveBeenCalledTimes(2);
    expect(videos[1].paused).toBe(false);
  });

  it("recovers a startup that never produces a frame", async () => {
    const { pool, controllers, attach } = setup();
    pool.setVisible("a", true);
    pool.activate("a");
    await settle();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(controllers[0].destroy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it("does not restart progressing playback, including a loop back to zero", async () => {
    const { pool, videos, attach } = setup();
    pool.setVisible("a", true);
    pool.activate("a");
    await settle();
    for (let i = 1; i <= 12; i++) {
      videos[0].currentTime = i % 3;
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(attach).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(8_500);
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it("recognizes decoded frame progress when a short loop repeats the sampled media time", async () => {
    let frames = 0;
    const video = Object.assign(new Video(), { getVideoPlaybackQuality: () => ({ totalVideoFrames: frames }) });
    const { pool, attach } = setup(() => video);
    pool.setVisible("a", true);
    pool.activate("a");
    await settle();
    for (let i = 0; i < 12; i++) {
      frames += 30;
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(attach).toHaveBeenCalledOnce();
  });

  it.each(["deactivate", "offscreen", "dispose"])("cancels scheduled recovery on %s", async (action) => {
    const { pool, attach } = setup();
    pool.setVisible("a", true);
    pool.activate("a");
    await settle();
    attach.mock.calls[0][2]!.onFatalError!();
    if (action === "offscreen") pool.setVisible("a", false);
    else if (action === "dispose") pool.dispose();
    else pool.deactivate();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attach).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries media element errors as well as HLS fatal errors", async () => {
    const { pool, videos, attach } = setup();
    pool.setVisible("a", true);
    pool.activate("a");
    await settle();
    videos[0].dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(500);
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it("waits for a presented frame and cancels stale frame callbacks", async () => {
    const frames: VideoFrameRequestCallback[] = [];
    const video = Object.assign(new Video(), {
      requestVideoFrameCallback: vi.fn((callback: VideoFrameRequestCallback) => { frames.push(callback); return frames.length; }),
      cancelVideoFrameCallback: vi.fn(),
    });
    const { pool, onReady } = setup(() => video);
    pool.setVisible("a", true);
    await settle();
    video.decode();
    pool.activate("a");
    await settle();
    expect(onReady).not.toHaveBeenCalled();
    pool.deactivate();
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(1);
    frames[0](0, {} as VideoFrameCallbackMetadata);
    expect(onReady).not.toHaveBeenCalled();
    pool.activate("a");
    frames[0](0, {} as VideoFrameCallbackMetadata);
    expect(onReady).not.toHaveBeenCalled();
    frames[1](0, {} as VideoFrameCallbackMetadata);
    expect(onReady).toHaveBeenCalledWith("a", video);
  });

  it("aborts before reusing an HTML video and ignores late attachment settlement", async () => {
    const video = new Video();
    const { pool, attach } = setup(() => video);
    let finish!: (controller: HlsStreamController) => void;
    attach.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    pool.setVisible("a", true);
    const oldSignal = attach.mock.calls[0][2]!.signal!;
    pool.setVisible("a", false);
    expect(oldSignal.aborted).toBe(true);
    pool.setVisible("a", true);
    pool.activate("a");
    await settle();
    const stale = controller();
    finish(stale);
    await settle();
    expect(stale.destroy).toHaveBeenCalledOnce();
    expect(video.paused).toBe(false);
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it("retries an offline failure when connectivity returns without another hover", async () => {
    const browser = Object.assign(new EventTarget(), { navigator: { onLine: false } });
    vi.stubGlobal("window", browser);
    const { pool, videos, attach } = setup();
    pool.setVisible("a", true);
    pool.activate("a");
    await settle();
    attach.mock.calls[0][2]!.onFatalError!();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(attach).toHaveBeenCalledOnce();
    browser.navigator.onLine = true;
    browser.dispatchEvent(new Event("online"));
    await settle();
    expect(attach).toHaveBeenCalledTimes(2);
    expect(videos[1].paused).toBe(false);
  });

  it("releases streams and timers while hidden, then restores visible previews", async () => {
    const page = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", page);
    const { pool, attach, controllers } = setup();
    pool.setVisible("a", true);
    pool.activate("a");
    await settle();
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(controllers[0].destroy).toHaveBeenCalledOnce();
    expect(attach.mock.calls[0][2]!.signal!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(attach).toHaveBeenCalledOnce();
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(attach).toHaveBeenCalledTimes(2);
  });
});
