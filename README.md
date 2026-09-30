# bur1alrites

When this site is embedded in the project browser at `dextery.dev`, public page
links report their destinations to the parent portfolio so they open as the
top-level page. Standalone browsing is unchanged. The bridge also accepts local
portfolio development origins.
Gallery videos have direct links at `/?video=<slug>`. Opening one of these
links loads the full site with the selected video room open.

## Adaptive video delivery

MOV and MP4 files in `portfolio-images/` are preserved as archival masters.
The site only requests HLS manifests and segments:

- The hero starts at the 540p HLS rendition and can adapt to 720p/1080p.
- Gallery clips render as lazily loaded poster planes in the Three.js room. One
  shared HLS player and video texture attach immediately on hover, then stop and
  return the card to its poster when the pointer leaves.
- Source videos are never rendered as a browser video URL.

The worker at [media-worker](./media-worker) reconciles the existing bucket
every five minutes. A new or replaced video has a new source fingerprint, so the
worker creates versioned fMP4 HLS segments and uploads the stable manifest only
after every segment is present. Immutable versioned segments receive a one-year
cache policy; the small stable manifest and poster revalidate normally.

### Deploy the worker in Coolify

1. Create a separate Compose resource from this repository with
   `media-worker` as the working directory.
2. Copy [`.env.example`](./media-worker/.env.example) to the resource’s `.env`
   and set the existing Supabase service-role key there. Keep that key in the
   worker and site server environments; never put it in a `NEXT_PUBLIC_` variable.
3. Deploy. The worker adds the HLS playlist MIME type to the existing public
   `bur1alrites` bucket, processes one video at a time, and has no inbound port.

### Admin gallery

The private editor is available at `/admin` and signs in with Supabase Auth
email and password. Configure `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the server-only
`SUPABASE_SERVICE_ROLE_KEY` in the site deployment. The public anon key comes
from the same Supabase project as the service-role key.

Apply pending SQL files in `supabase/migrations/` in filename order. The
ordering migration defines the `create_gallery_item` and `move_gallery_item`
RPCs needed by uploads and reordering. The upload policies allow portfolio
admins to send staged MOV and MP4 videos directly to Storage. Confirm both RPCs
appear in the project's PostgREST API schema before using the editor.

Create or choose a confirmed email/password user in Supabase Auth, then grant
that user portfolio access with `npm run admin:access -- <email> grant`. This
sets `app_metadata.bur1alrites_admin` on the Auth user. Other Supabase users
cannot access the editor API. To remove access, use `revoke` instead of `grant`.

The browser uploads MOV and MP4 videos up to 5 GiB directly to Supabase Storage
using the admin's Supabase Auth session and a resumable upload. After transfer,
the site server moves the file into the portfolio path and queues the gallery
record for the media worker. The Storage service's global limit and the
`bur1alrites` bucket limit must both be at least 5 GiB. The worker streams the
source to temporary disk and needs enough free space for the source and HLS
outputs. The service-role key stays on the server.

For a one-off backfill, run:

```bash
npm run hls:worker:once
```

To validate only one source before a full backfill:

```bash
HLS_SOURCE_OBJECT=hero.mov npm run hls:worker:once
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
