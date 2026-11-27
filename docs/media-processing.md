# Media-processing operations

The [media-worker README](../media-worker/README.md) covers requirements and
local startup. Every real worker cycle can write media, change catalogue status
and delete abandoned incoming objects; use only an approved target environment.

## Configuration and processing

Use [`media-worker/.env.example`](../media-worker/.env.example) for required
Supabase and R2 variables. Additional settings:

| Variable | Default | Meaning |
| --- | --- | --- |
| `HLS_SOURCE_PREFIX` | `portfolio-images` | Prefix containing masters and generated output. |
| `HLS_SOURCE_OBJECT` | Unset | Process one filename relative to the prefix; cleanup still runs. |
| `HLS_POLL_INTERVAL_SECONDS` | `300` | Delay after each processing cycle. |
| `HLS_SEGMENT_SECONDS` | `4` | HLS segment duration. |
| `HLS_FFMPEG_PRESET` | `slow` | FFmpeg encoding preset. |

The worker streams top-level MOV/MP4 masters to temporary disk and encodes one
source at a time. Reserve room for the source plus all outputs; the preflight
currently requires source size plus 2 GiB of free temporary space.
Available 540p/720p/1080p profiles do not upscale smaller sources. Current HLS
encoding is video-only; archival masters are not replaced.

Versioned HLS objects are immutable for one year. The poster and stable master
manifest use `no-cache`. Versioned segments/playlists are uploaded before the
poster and stable master; catalogue publication follows. Fingerprints allow
unchanged sources to reuse existing output. Temporary working directories are
removed on success or failure; processing errors are recorded in Supabase.

Each cycle first cleans completed incoming objects older than 48 hours and
unfinalized processing reservations when their final key is absent.
This cleanup is not narrowed by `HLS_SOURCE_OBJECT`.

## Deployment boundary

[`media-worker/Dockerfile`](../media-worker/Dockerfile) uses Node 22 and installs
FFmpeg. Build with `media-worker/` as the context. The accompanying
[`docker-compose.yml`](../media-worker/docker-compose.yml) configures a separate
service named `bur1alrites-hls-worker`, with no inbound port, a two-CPU limit and
4 GiB memory limit. Supply its environment from `media-worker/.env`.

Deploy it as a separately approved Coolify Compose resource, not inside the web
application. The resource name/configuration in source is not evidence of its
current live image or health. Keep prior deployment settings for rollback and
verify playback/status after any approved worker change.

## Bulk ingest

From the repository root, with R2 configuration in `.env.local`:

```bash
node scripts/upload-portfolio-images.mjs <directory>
```

This writes directly to final keys, normalizes filenames to slugs and can
overwrite existing keys without a reservation or confirmation. It neither
creates gallery rows nor runs encoding. Review destination names and collisions
before use; the script skips unsupported extensions and subdirectories.
Prefer the [admin workflow](admin-gallery.md) for ordinary video uploads.
