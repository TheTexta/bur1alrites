"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createGalleryTargetRegistry, type GalleryTargetRegistry } from "./gallery-targets";

const GalleryTargetContext = createContext<GalleryTargetRegistry | null>(null);

export function GalleryTargetProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(createGalleryTargetRegistry);
  return <GalleryTargetContext.Provider value={registry}>{children}</GalleryTargetContext.Provider>;
}

export function useGalleryTargets() {
  const registry = useContext(GalleryTargetContext);
  if (!registry) throw new Error("Gallery targets require GalleryTargetProvider.");
  return registry;
}
