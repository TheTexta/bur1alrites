# bur1alrites

A video portfolio built with Next.js, React and Three.js. Supabase provides
authentication and gallery metadata; Cloudflare R2 stores media.

- Responsive gallery with viewport-loaded hover previews and adaptive HLS playback.
- Full video rooms with direct links at `/?video=<slug>`.
- An authenticated editor for uploads, metadata, ordering and archive visibility.
- A navigation bridge for previews embedded in the parent portfolio at `dextery.dev`.

## Requirements

- Node.js 22 or later and npm.
- A configured Supabase Auth/Postgres project, R2 bucket and HTTPS media delivery.
- FFmpeg is required only for the separate [media worker](media-worker/README.md).

## Local development

Run from the repository root:

```bash
npm ci
cp .env.example .env.local
```

Fill in `.env.local` using [configuration and database setup](docs/configuration.md)
before starting. The example contains shared service URLs: use only an authorized
environment, and never put service-role or R2 secrets in `NEXT_PUBLIC_*` variables.

```bash
npm run dev
```

Open `http://localhost:3000`; admin sign-in is at `/admin`.
For an existing installation, confirm its migrations rather than reapplying them.

## Architecture

- `src/app/` contains the App Router UI, HTML/Three.js rendering and admin API.
- `src/lib/` owns gallery access, media URLs, HLS and the shared preview lifecycle.
- `supabase/migrations/` defines gallery schema, reservations and access policies.
  Server APIs check the site-specific admin claim before service-role writes.
- `media-worker/` processes archival masters separately from the web application.
- `cloudflare-assets/` retains the shared delivery Worker's historical source.
  Publishing belongs to `TheTexta/dextery-infrastructure`, not this checkout.

## Checks

```bash
npm test
npm run lint
npm run assets:check
```

`assets:check` compiles the retained Worker without deploying. To check and serve
the production application locally, with configuration in place:

```bash
npm run build
npm start
```

## Documentation

- [Configuration and database setup](docs/configuration.md)
- [Admin access and upload workflow](docs/admin-gallery.md)
- [Playback behavior and rendering boundaries](docs/playback.md)
- [Media worker](media-worker/README.md) and [processing operations](docs/media-processing.md)
- [Storage, shared delivery and rollback](docs/storage.md)
- [Retained Cloudflare Worker](cloudflare-assets/README.md) and [historical rollout evidence](cloudflare-assets/ROLLOUT.md)
