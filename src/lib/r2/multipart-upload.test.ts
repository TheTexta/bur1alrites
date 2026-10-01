import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadMultipart } from "./multipart-upload";

function transport(fail: (part: number, attempt: number) => boolean) {
  let active = 0; let maximum = 0; let aborts = 0;
  const attempts = new Map<number, number>();
  class Xhr {
    upload: { onprogress?: (event: { loaded: number }) => void } = {};
    onload?: () => void; onerror?: () => void; onabort?: () => void;
    status = 200; part = 0; stopped = false;
    open(_method: string, url: string) { this.part = Number(url); }
    getResponseHeader() { return '"etag"'; }
    send(blob: Blob) {
      active++; maximum = Math.max(maximum, active);
      const attempt = (attempts.get(this.part) ?? 0) + 1; attempts.set(this.part, attempt);
      setTimeout(() => {
        if (this.stopped) return;
        active--; this.upload.onprogress?.({ loaded: blob.size });
        if (fail(this.part, attempt)) this.onerror?.(); else this.onload?.();
      }, 10);
    }
    abort() { if (!this.stopped) { this.stopped = true; active--; aborts++; this.onabort?.(); } }
  }
  vi.stubGlobal("XMLHttpRequest", Xhr);
  const signed = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const { partNumbers } = JSON.parse(init!.body as string);
    return { parts: [{ partNumber: partNumbers[0], url: String(partNumbers[0]) }] };
  });
  const request = async <T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> => await signed(input, init) as T;
  return { request, signed, attempts, maximum: () => maximum, aborts: () => aborts };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("browser multipart transfer", () => {
  it("bounds concurrency, signs fresh retries, and reports complete progress", async () => {
    vi.useFakeTimers(); const mock = transport((part, attempt) => part === 2 && attempt === 1);
    const progress = vi.fn();
    const done = uploadMultipart(new File([new Uint8Array(80)], "clip.mp4"), { session: "session", partSize: 10, partCount: 8 }, mock.request, progress);
    await vi.runAllTimersAsync(); await done;
    expect(mock.maximum()).toBe(3);
    expect(mock.attempts.get(2)).toBe(2);
    expect(mock.signed).toHaveBeenCalledTimes(9);
    expect(progress).toHaveBeenLastCalledWith(100);
  });
  it("stops after bounded failures and aborts other active transfers", async () => {
    vi.useFakeTimers(); const mock = transport(() => true);
    const done = uploadMultipart(new File([new Uint8Array(80)], "clip.mp4"), { session: "session", partSize: 10, partCount: 8 }, mock.request, () => {});
    const checked = expect(done).rejects.toThrow("interrupted");
    await vi.runAllTimersAsync(); await checked;
    expect(mock.attempts.get(1)).toBe(5);
    expect(mock.maximum()).toBe(3);
    expect(mock.aborts()).toBeGreaterThan(0);
    expect(mock.attempts.has(4)).toBe(false);
  });
});
