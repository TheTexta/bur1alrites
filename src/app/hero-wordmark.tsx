"use client";

import { useEffect, useRef } from "react";

const MIN_BLUR_PX = 5;
const MAX_BLUR_PX = 600;
const MAX_TEXT_BLUR_PX = 14;
const MIN_OPACITY = 0.5;
const MAX_OPACITY = 1;
// Higher exponent keeps the glow flat through the hero, then ramps hard near the gallery.
const CURVE = 20;
// No blur at all until the gallery covers this much of the viewport, then a slow ramp to the last section.
const TEXT_BLUR_START_COVERAGE = 0.45;
const TEXT_BLUR_CURVE = 3;
const GLASS_TARGET_ID = "contact";
const GLASS_CURVE = 2;
const Y_BLUR_FILTER_ID = "wordmark-y-blur";
const GLASS_Y_BLUR_FILTER_ID = "glass-y-blur";
const MAX_Y_BLUR = 200;
const Y_BLUR_CURVE = 1;
// Very high exponent holds the wordmark at full strength, then drops it away at the very end.
const FADE_OUT_CURVE = 4;

const LOGO_MASK = {
  maskImage: "url(/assets/logo.png)",
  WebkitMaskImage: "url(/assets/logo.png)",
  maskSize: "contain",
  WebkitMaskSize: "contain",
  maskRepeat: "no-repeat",
  WebkitMaskRepeat: "no-repeat",
  maskPosition: "center",
  WebkitMaskPosition: "center",
} as const;

const GLASS_GRADIENT =
  "linear-gradient(152deg, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.45) 16%, rgba(20,20,20,0.55) 32%, rgba(20,20,20,0.7) 44%, rgba(255,255,255,0.85) 56%, rgba(20,20,20,0.6) 68%, rgba(255,255,255,0.5) 84%, rgba(255,255,255,0.95) 100%)";

const SHEEN_GRADIENT =
  "linear-gradient(112deg, transparent 26%, rgba(255,255,255,0.9) 44%, rgba(255,255,255,0.25) 52%, transparent 62%)";

const GLASS_FILTER =
  "drop-shadow(0 -1px 0 rgba(255,255,255,0.9)) drop-shadow(0 1px 0 rgba(0,0,0,0.45)) drop-shadow(-1px 0 0 rgba(120,200,255,0.12)) drop-shadow(1px 0 0 rgba(255,140,220,0.1)) drop-shadow(0 14px 30px rgba(0,0,0,0.25))";

// TODO: swap in the real destinations once they are confirmed.
const CONTACT_EMAIL = "alissazagorski@gmail.com";
const CONTACT_INSTAGRAM = "https://www.instagram.com/bur1alrites/";

function blurProgress(scrollY: number, viewport: number, maxScroll: number) {
  const begin = viewport * TEXT_BLUR_START_COVERAGE;
  if (scrollY <= begin) return 0;
  return Math.min((scrollY - begin) / Math.max(maxScroll - begin, 1), 1);
}

