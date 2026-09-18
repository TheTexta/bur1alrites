import { headers } from "next/headers";

import {
  buildSupabaseStoragePublicUrl,
  buildSupabaseStorageRenderUrl,
} from "@/lib/supabase/config";
import {
  buildPortfolioStoragePath,
  buildPortfolioStreamManifestPath,
  buildPortfolioVideoPosterPath,
} from "@/lib/portfolio/config";
import { detectRenderMode } from "@/lib/browser-render-mode";

import { ContactLinks } from "./contact-links";
import { HeroScene } from "./hero-scene";
import { GalleryMediaSlot, type GallerySceneItem } from "./gallery-three";
import { PageRestoreBoundary } from "./page-restore-boundary";
import { VideoRoom } from "./video-room";
import { listGalleryItems, type GalleryItem } from "@/lib/gallery";

type MediaItem = GalleryItem;

const MEDIA: MediaItem[] = [
  { slug: "img-0722", extension: "mov", width: 1920, height: 1080, title: "Untitled 0722", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-1254", extension: "mov", width: 1080, height: 1920, title: "Untitled 1254", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-0723", extension: "mov", width: 1920, height: 1080, title: "Untitled 0723", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-0980", extension: "mov", width: 1920, height: 1080, title: "Untitled 0980", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-1256", extension: "mov", width: 1080, height: 1920, title: "Untitled 1256", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-0990", extension: "mov", width: 1920, height: 1080, title: "Untitled 0990", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-2460", extension: "mov", width: 720, height: 1280, title: "Untitled 2460", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-1365", extension: "mov", width: 1920, height: 1080, title: "Untitled 1365", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-1398", extension: "mov", width: 1080, height: 1920, title: "Untitled 1398", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-1814", extension: "mov", width: 1920, height: 1080, title: "Untitled 1814", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-2170", extension: "mov", width: 1280, height: 720, title: "Untitled 2170", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-2220", extension: "mov", width: 1920, height: 1080, title: "Untitled 2220", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-3356", extension: "mov", width: 1920, height: 1080, title: "Untitled 3356", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-5258", extension: "mov", width: 1920, height: 1080, title: "Untitled 5258", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-5264", extension: "mov", width: 1920, height: 1080, title: "Untitled 5264", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-5265", extension: "mov", width: 1920, height: 1080, title: "Untitled 5265", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-5266", extension: "mov", width: 1920, height: 1080, title: "Untitled 5266", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-5599", extension: "mov", width: 1920, height: 1080, title: "Untitled 5599", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-5852", extension: "mov", width: 1920, height: 1080, title: "Untitled 5852", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-5863", extension: "mov", width: 1920, height: 1080, title: "Untitled 5863", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-6128", extension: "mov", width: 1920, height: 1080, title: "Untitled 6128", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-6165", extension: "mov", width: 1920, height: 1080, title: "Untitled 6165", client: "bur1alrites", type: "clip", year: "2026" },
];

export default async function StorageTestPage() {
  const [requestHeaders, galleryItems] = await Promise.all([
    headers(),
    listGalleryItems({ publishedOnly: true }).catch(() => null),
  ]);
  const renderMode = detectRenderMode(requestHeaders.get("user-agent"));
  const media = galleryItems === null ? MEDIA : galleryItems;
  const heroManifestUrl = buildSupabaseStoragePublicUrl(
    buildPortfolioStreamManifestPath("hero"),
  );
  const sceneMedia: GallerySceneItem[] = media.map((item) => {
    const path = buildPortfolioStoragePath(item.slug, item.extension);
    const isVideo = item.extension === "mov";

    return {
      slug: item.slug,
      previewUrl: isVideo
        ? buildSupabaseStorageRenderUrl(
            buildPortfolioVideoPosterPath(item.slug),
            { width: 960, quality: 75 },
          )
        : buildSupabaseStorageRenderUrl(path, { width: 960, quality: 75 }),
      manifestUrl: isVideo
        ? buildSupabaseStoragePublicUrl(
            buildPortfolioStreamManifestPath(item.slug),
          )
        : null,
      width: item.width,
      height: item.height,
      title: item.title,
      client: item.client,
      type: item.type,
      year: item.year,
    };
  });

  return (
    <PageRestoreBoundary>
      <section
        aria-label="Portfolio reel"
        className="relative z-10 h-svh w-full overflow-hidden isolate"
      />

      <HeroScene
        manifestUrl={heroManifestUrl}
        galleryItems={sceneMedia}
        preferNativeHls={renderMode === "webkit-safe"}
      />

      {/* The hero is one viewport tall, so the grid enters as soon as the viewer starts scrolling. */}
      <section aria-labelledby="portfolio-heading">
        <h2 id="portfolio-heading" className="sr-only">
          Selected work
        </h2>
        <div
          id="portfolio-gallery"
          className="relative z-10 mx-auto w-[min(86vw,1600px)] columns-1 gap-0 p-0 min-[768px]:columns-2 min-[992px]:columns-3 min-[1280px]:columns-4"
        >
          {sceneMedia.map((item, index) => {
            return (
              <article key={item.slug} className="mb-5 break-inside-avoid px-[10px] text-[13px] text-[#e2e1e1]">
                <div className="relative block w-full text-inherit">
                  <GalleryMediaSlot
                    item={item}
                    index={index}
                    renderMode={renderMode}
                  />
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section id="contact" aria-labelledby="contact-heading" className="relative z-10 min-h-svh w-full">
        <h2 id="contact-heading" className="sr-only">
          Contact bur1alrites
        </h2>
        <ContactLinks />
      </section>

      <VideoRoom />
    </PageRestoreBoundary>
  );
}
