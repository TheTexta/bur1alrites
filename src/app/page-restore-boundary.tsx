"use client";

import { type ReactNode, useEffect, useState } from "react";

// Back/forward cache restores reuse the previous document, but browsers may discard stateful
// WebGL and media resources while it is frozen. Remount the homepage subtree on that specific
// lifecycle path so those resources are initialized exactly as they are on a fresh visit.
export function PageRestoreBoundary({ children }: { children: ReactNode }) {
  const [restoreKey, setRestoreKey] = useState(0);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRestoreKey((current) => current + 1);
    };

    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return <main key={restoreKey}>{children}</main>;
}
