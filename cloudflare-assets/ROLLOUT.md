# R2 rollout status — 2026-10-01

Production cutover is complete for both sites:

| Project | Site | Images | Media |
| --- | --- | --- | --- |
| bur1alrites | https://bur1alrites.vercel.app | https://images.dextery.dev/bur1alrites | https://media.dextery.dev/bur1alrites |
| elliotmairet | https://elliotmairet.com | https://images.dextery.dev/elliotmairet | https://media.dextery.dev/elliotmairet |

## Delivery and deployment

- `dextery-assets` binds only the published `bur1alrites` and `elliotmairet`
  buckets. The private Elliot staging bucket remains separate.
- `media.dextery.dev` is the Worker's custom domain. The existing image-domain
  bucket attachment remains intact. The two namespaced image routes were added
  manually in the Cloudflare dashboard and verified live. Legacy Elliot root
  image URLs and existing `/cdn-cgi/image/` URLs remain available.
- The current account token cannot write zone routes or inspect DNS records.
  Subsequent Worker code changes use `npm run assets:publish`, which uploads and
  deploys a Worker version while preserving dashboard-managed routes. Full
  provisioning through `assets:deploy` still requires the documented zone
  permissions. No unrelated DNS records were changed.
- Both Vercel applications have their namespaced production environment values
  and passed production builds. bur1alrites deployment is
  `dpl_4x3oNRt5rKV5gaHzrSYCNFr7acbX`; Elliot deployment is
  `dpl_7823TwkVLpi9hin3gyMqFRyJMXRx`.
- Two Elliot originals exceed Cloudflare's resizing limits. Verified 5120-pixel
  WebP delivery sources were prepared without changing original bytes or
  catalogue storage paths. Future uploads and existing cleanup jobs cover
  delivery sources as well as originals. The Worker checks source ownership
  metadata before transforming them.

## Storage and worker

- Created `bur1alrites`, configured direct-upload CORS, and copied/read-back
  verified all 416 Supabase objects (0.40 GiB), including originals, images,
  posters, and HLS. Final reconciliation copied zero additional objects.
  Supabase source objects are retained.
- Applied `202610010001_r2_upload_reservations.sql`; reservation retries and
  duplicate slug protection passed. Only the service role can execute the RPC.
- Applied `202610010002_pause_legacy_storage_uploads.sql` before final
  reconciliation. Restrictive policies pause authenticated INSERT/UPDATE on the
  legacy bur1alrites bucket while retaining reads, other buckets, and existing
  policies. New uploads use R2.
- The existing Coolify resource `efcsusbcma6nnmd1zp1fn21n` runs
  `bur1alrites-hls:r2-20261001`. It reused all 24 migrated video outputs without
  re-encoding. Its previous Supabase worker was already stopped at inspection.

## Validation

- bur1alrites: 60 tests; Elliot: 22 image/configuration/storage tests. Both
  repositories passed lint and production builds; Worker compilation passed.
- Corrected inherited HTTP transport-encoding metadata on 254 verified R2 copies;
  original bytes and HLS fingerprints remain unchanged. The Worker excludes old
  cache entries and strips that legacy transport header from migrated objects.
  Regression tests cover decoded migration bytes and identity byte ranges.
  Browser verification used a fresh context: previously cached bad immutable
  ranges from initial cutover require clearing cached media site data.
- Live delivery checks passed project routing, encoded keys, private-path
  exclusion, HEAD, 304 validators, ranges, cache policies, responsive image
  dimensions, AVIF/WebP/JPEG negotiation, and replaced-image invalidation.
- All 227 Elliot gallery images loaded in desktop and mobile browser emulation,
  including the oversized photographs. Delivery-source reruns verified existing
  copies. No browser console errors were observed.
- bur1alrites desktop hero and gallery playback, Three.js textures, and mobile
  playback passed in Chrome with mobile emulation. Physical iOS/Safari testing
  remains advisable; emulation does not exercise Apple's native HLS runtime.
- A temporary real Supabase Auth user exercised the production upload API:
  unauthenticated/non-admin/cross-origin requests, oversized files, tampered
  sessions, incomplete uploads, 32 MiB multipart parts, part retries, completion,
  duplicate slugs, repeated completion, abort, and repeated abort behaved as
  expected. The R2 worker processed its synthetic clip; HLS and the resized admin
  poster preview returned 200. The test row stayed archived. All temporary
  objects, the row, and the temporary Auth user were removed.

## Viewport preview follow-up

- Gallery videos now preload paused previews in and near the viewport, reuse
  decoded frames on hover, and release streams after scrolling away.
- HLS.js preview buffers use the lowest rendition with a four-second forward
  buffer; hero and full video-room streams retain adaptive quality.
- Three warmed production hover checks reached the first moving frame in
  7–16 ms. Desktop switching, viewport cleanup, Android emulation, and native
  HLS playback in iPhone emulation passed. Physical device testing remains
  separate from browser emulation.

## Rollback retention

Supabase originals and previous Vercel deployments are retained. Private local
configuration backups (not committed) are in `~/.codex/r2-rollout/`:

- `bur1alrites-vercel-before-cutover.json`
- `elliotmairet-vercel-before-cutover.json`
- `bur1alrites-worker-before-r2.json`

Previous production deployments were
`bur1alrites-12wob61tt-thetextas-projects.vercel.app` and
`elliotmairet-qsj6zea41-thetextas-projects.vercel.app`.

Before restoring Supabase storage delivery, reconcile any new R2 uploads into
retained source storage. Restore prior application environment/deployments and
prior worker configuration; then remove the two legacy-upload pause policies
using the SQL in the root README. Do not delete originals during retention.
