import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachHlsStream } from "./hls-stream";

type Player = {
  config: Record<string, unknown>;
  autoLevelCapping: number;
  error?: (event: string, data: { fatal: boolean }) => void;
  destroy: ReturnType<typeof vi.fn>;
  startLoad: ReturnType<typeof vi.fn>;
  stopLoad: ReturnType<typeof vi.fn>;
};
const state = vi.hoisted(() => ({ supported: true, players: [] as Player[] }));
vi.mock("hls.js", () => ({
  default: class {
    static isSupported = () => state.supported;
    static Events = { ERROR: "error" };
    autoLevelCapping = -1;
    destroy = vi.fn();
    startLoad = vi.fn();
    stopLoad = vi.fn();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    error?: Player["error"];
    constructor(public config: Record<string, unknown>) { state.players.push(this); }
    on(_event: string, callback: Player["error"]) { this.error = callback; }
  },
}));

class Video extends EventTarget {
  src = "";
  canPlayType = vi.fn(() => "");
  removeAttribute = vi.fn(() => { this.src = ""; });
  load = vi.fn();
}
const asVideo = (video: Video) => video as unknown as HTMLVideoElement;

describe("HLS stream lifetime", () => {
  beforeEach(() => { state.players.length = 0; state.supported = true; });

  it("reports fatal HLS errors, but leaves nonfatal recovery to HLS.js", async () => {
    const onFatalError = vi.fn();
    const stream = await attachHlsStream(asVideo(new Video()), "a.m3u8", { onFatalError, preview: true });
    const player = state.players[0];
    expect(player.config).toMatchObject({ startLevel: -1, maxBufferLength: 4, maxMaxBufferLength: 4 });
    expect(player.autoLevelCapping).toBe(0);
    player.error!("error", { fatal: false });
    expect(onFatalError).not.toHaveBeenCalled();
    player.error!("error", { fatal: true });
    expect(onFatalError).toHaveBeenCalledOnce();
    stream.destroy();
  });

  it("aborts HLS synchronously, making late destruction and loading calls harmless", async () => {
    const abort = new AbortController();
    const stream = await attachHlsStream(asVideo(new Video()), "a.m3u8", { signal: abort.signal });
    stream.startLoading();
    stream.stopLoading();
    abort.abort();
    expect(state.players[0].destroy).toHaveBeenCalledOnce();
    stream.destroy();
    stream.startLoading();
    stream.stopLoading();
    expect(state.players[0].destroy).toHaveBeenCalledOnce();
    expect(state.players[0].startLoad).toHaveBeenCalledOnce();
    expect(state.players[0].stopLoad).toHaveBeenCalledOnce();
  });

  it("does not attach after cancellation during the dynamic import", async () => {
    const abort = new AbortController();
    const pending = attachHlsStream(asVideo(new Video()), "a.m3u8", { signal: abort.signal });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(state.players).toHaveLength(0);
  });

  it("does not start an already cancelled native attachment", async () => {
    const video = new Video();
    video.canPlayType.mockReturnValue("maybe");
    const signal = AbortSignal.abort();
    await expect(attachHlsStream(asVideo(video), "a.m3u8", { signal, preferNative: true })).rejects.toMatchObject({ name: "AbortError" });
    expect(video.src).toBe("");
  });

  it("reports native errors and removes the listener on destruction", async () => {
    const video = new Video();
    video.canPlayType.mockReturnValue("maybe");
    const onFatalError = vi.fn();
    const stream = await attachHlsStream(asVideo(video), "a.m3u8", { preferNative: true, onFatalError });
    video.dispatchEvent(new Event("error"));
    expect(onFatalError).toHaveBeenCalledOnce();
    stream.destroy();
    video.dispatchEvent(new Event("error"));
    expect(onFatalError).toHaveBeenCalledOnce();
    expect(video.src).toBe("");
    expect(state.players).toHaveLength(0);
  });

  it("cannot clear a replacement native stream through a stale cleanup", async () => {
    const video = new Video();
    video.canPlayType.mockReturnValue("maybe");
    const abort = new AbortController();
    const old = await attachHlsStream(asVideo(video), "a.m3u8", { preferNative: true, signal: abort.signal });
    abort.abort();
    const current = await attachHlsStream(asVideo(video), "b.m3u8", { preferNative: true });
    old.destroy();
    expect(video.src).toBe("b.m3u8");
    expect(video.load).toHaveBeenCalledOnce();
    current.destroy();
  });

  it("falls back to native HLS when MediaSource is unsupported", async () => {
    state.supported = false;
    const video = new Video();
    video.canPlayType.mockReturnValue("maybe");
    const stream = await attachHlsStream(asVideo(video), "a.m3u8");
    expect(video.src).toBe("a.m3u8");
    stream.destroy();
  });

  it("rejects unsupported playback instead of returning a broken controller", async () => {
    state.supported = false;
    await expect(attachHlsStream(asVideo(new Video()), "a.m3u8")).rejects.toThrow("cannot play HLS");
  });
});
