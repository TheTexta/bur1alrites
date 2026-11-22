# Configuration and database setup

Use Node.js 22 or later and the root `package-lock.json` with `npm ci`.
Copy [`.env.example`](../.env.example) to `.env.local`; do not commit credentials.
Example service URLs describe the shared setup, not a disposable local backend.
Choose an authorized development environment before enabling admin operations.

## Application environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public client key for the same Supabase project. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only gallery and Auth administration. |
| `NEXT_PUBLIC_SITE_URL` | Site origin; also included in provisioned upload CORS. |
| `NEXT_PUBLIC_PORTFOLIO_IMAGE_BASE_PATH` | Object prefix, normally `portfolio-images`. |
| `NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_URL` | HTTPS image-delivery base, including the project prefix. |
| `NEXT_PUBLIC_CLOUDFLARE_R2_MEDIA_URL` | HTTPS original/HLS-delivery base, including the project prefix. |
| `CLOUDFLARE_R2_BUCKET` | R2 bucket, default `bur1alrites`. |
| `CLOUDFLARE_S3_API_ENDPOINT` | R2 S3-compatible HTTPS origin, with no path or query. |
| `CLOUDFLARE_ACCESS_ID` | Server-only R2 access key ID. |
| `CLOUDFLARE_SECRET_KEY` | Server-only R2 secret; also signs upload sessions. |

Image/media base URLs cannot contain credentials, query strings or fragments.
Use the same Supabase project for its URL, anon key and service-role key.
Never expose service-role or Cloudflare credentials with a `NEXT_PUBLIC_*` prefix.

These additional variables are not needed by the running application:

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Bucket/CORS provisioning only. |
| `SUPABASE_PORTFOLIO_BUCKET` | Legacy migration source bucket, default `bur1alrites`. |

See [storage operations](storage.md) before running provisioning or migration
scripts. Media-worker configuration is separate; see its
[setup](../media-worker/README.md) and [operations](media-processing.md).

## Database initialization

For a new, authorized Supabase installation, review and apply the `.sql` files in
[`supabase/migrations/`](../supabase/migrations/) in filename order using the
installation's approved SQL administration workflow. They require Supabase's
Auth/Storage schemas and roles, not plain Postgres alone. This repository has
no npm migration command. For an existing installation, apply only missing
migrations after checking its migration history.

- `202610010001_r2_upload_reservations.sql` supplies the service-role-only
  reservation RPC required for retry-safe multipart completion.
- `202610010002_pause_legacy_storage_uploads.sql` adds restrictive INSERT/UPDATE
  policies for authenticated clients on the legacy bur1alrites Storage bucket.
  Existing policies, reads and other buckets remain available; new uploads use R2.
- `20261014213549_restrict_gallery_rpc_execution.sql` must run as the function
  owner (`supabase_admin`) or a role authorized to change the grants. Its assertions
  require service-role execution and deny `anon`/`authenticated` execution of
  `create_gallery_item` and `move_gallery_item`. Do not test grants by calling
  these mutating RPCs.

This does not provision a media catalogue or copy assets. The homepage has a
static fallback list when the gallery request fails, but still needs configured
media delivery. Use the [admin workflow](admin-gallery.md) for new uploads;
legacy imports and storage cutovers require separate review.

## Run

From the repository root, after configuration and database setup:

```bash
npm run dev
```

Open `http://localhost:3000`. For a local production-mode check, run
`npm run build` followed by `npm start`. Neither starts the separate HLS worker.
