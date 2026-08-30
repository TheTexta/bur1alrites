"use client";

import { useEffect, useMemo, useRef } from "react";

import type { RenderMode } from "@/lib/browser-render-mode";

const BAR_COUNT = 650;
const VIEW = 1000;
const MIN_WIDTH = 7;
const MAX_WIDTH = 40;
const MIN_HEIGHT = 800;
const MAX_HEIGHT = 2000;
const SEED = 0x5eed;
const MIN_FADE_MS = 100;
const MAX_FADE_MS = 300;
const FILL_START = 0.85;

type Bar = {
  left: string;
  top: string;
  width: string;
  height: string;
  transform: string;
  duration: number;
};

// Deterministic PRNG so the server and client render the same bars.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// VIEW units map to vmax so the layout covers the viewport at any aspect ratio.
function toVmax(units: number) {
  return `${((units / VIEW) * 100).toFixed(3)}vmax`;
}

function offsetFromCenter(units: number) {
  return `calc(50% + ${(((units - VIEW / 2) / VIEW) * 100).toFixed(3)}vmax)`;
}

function createBars(seed: number): Bar[] {
  const random = mulberry32(seed);

  return Array.from({ length: BAR_COUNT }, () => {
    const width = MIN_WIDTH + random() * (MAX_WIDTH - MIN_WIDTH);
    const height = MIN_HEIGHT + random() * (MAX_HEIGHT - MIN_HEIGHT);
    const cx = random() * (VIEW + width) - width / 2;
    const cy = random() * (VIEW + height) - height / 2;
    const angle = random() * 360;
    const duration = MIN_FADE_MS + random() * (MAX_FADE_MS - MIN_FADE_MS);

    return {
      left: offsetFromCenter(cx),
      top: offsetFromCenter(cy),
      width: toVmax(width),
      height: toVmax(height),
      transform: `translate(-50%, -50%) rotate(${angle.toFixed(2)}deg)`,
      duration: Math.round(duration),
    };
  });
}

export function ScrollBars({ renderMode }: { renderMode: RenderMode }) {
  const bars = useMemo(() => createBars(SEED), []);
  const transitionsEnabled = renderMode !== "webkit-safe";
  const layerRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const shownRef = useRef(0);

  useEffect(() => {
    const layer = layerRef.current;
    const fill = fillRef.current;
    if (!layer || !fill) return;

    const nodes = Array.from(layer.children) as HTMLElement[];
    let frame = 0;

    const render = () => {
      frame = 0;
      const distance = Math.max(window.innerHeight, 1);
      const progress = Math.min(Math.max(window.scrollY / distance, 0), 1);

      // Solid panel closes any gaps the bars leave once they are all in.
      const fillProgress = Math.min(
        Math.max((progress - FILL_START) / (1 - FILL_START), 0),
        1,
      );
      fill.style.opacity = fillProgress.toFixed(3);

      const target = Math.round(progress * nodes.length);
      const previous = shownRef.current;
      if (target === previous) return;

      // Only the bars that crossed the threshold change; the rest stay untouched.
      if (target > previous) {
        for (let index = previous; index < target; index += 1) {
          nodes[index].style.opacity = "1";
        }
      } else {
        for (let index = previous - 1; index >= target; index -= 1) {
          nodes[index].style.opacity = "0";
        }
      }
      shownRef.current = target;
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(render);
    };

    render();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden" aria-hidden="true">
      <div ref={layerRef} className="absolute inset-0">
        {bars.map((bar, index) => (
          <span
            key={index}
            className="absolute block bg-white opacity-0"
            style={{
              left: bar.left,
              top: bar.top,
              width: bar.width,
              height: bar.height,
              transform: bar.transform,
              transitionProperty: transitionsEnabled ? "opacity" : "none",
              transitionDuration: transitionsEnabled ? `${bar.duration}ms` : undefined,
              transitionTimingFunction: transitionsEnabled ? "ease-out" : undefined,
            }}
          />
        ))}
      </div>
      <span ref={fillRef} className="absolute inset-0 block bg-white opacity-0" />
    </div>
  );
}
