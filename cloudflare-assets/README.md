# Retained asset Worker

Historical source and configuration for the shared `dextery-assets` Cloudflare
Worker. This directory is retained for rollback and regression checks; it is
**not the active publishing location**.

Shared Worker publishing belongs only to the private
`TheTexta/dextery-infrastructure` repository. Do not run a direct Wrangler deploy
from this checkout. The former `assets:deploy` and `assets:publish` scripts are
absent by design.

## Local checks

Use Node.js 22 or later and npm. From the application repository root:

```bash
npm ci
npm run assets:check
npm test -- cloudflare-assets/worker.test.ts
```

`assets:check` uses Wrangler's `--dry-run` to compile the retained snapshot
without publishing a Worker or changing routes. It does not prove that the
snapshot matches the currently deployed shared Worker.

## Snapshot design

- Project URL prefixes select the published `bur1alrites` or `elliotmairet`
  bucket without changing stored object keys.
- Originals support GET, HEAD, validators and byte ranges.
- Image transforms validate size/format options and use ETag-versioned sources.
- Next.js and Three.js share transformed URLs rather than nesting optimizers.

The private Elliot staging bucket is not bound. Incoming uploads are excluded
from delivery. Preserve these exclusions and legacy Elliot URLs when reviewing
rollback compatibility; do not replace the image domain's bucket attachment.

## Documentation

- [Storage and shared delivery](../docs/storage.md): routing, provisioning,
  migration and rollback safeguards.
- [October 2026 rollout record](ROLLOUT.md): historical verification and retention
  evidence, not a current deployment command sequence.
- [Application overview](../README.md).
