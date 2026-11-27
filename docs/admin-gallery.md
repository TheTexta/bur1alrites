# Admin gallery and uploads

Complete [configuration and database setup](configuration.md) first.
The editor supports video uploads, metadata changes, ordering and
published/archive visibility.

## Access

Use a confirmed Supabase email/password account and sign in at `/admin`.
An authorized operator can grant or revoke this site's admin claim from the
repository root, with the target Supabase URL and service-role key configured:

```bash
npm run admin:access -- <email> grant
npm run admin:access -- <email> revoke
```

These commands change Auth metadata; they are not diagnostic checks.
The helper searches the first 1,000 Auth users. It preserves other app metadata
and sets `app_metadata.bur1alrites_admin` to `true` or `false`.
Admin APIs validate the Supabase user and this site-specific claim; mutation
routes also check request origins.

Application server requests use the service role only after authorization.
The `create_gallery_item` and `move_gallery_item` SECURITY DEFINER RPCs must not
be callable directly by `anon` or `authenticated`; retain the grant restrictions
described in [database setup](configuration.md#database-initialization).

## Upload lifecycle

- The browser sends MOV/MP4 files up to 5 GiB directly to R2, in 32 MiB parts
  with at most three concurrent transfers. The source does not pass through the
  application server, and service credentials never go to the browser.
- Failed parts use freshly signed URLs and bounded retries. Upload sessions bind
  the object key, multipart ID, metadata, size and expiry.
- Keep the page open until completion: sessions are not restored after a reload.
  On the same page, finalization can be retried without resending the source.
- The server reserves the gallery row and promotes the completed incoming object
  to its final key. The HLS worker generates delivery objects and publishes status.

The `/api/admin/upload` protocol uses POST to initialize, PATCH to sign parts,
PUT to complete/queue the clip, and DELETE to abort. Signed sessions expire after
24 hours; part URLs last 15 minutes.

Completed abandoned incoming objects are cleaned after 48 hours by the
[media worker](media-processing.md). R2's automatic multipart expiry handles
incomplete abandoned transfers. Incoming objects must remain excluded from
public delivery; see [storage safeguards](storage.md#shared-delivery-contract).

The CLI [`upload-portfolio-images.mjs`](../scripts/upload-portfolio-images.mjs)
is a separate bulk-ingest tool, not the retry-safe admin workflow. Its
[operational warnings](media-processing.md#bulk-ingest) apply before use.
