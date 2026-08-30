import type { RenderMode } from "@/lib/browser-render-mode";

import { HeroWordmark } from "./hero-wordmark";
import { HeroWordmarkWebKit } from "./hero-wordmark-webkit";

type HeroWordmarkRendererProps = {
  renderMode: RenderMode;
};

export function HeroWordmarkRenderer({ renderMode }: HeroWordmarkRendererProps) {
  if (renderMode === "webkit-safe") {
    return <HeroWordmarkWebKit />;
  }

  return <HeroWordmark />;
}