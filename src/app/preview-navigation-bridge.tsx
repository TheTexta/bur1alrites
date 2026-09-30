"use client";

import { useEffect } from "react";

const MESSAGE_SOURCE = "dextery-preview-navigation";

export function getVideoPreviewHref(slug: string) {
  return `/?video=${encodeURIComponent(slug)}`;
}

function getPortfolioOrigin() {
  if (window.parent === window || !document.referrer) {
    return null;
  }

  try {
    const referrer = new URL(document.referrer);
    if (
      (referrer.protocol === "https:" &&
        (referrer.hostname === "dextery.dev" ||
          referrer.hostname === "www.dextery.dev")) ||
      (referrer.protocol === "http:" &&
        (referrer.hostname === "localhost" ||
          referrer.hostname === "127.0.0.1"))
    ) {
      return referrer.origin;
    }
  } catch {
    // Leave standalone navigation untouched when the referrer is invalid.
  }

  return null;
}

export function openPreviewVideo(slug: string) {
  const portfolioOrigin = getPortfolioOrigin();
  if (!portfolioOrigin) return false;

  window.parent.postMessage(
    {
      source: MESSAGE_SOURCE,
      type: "open-link",
      href: new URL(getVideoPreviewHref(slug), window.location.href).href,
    },
    portfolioOrigin,
  );
  return true;
}

export function PreviewNavigationBridge() {
  useEffect(() => {
    const portfolioOrigin = getPortfolioOrigin();
    if (!portfolioOrigin) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      const element = target instanceof Element ? target : null;
      const anchor = element?.closest("a[href]");
      const navigationButton = element?.closest("[data-preview-href]");
      const href =
        anchor instanceof HTMLAnchorElement
          ? anchor.href
          : navigationButton?.getAttribute("data-preview-href");

      const url = href ? new URL(href, document.baseURI) : null;
      if (url?.protocol === "mailto:" || url?.protocol === "tel:") {
        window.parent.postMessage(
          { source: MESSAGE_SOURCE, type: "keep-native" },
          portfolioOrigin,
        );
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      window.parent.postMessage(
        url && (url.protocol === "http:" || url.protocol === "https:")
          ? { source: MESSAGE_SOURCE, type: "open-link", href: url.href }
          : { source: MESSAGE_SOURCE, type: "open-site" },
        portfolioOrigin,
      );
    };

    document.addEventListener("click", handleClick, true);
    window.parent.postMessage(
      { source: MESSAGE_SOURCE, type: "ready" },
      portfolioOrigin,
    );
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  return null;
}
