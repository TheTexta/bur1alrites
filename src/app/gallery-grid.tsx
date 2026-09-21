"use client";

import type { RenderMode } from "@/lib/browser-render-mode";
import { GalleryMediaSlot, type GallerySceneItem } from "./gallery-three";
import { useMobileView, useRenderingEnabled } from "./scene-utils";

export function GalleryGrid({
  items,
  renderMode,
  isMobile,
}: {
  items: GallerySceneItem[];
  renderMode: RenderMode;
  isMobile: boolean;
}) {
  const mobileGallery = useMobileView(isMobile);
  const renderingEnabled = useRenderingEnabled();
  const renderInHtml = mobileGallery || !renderingEnabled;

  return (
    <div
      id="portfolio-gallery"
      className="relative z-10 mx-auto w-[min(86vw,1600px)] columns-1 gap-0 p-0 min-[768px]:columns-2 min-[992px]:columns-3 min-[1280px]:columns-4"
    >
      {items.map((item, index) => (
        <article
          key={item.slug}
          className="mb-5 break-inside-avoid px-[10px] text-[13px] text-[#e2e1e1]"
        >
          <div className="relative block w-full text-inherit">
            <GalleryMediaSlot
              item={item}
              index={index}
              renderMode={renderMode}
              renderInHtml={renderInHtml}
              playInFrameOnTap={mobileGallery}
            />
          </div>
        </article>
      ))}
    </div>
  );
}
