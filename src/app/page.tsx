import Image from "next/image";

import {
  buildSupabaseStoragePublicUrl,
  buildSupabaseStorageRenderUrl,
} from "@/lib/supabase/config";
import {
  buildPortfolioStoragePath,
  buildPortfolioStreamManifestPath,
  buildPortfolioVideoPosterPath,
} from "@/lib/portfolio/config";

import { HeroVideo } from "./hero-video";
import { HeroWordmark } from "./hero-wordmark";
import { ScrollBars } from "./scroll-bars";
import { VideoThumb } from "./video-thumb";
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
  const galleryItems = await listGalleryItems({ publishedOnly: true }).catch(() => null);
  const media = galleryItems === null ? MEDIA : galleryItems;
  const heroManifestUrl = buildSupabaseStoragePublicUrl(
    buildPortfolioStreamManifestPath("hero"),
  );
  const heroPosterUrl = buildSupabaseStorageRenderUrl(
    buildPortfolioVideoPosterPath("hero"),
    { width: 1920, quality: 75 },
  );

  return (
    <>
      <section className="relative z-10 h-svh w-full overflow-hidden bg-black isolate after:absolute after:inset-0 after:pointer-events-none after:bg-[linear-gradient(rgba(0,0,0,0.55)_0%,rgba(0,0,0,0.15)_35%,rgba(0,0,0,0.75)_100%)]">
        <HeroVideo
          manifestUrl={heroManifestUrl}
          posterUrl={heroPosterUrl}
        />
        <ScrollBars />
      </section>

      <HeroWordmark />

      <div className="relative z-10 columns-1 gap-0 p-0 min-[768px]:columns-2 min-[992px]:columns-3 min-[1280px]:columns-4">
        {media.map((item) => {
          const path = buildPortfolioStoragePath(item.slug, item.extension);
          const isVideo = item.extension === "mov";
          const imageSrc = isVideo
            ? null
            : buildSupabaseStorageRenderUrl(path, {
                width: 960,
                quality: 75,
              });
          const manifestUrl = isVideo
            ? buildSupabaseStoragePublicUrl(
                buildPortfolioStreamManifestPath(item.slug),
              )
            : null;
          const posterUrl = isVideo
            ? buildSupabaseStorageRenderUrl(
                buildPortfolioVideoPosterPath(item.slug),
                { width: 960, quality: 75 },
              )
            : null;

          return (
            <article key={item.slug} className="mb-5 break-inside-avoid px-[10px] text-[13px] text-[#e2e1e1]">
              <div className="relative block w-full text-inherit">
                {isVideo ? (
                  <VideoThumb
                    manifestUrl={manifestUrl!}
                    posterUrl={posterUrl!}
                    width={item.width}
                    height={item.height}
                    label={item.title}
                  />
                ) : (
                  <span className="relative block min-h-[60px] w-full overflow-hidden bg-[#050505] grayscale invert transition-[filter] hover:grayscale-0 hover:invert-0 focus-within:grayscale-0 focus-within:invert-0 [&_img]:block [&_img]:h-auto [&_img]:w-full">
                    <Image
                      src={imageSrc!}
                      alt={item.title}
                      width={item.width}
                      height={item.height}
                      quality={75}
                      sizes="(max-width: 767px) 100vw, (max-width: 991px) 50vw, (max-width: 1279px) 33vw, 25vw"
                      unoptimized
                    />
                  </span>
                )}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 px-[5px] pb-[5px] leading-[1.35] text-white mix-blend-difference">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-bold">{item.title}</span>
                    <span>{item.client}</span>
                  </span>
                  <span className="flex min-w-0 flex-col items-end text-right">
                    <span>{item.type}</span>
                    <span>{item.year}</span>
                  </span>
                </span>
              </div>
            </article>
          );
        })}
      </div>

      <section id="contact" className="pointer-events-none relative z-10 h-svh w-full" />
    </>
  );
}
