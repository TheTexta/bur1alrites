# bur1alrites

## Adaptive video delivery

MOV files in `portfolio-images/` are preserved as archival masters. The site
only requests HLS manifests and segments:

- The hero starts at the 540p HLS rendition and can adapt to 720p/1080p.
- Gallery clips load only a poster initially; their HLS player is dynamically
  imported on hover or touch, then destroyed when the pointer leaves.
- Source MOVs are never rendered as a browser video URL.

The worker at [media-worker](./media-worker) reconciles the existing bucket
every five minutes. A new or replaced MOV has a new source fingerprint, so the
worker creates versioned fMP4 HLS segments and uploads the stable manifest only
after every segment is present. Immutable versioned segments receive a one-year
cache policy; the small stable manifest and poster revalidate normally.

### Deploy the worker in Coolify

1. Create a separate Compose resource from this repository with
   `media-worker` as the working directory.
2. Copy [`.env.example`](./media-worker/.env.example) to the resource’s `.env`
   and set the existing Supabase service-role key there. Do not expose that key
   to the site or browser.
3. Deploy. The worker adds the HLS playlist MIME type to the existing public
   `bur1alrites` bucket, processes one MOV at a time, and has no inbound port.

### Admin gallery

The private editor is available at `/admin`. Configure `ADMIN_PASSWORD` and a
long random `ADMIN_SESSION_SECRET` in the site deployment environment. Apply
`supabase/migrations/202608280001_gallery_items.sql` before using the editor;
the public gallery falls back to its current metadata until the table exists.

The admin can edit title, client, type, and year, and can queue new video
sources for the worker. The current upload route sends files through the Next
application, so use a direct signed Supabase upload flow before accepting
large production clips on a serverless host.

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