export function HeroWordmark() {
  const wordmarkRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLHeadingElement>(null);
  const glowRef = useRef<HTMLHeadingElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);
  const linksRef = useRef<HTMLUListElement>(null);
  const yBlurRef = useRef<SVGFEGaussianBlurElement>(null);
  const glassYBlurRef = useRef<SVGFEGaussianBlurElement>(null);

  useEffect(() => {
    const wordmark = wordmarkRef.current;
    const text = textRef.current;
    const glow = glowRef.current;
    const glass = glassRef.current;
    const links = linksRef.current;
    const yBlur = yBlurRef.current;
    const glassYBlur = glassYBlurRef.current;
    if (!wordmark || !text || !glow || !glass || !links || !yBlur || !glassYBlur) return;

    let frame = 0;

    const render = () => {
      frame = 0;
      const viewport = Math.max(window.innerHeight, 1);
      const progress = Math.min(Math.max(window.scrollY / viewport, 0), 1);
      const eased = progress ** CURVE;

      // Whole-page progress: 1 once the third section fills the viewport.
      const maxScroll = Math.max(document.documentElement.scrollHeight - viewport, 1);
      const journey = Math.min(Math.max(window.scrollY / maxScroll, 0), 1);

      const blurT = blurProgress(window.scrollY, viewport, maxScroll);

      glow.style.filter = `blur(${(MIN_BLUR_PX + (MAX_BLUR_PX - MIN_BLUR_PX) * eased).toFixed(2)}px)`;
      glow.style.opacity = (MIN_OPACITY + (MAX_OPACITY - MIN_OPACITY) * eased).toFixed(3);
      text.style.filter = `blur(${(MAX_TEXT_BLUR_PX * blurT ** TEXT_BLUR_CURVE).toFixed(2)}px)`;

      yBlur.setAttribute(
        "stdDeviation",
        `0 ${(MAX_Y_BLUR * blurT ** Y_BLUR_CURVE).toFixed(2)}`,
      );
      const fade = journey ** FADE_OUT_CURVE;
      wordmark.style.opacity = (1 - fade).toFixed(3);

      // Section three resolves out of the same blur as the wordmark fades away.
      glassYBlur.setAttribute("stdDeviation", `0 ${(MAX_Y_BLUR * (1 - fade)).toFixed(2)}`);
      glass.style.filter = `url(#${GLASS_Y_BLUR_FILTER_ID}) blur(${(MAX_TEXT_BLUR_PX * (1 - fade)).toFixed(2)}px)`;

      // Glass layer is driven by how far the contact section has entered the viewport.
      const contact = document.getElementById(GLASS_TARGET_ID);
      const entry = contact
        ? Math.min(Math.max((viewport - contact.getBoundingClientRect().top) / viewport, 0), 1)
        : 0;
      glass.style.opacity = (entry ** GLASS_CURVE).toFixed(3);
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
    <>
      <svg className="pointer-events-none absolute h-0 w-0" aria-hidden="true" focusable="false">
        <filter id={Y_BLUR_FILTER_ID} x="-50%" y="-100%" width="200%" height="300%">
          <feGaussianBlur ref={yBlurRef} stdDeviation="0 0" />
        </filter>
        <filter id={GLASS_Y_BLUR_FILTER_ID} x="-50%" y="-100%" width="200%" height="300%">
          <feGaussianBlur ref={glassYBlurRef} stdDeviation="0 0" />
        </filter>
      </svg>

      <div
        ref={wordmarkRef}
        className="pointer-events-none fixed inset-x-2 top-1/2 z-10 -translate-y-1/2 text-center font-[AIx_Darbotzcumi] text-[clamp(48px,8vw,260px)] leading-[0.85] uppercase mix-blend-difference"
        style={{ filter: `url(#${Y_BLUR_FILTER_ID})` }}
      >
        <h1 ref={textRef} className="relative z-10 m-0 text-white">
          bur1alrites
        </h1>
        <h1
          ref={glowRef}
          aria-hidden="true"
          className="absolute inset-0 z-0 m-0 text-white opacity-50 blur-[5px] mix-blend-screen"
        >
          bur1alrites
        </h1>
      </div>

      <div
        ref={glassRef}
        className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center opacity-0"
      >
        <div
          aria-hidden="true"
          className="relative aspect-[866/1070] w-[clamp(220px,30vw,620px)]"
          style={{ filter: GLASS_FILTER }}
        >
          {/* The logo's alpha masks the glass material, so none of its own pixels are composited. */}
          <span className="absolute inset-0 block" style={{ ...LOGO_MASK, backgroundImage: GLASS_GRADIENT }} />
          <span
            className="absolute inset-0 block mix-blend-overlay"
            style={{ ...LOGO_MASK, backgroundImage: SHEEN_GRADIENT }}
          />
        </div>

        <ul
          ref={linksRef}
          className="absolute bottom-[12vh] m-0 flex list-none flex-col items-center gap-2 p-0 text-center text-[clamp(14px,1.4vw,20px)] uppercase"
          style={{ filter: GLASS_FILTER, pointerEvents: "auto" }}
        >
          <li>
            <a
              className="bg-clip-text text-transparent underline-offset-4 hover:underline"
              style={{ backgroundImage: GLASS_GRADIENT }}
              href={`mailto:${CONTACT_EMAIL}`}
            >
              email
            </a>
          </li>
          <li>
            <a
              className="bg-clip-text text-transparent underline-offset-4 hover:underline"
              style={{ backgroundImage: GLASS_GRADIENT }}
              href={CONTACT_INSTAGRAM}
              target="_blank"
              rel="noreferrer noopener"
            >
              instagram
            </a>
          </li>
        </ul>
      </div>
    </>
  );
}
