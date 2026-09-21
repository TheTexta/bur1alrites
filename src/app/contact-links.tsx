"use client";

import { useEffect, useRef } from "react";

import { CONTACT_EMAIL, CONTACT_INSTAGRAM } from "@/lib/contact";

const FADE_DISTANCE = 0.45;

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

export function ContactLinks() {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    let frame = 0;

    const update = () => {
      frame = 0;
      const scrollEnd = Math.max(
        document.documentElement.scrollHeight - window.innerHeight,
        0,
      );
      const distance = Math.max(window.innerHeight * FADE_DISTANCE, 1);
      const progress = clamp01(1 - (scrollEnd - window.scrollY) / distance);
      const eased = progress * progress;

      list.style.opacity = String(eased);
      list.style.visibility = progress > 0 ? "visible" : "hidden";
      list.style.pointerEvents = progress > 0 ? "auto" : "none";
    };

    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(document.documentElement);

    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <ul
      ref={listRef}
      className="invisible absolute inset-x-0 top-[clamp(72px,13svh,140px)] mx-auto m-0 flex w-[min(86vw,1600px)] list-none flex-col items-center gap-2 p-0 text-center text-[clamp(14px,1.4vw,20px)] uppercase text-white opacity-0 will-change-[opacity]"
    >
      <li>
        <a className="underline-offset-4 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
      </li>
      <li>
        <a
          className="underline-offset-4 hover:underline"
          href={CONTACT_INSTAGRAM}
          target="_blank"
          rel="noreferrer noopener"
        >
          @bur1alrites
        </a>
      </li>
    </ul>
  );
}
