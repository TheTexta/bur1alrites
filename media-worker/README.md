# Media worker

A separate Node.js/FFmpeg process that converts R2 video masters into adaptive
HLS streams and posters, then updates gallery processing status in Supabase.
It is a background service, not an HTTP server.

## Requirements

- Node.js 22 or later.
- `ffmpeg` and `ffprobe` on `PATH`; the supplied Docker image installs both.
- R2 read/write access, a Supabase service-role key and temporary disk space for
  a source plus encoded outputs.

## Local setup

From this directory:

```bash
npm ci
cp .env.example .env
```

Fill in `.env` for an authorized environment. Keep credentials server-side.
The worker loads `.env` and then `.env.local` from its working directory.

**Running the worker writes R2 output and database status, and cleans abandoned
uploads. A source filter does not disable cleanup.** After approving those effects,
process one source relative to `HLS_SOURCE_PREFIX`:

```bash
HLS_SOURCE_OBJECT=hero.mov node worker.mjs --once
```

Omit the filter to scan all masters; omit `--once` to poll continuously.
Root-level `npm run hls:worker` and `npm run hls:worker:once` are equivalent entry
points using the root environment files and dependencies.

## Design

- `worker.mjs` owns startup, polling, FFmpeg and real storage/database IO.
- `process-source.mjs` owns fingerprint reuse and ordered publication, with
  injected effects for offline tests.
- `r2.mjs` owns S3-compatible R2 access and source-version fingerprints.
- Archival MOV/MP4 files remain separate from generated playback objects.

See [processing operations](../docs/media-processing.md) for configuration,
publication guarantees, cleanup and the Docker Compose deployment boundary.
Run the offline tests from the repository root after its `npm ci`:
`npm test -- media-worker/process-source.test.mjs`.
