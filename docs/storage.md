# Storage and shared delivery

This describes the application's delivery contract and retained migration tools.
It is not confirmation of current production state. The
[October rollout record](../cloudflare-assets/ROLLOUT.md) preserves dated evidence.
Review targets and obtain approval before provisioning, copying or rollback.

## Shared delivery contract

| Project | Images | Media |
| --- | --- | --- |
| bur1alrites | `https://images.dextery.dev/bur1alrites` | `https://media.dextery.dev/bur1alrites` |
| elliotmairet | `https://images.dextery.dev/elliotmairet` | `https://media.dextery.dev/elliotmairet` |

Project prefixes select a published bucket and are removed before lookup;
stored keys remain unchanged. The retained Worker snapshot binds only these two
published buckets, never private Elliot staging. It excludes incoming uploads
such as `portfolio-images/incoming/` from public delivery.

`media.dextery.dev` is configured as a Worker custom domain. The image domain
keeps its existing Elliot bucket attachment; only the project-prefix routes invoke
this Worker. Preserve legacy Elliot `/uploads/...` and `/cdn-cgi/image/...` URLs.
Do not replace the image domain's bucket attachment.

Originals support GET, HEAD, validators and byte ranges. Resized images use
validated `width`, `quality` and `format=auto` parameters. The Worker uses
ETag-versioned sources through the media hostname and Cloudflare's `cf.image`
API. The Next.js loader and Three.js textures share these URLs; Next.js does not
optimize them again.

The retained [`cloudflare-assets/`](../cloudflare-assets/README.md) source is
for rollback/checks only. Shared `dextery-assets` publishing belongs to the private
`TheTexta/dextery-infrastructure` repository. Keeping historical Wrangler
configuration does not authorize direct deployment from this application.

## Bucket provisioning

After [environment setup](configuration.md), run from the repository root:

```bash
npm run r2:setup
```

This contacts Cloudflare to inspect bucket existence without writing.
With explicit approval for the target bucket/CORS change:

```bash
npm run r2:setup -- --apply
```

The script manages only the configured bucket and upload CORS, never Worker
routes or versions. `--bucket-only` remains accepted for older commands.
Its API token needs R2 provisioning permissions; the S3-compatible credentials
configure CORS. Worker publishing has a separate permission/approval boundary.
CORS includes `NEXT_PUBLIC_SITE_URL` and localhost ports 3000/3001; set the
intended site origin before applying.

## Retained migration workflow

Configure the Supabase source and R2 target deliberately; the source bucket
defaults to `bur1alrites`. These commands contact configured services:

```bash
npm run storage:migrate:r2               # Paginated inventory, no writes
npm run storage:migrate:r2 -- --verify   # Read/check previously copied objects
```

Only after authorizing writes to the target:

```bash
npm run storage:migrate:r2 -- --copy     # Copy, repair metadata and verify SHA-256
```

The migration preserves paths, content types, cache metadata and HLS source
fingerprints, excluding abandoned incoming uploads. It writes stable masters
last and refuses to overwrite unmanaged objects. Reruns verify existing copies,
repair legacy transport-encoding metadata with `--copy`, and copy changed sources.
HTTP-decoded bytes never inherit a proxy response's compression header.
Each source is spooled to temporary disk before upload and removed afterwards.

For any approved cutover, verify shared delivery first, including legacy Elliot
URLs. Pause uploads and the old worker for final reconciliation, verify every
object, then switch applications to namespaced public URLs. Start the R2 worker
and confirm migrated fingerprints reuse HLS output. Smoke-test posters, Three.js
textures, HLS playback and the editor. Shared routing changes need cross-site
regression checks and must use the infrastructure repository.

## Rollback

Retain source objects and previous application/worker deployment settings through
the approved retention period. Reconcile new R2 uploads back into retained source
storage before any Supabase-only rollback; a configuration rollback alone is not
enough. Restore prior application/worker deployments and public URL settings.

Only as part of an approved legacy-upload restoration, remove the two pause
policies using the installation's SQL administration workflow:

```sql
drop policy "Pause legacy bur1alrites browser inserts" on storage.objects;
drop policy "Pause legacy bur1alrites browser updates" on storage.objects;
```

These statements restore legacy write-policy behavior, not missing source
objects. Do not delete originals during retention or treat rollback commands as
permission tests.
