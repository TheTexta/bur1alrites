"use client";

import { useEffect, useRef } from "react";

import { CONTACT_EMAIL, CONTACT_INSTAGRAM } from "@/lib/contact";

import {
  DESKTOP_MEDIA_QUERY,
  GLASS_TARGET_ID,
  getWordmarkMotion,
  smoothstep,
} from "./hero-wordmark-motion";

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

type Geometry = {
  viewportHeight: number;
  galleryTop: number;
  contactTop: number;
};

function setOpacity(element: HTMLElement, value: number) {
  const nextValue = value.toFixed(3);
  if (element.style.opacity !== nextValue) element.style.opacity = nextValue;
}

function setTransform(element: HTMLElement, value: string) {
  if (element.style.transform !== value) element.style.transform = value;
}

function LogoMaterial() {
  return (
    <>
      <span className="absolute inset-0 block" style={{ ...LOGO_MASK, backgroundImage: GLASS_GRADIENT }} />
      <span
        className="absolute inset-0 block mix-blend-overlay"
        style={{ ...LOGO_MASK, backgroundImage: SHEEN_GRADIENT }}
      />
    </>
  );
}

export function HeroWordmarkWebKit() {
  const wordmarkRef = useRef<HTMLDivElement>(null);
  const crispTextRef = useRef<HTMLHeadingElement>(null);
  const softTextRef = useRef<HTMLDivElement>(null);
  const smallGlowRef = useRef<HTMLDivElement>(null);
  const mediumGlowRef = useRef<HTMLDivElement>(null);
  const largeGlowRef = useRef<HTMLDivElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);
  const resolvedLogoRef = useRef<HTMLDivElement>(null);
  const smearedLogoRef = useRef<HTMLDivElement>(null);
  const resolvedLinksRef = useRef<HTMLUListElement>(null);
  const smearedLinksRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const elements = {
      wordmark: wordmarkRef.current,
      crispText: crispTextRef.current,
      softText: softTextRef.current,
      smallGlow: smallGlowRef.current,
      mediumGlow: mediumGlowRef.current,
      largeGlow: largeGlowRef.current,
      glass: glassRef.current,
      resolvedLogo: resolvedLogoRef.current,
      smearedLogo: smearedLogoRef.current,
      resolvedLinks: resolvedLinksRef.current,
      smearedLinks: smearedLinksRef.current,
    };

    if (Object.values(elements).some((element) => !element)) return;

    const nodes = elements as { [Key in keyof typeof elements]: NonNullable<(typeof elements)[Key]> };
    const contact = document.getElementById(GLASS_TARGET_ID);
    const gallery = contact?.previousElementSibling;
    let geometry: Geometry = {
      viewportHeight: 1,
      galleryTop: 1,
      contactTop: Number.POSITIVE_INFINITY,
    };
    let frame = 0;
    let isActive = false;

    const measure = () => {
      const viewportHeight = Math.max(window.innerHeight, 1);
      geometry = {
        viewportHeight,
        galleryTop: gallery
          ? gallery.getBoundingClientRect().top + window.scrollY
          : viewportHeight,
        contactTop: contact
          ? contact.getBoundingClientRect().top + window.scrollY
          : Number.POSITIVE_INFINITY,
      };
    };

    const render = () => {
      frame = 0;
      const motion = getWordmarkMotion({ scrollY: window.scrollY, ...geometry });
      const glowEnvelope = 0.5 + motion.glowProgress * 0.5;
      const smallWeight = 1 - smoothstep(0.08, 0.48, motion.glowProgress);
      const mediumWeight =
        smoothstep(0.04, 0.38, motion.glowProgress) *
        (1 - smoothstep(0.58, 0.92, motion.glowProgress));
      const largeWeight = smoothstep(0.48, 0.9, motion.glowProgress);
      const unresolvedContact = 1 - motion.contactProgress;

      setOpacity(nodes.wordmark, 1 - motion.fadeProgress);
      setOpacity(nodes.crispText, 1 - motion.textBlurProgress);
      setOpacity(nodes.softText, motion.textBlurProgress);

      setOpacity(nodes.smallGlow, glowEnvelope * smallWeight);
      setOpacity(nodes.mediumGlow, glowEnvelope * mediumWeight);
      setOpacity(nodes.largeGlow, glowEnvelope * largeWeight);
      setTransform(nodes.smallGlow, `scale(${(1 + motion.glowProgress * 0.08).toFixed(3)})`);
      setTransform(nodes.mediumGlow, `scale(${(1 + motion.glowProgress * 0.65).toFixed(3)})`);
      setTransform(nodes.largeGlow, `scale(${(1 + motion.glowProgress * 2).toFixed(3)})`);

      setOpacity(nodes.glass, motion.contactProgress);
      setOpacity(nodes.resolvedLogo, motion.contactProgress);
      setOpacity(nodes.smearedLogo, unresolvedContact);
      setOpacity(nodes.resolvedLinks, motion.contactProgress);
      setOpacity(nodes.smearedLinks, unresolvedContact);
    };

    const requestRender = () => {
      if (!frame) frame = window.requestAnimationFrame(render);
    };

    const updateGeometry = () => {
      measure();
      requestRender();
    };

    const start = () => {
      if (isActive) return;
      isActive = true;
      measure();
      render();
      window.addEventListener("scroll", requestRender, { passive: true });
      window.addEventListener("resize", updateGeometry, { passive: true });
      window.addEventListener("orientationchange", updateGeometry, { passive: true });
    };

    const stop = () => {
      if (!isActive) return;
      isActive = false;
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener("scroll", requestRender);
      window.removeEventListener("resize", updateGeometry);
      window.removeEventListener("orientationchange", updateGeometry);
    };

    const resizeObserver = new ResizeObserver(updateGeometry);
    if (contact) resizeObserver.observe(contact);
    if (gallery instanceof Element) resizeObserver.observe(gallery);

    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const onMediaChange = (event: MediaQueryListEvent) => {
      if (event.matches) start();
      else stop();
    };

    if (mediaQuery.matches) start();
    mediaQuery.addEventListener("change", onMediaChange);

    return () => {
      stop();
      resizeObserver.disconnect();
      mediaQuery.removeEventListener("change", onMediaChange);
    };
  }, []);

  const wordmarkLayerClass =
    "absolute inset-0 [transform-origin:center]";
  const wordmarkTextClass = "block m-0 text-white";
  const logoClass =
    "absolute left-1/2 top-1/2 aspect-[866/1070] w-[clamp(220px,30vw,620px)] -translate-x-1/2 -translate-y-1/2 [transform-origin:center]";
  const linksClass =
    "absolute bottom-[12vh] m-0 flex list-none flex-col items-center gap-2 p-0 text-center text-[clamp(14px,1.4vw,20px)] uppercase";

  return (
    <>
      <div
        ref={wordmarkRef}
        data-wordmark-renderer="webkit-safe"
        className="pointer-events-none fixed inset-x-2 top-1/2 z-10 hidden -translate-y-1/2 text-center font-[AIx_Darbotzcumi] text-[clamp(48px,8vw,260px)] leading-[0.85] uppercase mix-blend-difference min-[768px]:block"
      >
        <h1 ref={crispTextRef} className="relative z-20 m-0 text-white">
          bur1alrites
        </h1>
        <div
          ref={softTextRef}
          aria-hidden="true"
          className={`z-20 opacity-0 ${wordmarkLayerClass}`}
        >
          <span className={`${wordmarkTextClass} blur-[14px]`}>bur1alrites</span>
        </div>
        <div
          ref={smallGlowRef}
          aria-hidden="true"
          className={`z-0 opacity-50 mix-blend-screen ${wordmarkLayerClass}`}
        >
          <span className={`${wordmarkTextClass} blur-[5px]`}>bur1alrites</span>
        </div>
        <div
          ref={mediumGlowRef}
          aria-hidden="true"
          className={`z-0 opacity-0 mix-blend-screen ${wordmarkLayerClass}`}
        >
          <span className={`${wordmarkTextClass} blur-lg`}>bur1alrites</span>
        </div>
        <div
          ref={largeGlowRef}
          aria-hidden="true"
          className={`z-0 opacity-0 mix-blend-screen ${wordmarkLayerClass}`}
        >
          <span className={`${wordmarkTextClass} blur-[32px]`}>bur1alrites</span>
        </div>
      </div>

      <div
        ref={glassRef}
        className="pointer-events-none fixed inset-0 z-10 hidden opacity-0 min-[768px]:block"
      >
        <div ref={smearedLogoRef} aria-hidden="true" className={`${logoClass} opacity-100 blur-lg`}>
          <div className="relative h-full w-full" style={{ filter: GLASS_FILTER }}>
            <LogoMaterial />
          </div>
        </div>
        <div ref={resolvedLogoRef} aria-hidden="true" className={`${logoClass} opacity-0`}>
          <div className="relative h-full w-full" style={{ filter: GLASS_FILTER }}>
            <LogoMaterial />
          </div>
        </div>

        <div
          ref={smearedLinksRef}
          aria-hidden="true"
          className={`${linksClass} inset-x-0 opacity-100`}
          style={{ filter: `${GLASS_FILTER} blur(16px)` }}
        >
          <span>{CONTACT_EMAIL}</span>
          <span>@bur1alrites</span>
        </div>
        <ul
          ref={resolvedLinksRef}
          className={`${linksClass} inset-x-0 opacity-0`}
          style={{ filter: GLASS_FILTER, pointerEvents: "auto" }}
        >
          <li>
            <a
              className="bg-clip-text text-transparent underline-offset-4 hover:underline"
              style={{ backgroundImage: GLASS_GRADIENT }}
              href={`mailto:${CONTACT_EMAIL}`}
            >
              {CONTACT_EMAIL}
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
              @bur1alrites
            </a>
          </li>
        </ul>
      </div>
    </>
  );
}