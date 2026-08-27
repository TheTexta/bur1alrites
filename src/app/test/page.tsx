import Image from "next/image";

import { buildSupabaseStoragePublicUrl } from "@/lib/supabase/config";
import { buildPortfolioStoragePath } from "@/lib/portfolio/config";

import { HeroVideo } from "./hero-video";
import { ScrollBars } from "./scroll-bars";
import { VideoThumb } from "./video-thumb";

type MediaItem = {
  slug: string;
  extension: string;
  width: number;
  height: number;
  title: string;
  client: string;
  type: string;
  year: string;
};

// TODO: swap in the real destinations once they are confirmed.
const CONTACT_EMAIL = "#";
const CONTACT_INSTAGRAM = "#";

const MEDIA: MediaItem[] = [
  { slug: "img-0722", extension: "mov", width: 1920, height: 1080, title: "Untitled 0722", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-1254", extension: "mov", width: 1080, height: 1920, title: "Untitled 1254", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "img-0723", extension: "mov", width: 1920, height: 1080, title: "Untitled 0723", client: "bur1alrites", type: "clip", year: "2026" },
  { slug: "screenshot-2026-08-27-at-12-47-38-pm", extension: "png", width: 866, height: 1070, title: "Still 001", client: "bur1alrites", type: "still", year: "2026" },
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

export default function StorageTestPage() {
  const heroSrc = buildSupabaseStoragePublicUrl(
    buildPortfolioStoragePath("hero", "mov"),
  );

  return (
    <>
      <section className="relative z-10 h-svh w-full overflow-hidden bg-black isolate after:absolute after:inset-0 after:pointer-events-none after:bg-[linear-gradient(rgba(0,0,0,0.55)_0%,rgba(0,0,0,0.15)_35%,rgba(0,0,0,0.75)_100%)]">
        <HeroVideo src={heroSrc} />
        <ScrollBars />
        <div className="pointer-events-none absolute inset-x-2 top-1/2 z-20 -translate-y-1/2 text-center font-[AIx_Darbotzcumi] text-[clamp(48px,8vw,260px)] leading-[0.85] uppercase mix-blend-difference">
          <h1 className="relative z-10 m-0 text-white">bur1alrites</h1>
          <h1 aria-hidden="true" className="absolute inset-0 z-0 m-0 text-white opacity-50 blur-[5px] mix-blend-screen">bur1alrites</h1>
        </div>
      </section>

      <div className="relative z-10 columns-1 gap-0 p-0 min-[768px]:columns-2 min-[992px]:columns-3 min-[1280px]:columns-4">
        {MEDIA.map((item) => {
          const path = buildPortfolioStoragePath(item.slug, item.extension);
          const src = buildSupabaseStoragePublicUrl(path);
          const isVideo = item.extension === "mov";

          return (
            <article key={item.slug} className="mb-0 break-inside-avoid px-[10px] text-[13px] text-[#e2e1e1]">
              <div className="block w-full text-inherit">
                <span className="relative block min-h-[60px] w-full bg-[#050505] [&_img]:block [&_img]:h-auto [&_img]:w-full [&_video]:block [&_video]:h-auto [&_video]:w-full [&_img]:transition-[filter] [&_video]:transition-[filter] [&_img]:grayscale [&_img]:invert [&_video]:grayscale [&_video]:invert hover:[&_img]:grayscale-0 hover:[&_img]:invert-0 hover:[&_video]:grayscale-0 hover:[&_video]:invert-0 focus-within:[&_img]:grayscale-0 focus-within:[&_img]:invert-0 focus-within:[&_video]:grayscale-0 focus-within:[&_video]:invert-0">
                  {isVideo ? (
                    <VideoThumb
                      src={src}
                      width={item.width}
                      height={item.height}
                      label={item.title}
                    />
                  ) : (
                    <Image
                      src={src}
                      alt={item.title}
                      width={item.width}
                      height={item.height}
                      quality={75}
                      sizes="(max-width: 767px) 100vw, (max-width: 991px) 50vw, (max-width: 1279px) 33vw, 25vw"
                    />
                  )}
                </span>
                <span className="relative z-10 flex items-start justify-between -mt-10 leading-[1.35] text-white mix-blend-difference max-[479px]:mt-0">
                  <span className="flex min-w-0 flex-col">
                    <span className="mt-[5px] pl-[5px] font-bold">{item.title}</span>
                    <span className="pb-[5px] pl-[5px]">{item.client}</span>
                  </span>
                  <span className="flex min-w-0 flex-col items-end text-right">
                    <span className="mt-[5px] px-[5px] max-[479px]:pl-[5px] max-[479px]:pr-0">{item.type}</span>
                    <span className="mb-[15px] px-[5px] pb-[5px] pr-0">{item.year}</span>
                  </span>
                </span>
              </div>
            </article>
          );
        })}
      </div>

      <section className="relative z-10 flex flex-col items-center gap-6 px-[10px] py-[18vh] text-center text-black">
        <h2 className="m-0 font-[AIx_Darbotzcumi] text-[clamp(32px,6vw,140px)] leading-[0.85] uppercase">
          contact
        </h2>
        <ul className="m-0 flex list-none flex-col items-center gap-2 p-0 text-[clamp(14px,1.4vw,20px)] uppercase">
          <li>
            <a className="underline-offset-4 hover:underline" href={CONTACT_EMAIL}>
              email
            </a>
          </li>
          <li>
            <a
              className="underline-offset-4 hover:underline"
              href={CONTACT_INSTAGRAM}
              target="_blank"
              rel="noreferrer noopener"
            >
              instagram
            </a>
          </li>
        </ul>
      </section>
    </>
  );
}
