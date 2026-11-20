import { describe, expect, it, vi } from "vitest";
import { createGalleryTargetRegistry, observeGalleryTargets } from "./gallery-targets";

function target(visible = true) {
  return {
    isConnected: true,
    visible,
    getBoundingClientRect(this: { visible: boolean }) { return { width: this.visible ? 200 : 0, height: this.visible ? 100 : 0 }; },
  } as unknown as HTMLElement & { visible: boolean };
}

function fixture() {
  const registry = createGalleryTargetRegistry();
  let deliver: IntersectionObserverCallback;
  const observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
  const visible = vi.fn();
  const stop = observeGalleryTargets(registry, new Set(["a", "b"]), callback => {
    deliver = callback;
    return observer as unknown as IntersectionObserver;
  }, visible);
  const entries = (...values: [Element, boolean][]) => deliver(values.map(([element, isIntersecting]) => ({ target: element, isIntersecting })) as IntersectionObserverEntry[], observer as unknown as IntersectionObserver);
  return { registry, observer, visible, stop, entries };
}

describe("gallery target registration", () => {
  it("accepts late targets, replaces by slug, and ignores stale release/observer delivery", () => {
    const f = fixture();
    const old = target();
    const release = f.registry.register("a", old);
    f.entries([old, true]);
    expect(f.visible).toHaveBeenLastCalledWith("a", true);
    const replacement = target();
    const releaseReplacement = f.registry.register("a", replacement);
    f.entries([replacement, true]);
    f.visible.mockClear();
    release();
    release();
    f.entries([old, false]);
    expect(f.registry.get("a")).toBe(replacement);
    expect(f.visible).not.toHaveBeenCalled();
    expect(f.observer.unobserve).toHaveBeenCalledWith(old);
    releaseReplacement();
    expect(f.visible).toHaveBeenLastCalledWith("a", false);
    expect(f.registry.get("a")).toBe(null);
    f.stop();
  });

  it("chooses the eligible responsive copy and hands visibility off without a stale release", () => {
    const f = fixture();
    const desktop = target();
    const mobile = target(false);
    f.registry.register("a", desktop);
    const releaseMobile = f.registry.register("a", mobile);
    f.entries([desktop, true], [mobile, false]);
    expect(f.registry.get("a")).toBe(desktop);
    f.visible.mockClear();
    desktop.visible = false;
    mobile.visible = true;
    f.entries([mobile, true], [desktop, false]);
    expect(f.registry.get("a")).toBe(mobile);
    expect(f.visible).not.toHaveBeenCalled();
    desktop.visible = true;
    mobile.visible = false;
    f.entries([desktop, true], [mobile, false]);
    releaseMobile();
    f.entries([mobile, false]);
    expect(f.registry.get("a")).toBe(desktop);
    expect(f.visible).not.toHaveBeenCalled();
    f.stop();
  });

  it("keeps stable slug identity despite registration order, never releasing another target", () => {
    const f = fixture();
    const b = target();
    const a = target();
    const releaseB = f.registry.register("b", b);
    f.registry.register("a", a);
    f.entries([a, true], [b, true]);
    f.visible.mockClear();
    releaseB();
    f.entries([b, false]);
    expect(f.visible.mock.calls).toEqual([["b", false]]);
    expect(f.registry.get("a")).toBe(a);
    f.stop();
    f.visible.mockClear();
    f.entries([a, false]);
    expect(f.visible).not.toHaveBeenCalled();
    expect(f.observer.disconnect).toHaveBeenCalledOnce();
  });
});
