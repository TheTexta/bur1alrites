// DOM targets stay fixed while the camera moves, so nearby planes need render overscan.
const RENDER_MARGIN = 0.2;

export const GALLERY_PREVIEW_ROOT_MARGIN = `25% ${RENDER_MARGIN * 100}%`;

export function isInGalleryRenderRange(
  rect: Pick<DOMRectReadOnly, "top" | "bottom" | "left" | "right">,
  viewport: { width: number; height: number },
) {
  return (
    rect.bottom > -viewport.height * RENDER_MARGIN &&
    rect.top < viewport.height * (1 + RENDER_MARGIN) &&
    rect.right > -viewport.width * RENDER_MARGIN &&
    rect.left < viewport.width * (1 + RENDER_MARGIN)
  );
}
