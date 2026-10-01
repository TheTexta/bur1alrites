# bur1alrites

A Next.js portfolio with Supabase Auth and Postgres, and media stored in
Cloudflare R2. Gallery videos have direct links at `/?video=<slug>`. Embedded
public links report their destinations to the parent portfolio at `dextery.dev`.

Gallery cards preload paused video previews in and just outside the viewport.
HLS.js previews use the lowest rendition and a short buffer, retaining a decoded
first frame for immediate hover playback. Only the active preview uploads video
frames to the 3D scene. Scrolling cards away releases their streams and video
resources; HTML and mobile previews follow the same viewport loading policy.

## Setup

Use Node.js 22 or later. Install dependencies, copy `.env.example` to
`.env.local`, fill in the credentials, and run `npm run dev`.

Supabase credentials must refer to the same project. The anon key is public;
`SUPABASE_SERVICE_ROLE_KEY` and the Cloudflare access ID and secret stay on the
server. The application uses `CLOUDFLARE_R2_BUCKET=bur1alrites`. The API token
and account ID are needed only by the provisioning script.

## Shared asset delivery

The Worker in `cloudflare-assets/` serves two published buckets:

| Project | Images | Media |
| --- | --- | --- |
| bur1alrites | `https://images.dextery.dev/bur1alrites` | `https://media.dextery.dev/bur1alrites` |
| elliotmairet | `https://images.dextery.dev/elliotmairet` | `https://media.dextery.dev/elliotmairet` |

Prefixes select the bucket and are removed before lookup. Existing keys remain
unchanged. The private Elliot staging bucket is never bound, and bur1alrites
`portfolio-images/incoming/` uploads are excluded from public delivery.

`media.dextery.dev` is a Worker custom domain. The image domain keeps its existing
Elliot bucket attachment; only the two project prefix routes invoke this Worker.
Legacy Elliot `/uploads/...` and `/cdn-cgi/image/...` URLs keep working. Do not
replace the image domain's bucket attachment.

Image originals support GET, HEAD, validators, and byte ranges. Resized images
use `width`, `quality`, and `format=auto` query parameters. The Cloudflare loader
and Three.js textures share these URLs; Next.js does not optimize them again.
The Worker validates sizes and formats and fetches an ETag-versioned source
through the media hostname using Cloudflare's `cf.image` transformation API.

```bash
npm run r2:setup                    # Inspect the bucket without writing
npm run r2:setup -- --apply --bucket-only
npm run assets:check                # Compile the Worker without deploying
npm run assets:deploy               # Configure bucket CORS and deploy routes
npm run assets:publish              # Update Worker code; preserve existing routes
```

Provisioning requires account Workers Scripts and Workers R2 Storage write
permissions, zone read access, Workers Routes edit permission for `dextery.dev`,
and DNS read access to inspect conflicts. If routes are managed manually in the
dashboard, use `assets:publish` for subsequent code updates: version uploads and
deployment preserve those routes without requiring zone route-write access.
The setup script rejects conflicting
Worker ownership and preserves unrelated records. Upload CORS includes the
configured `NEXT_PUBLIC_SITE_URL` and local development origins; configure the
site's production origin before provisioning.

## Admin gallery

Apply SQL files in `supabase/migrations/` in filename order. In particular,
`202610010001_r2_upload_reservations.sql` creates the service-role-only reservation
RPC used to make multipart completion safe to retry. Existing Supabase Storage
policies remain during rollback retention. The next migration adds restrictive
INSERT/UPDATE policies for authenticated clients on the old bur1alrites bucket,
pausing legacy browser uploads during reconciliation. Other buckets and reads
remain available; new uploads use R2.

Sign in at `/admin` with a confirmed Supabase email/password account. Grant access
with `npm run admin:access -- <email> grant`; use `revoke` to remove it. The API
requires the user's `app_metadata.bur1alrites_admin` claim and checks request
origins.

The browser uploads MOV or MP4 files up to 5 GiB directly to R2 using 32 MiB
multipart chunks and at most three concurrent transfers. Failed parts use fresh
signed URLs and bounded retries. Keep the page open until completion; upload
sessions are not restored after a reload. Finalization can be retried on the same
page without sending the source again. The API initializes uploads with POST,
signs parts with PATCH, completes and queues clips with PUT, and aborts with
DELETE. Sessions bind the object, multipart ID, metadata, size, and expiry.

Completed abandoned staging objects are cleaned after 48 hours by the HLS
worker. R2's automatic multipart expiry handles incomplete abandoned transfers.
Sources and service credentials never pass through the browser application
server during transfer.

## Adaptive video delivery

MOV and MP4 files in `portfolio-images/` remain archival masters. Browsers request
HLS manifests and segments. The hero starts at 540p and adapts to 720p/1080p.
Gallery cards initially render resized poster textures; a shared HLS player
attaches on hover and returns the card to its poster afterwards.

The worker in `media-worker/` scans R2 every five minutes, streams sources to
temporary disk, and encodes one source at a time with FFmpeg. Give it enough disk
for a source plus its outputs. Versioned HLS outputs are immutable for one year.
Stable master manifests and posters use `no-cache`. Segments are published before
the poster and stable master manifest; database status updates remain in Supabase.

Deploy `media-worker/Dockerfile` as a separate Coolify Compose resource with no
inbound port, using `media-worker/.env.example` for its environment. The existing
resource is `bur1alrites-hls-worker`. For an initial local deployment, build and
transfer the image, then select that image in the resource; switch back to the
repository build after these changes are committed and available remotely.

```bash
npm run hls:worker:once
HLS_SOURCE_OBJECT=hero.mov npm run hls:worker:once
node scripts/upload-portfolio-images.mjs <directory>
```

## Migration and rollout

```bash
npm run storage:migrate:r2               # Paginated inventory, no writes
npm run storage:migrate:r2 -- --copy     # Copy and read back SHA-256 verification
npm run storage:migrate:r2 -- --verify   # Verify previously copied objects
```

Migration preserves paths, content types, cache metadata, and HLS source
fingerprints, excluding abandoned incoming uploads. It writes stable masters
last and refuses to overwrite objects without migration ownership metadata.
Reruns verify the existing copy, repair legacy transport-encoding metadata, and
copy changed sources. The decoded bytes returned by HTTP fetch never inherit
the proxy response's compression header. Each source is spooled
to temporary disk before upload and removed afterwards.

Deploy and verify shared delivery first, including existing Elliot URLs. Pause
uploads and the old worker for final reconciliation; verify every object before
switching the applications to their namespaced public URLs. Start the R2 worker
and check that migrated fingerprints reuse existing HLS output. Smoke-test
posters, Three.js textures, HLS playback, and the editor after deployment.

Retain Supabase objects and the previous site/worker deployment settings during
cutover. For rollback, restore the prior application and worker deployments and
public URL settings, and remove the two legacy-upload pause policies:

```sql
drop policy "Pause legacy bur1alrites browser inserts" on storage.objects;
drop policy "Pause legacy bur1alrites browser updates" on storage.objects;
```

Do not delete source objects until the retention period is
over. New R2 uploads must be reconciled separately before rolling back storage.

## Validation

```bash
npm test
npm run lint
npm run build
npm run assets:check
```
