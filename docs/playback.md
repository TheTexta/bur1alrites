# Playback and rendering

The public gallery combines HTML layout with Three.js rendering. Gallery videos
have direct links at `/?video=<slug>`; original MOV/MP4 files remain archival
masters rather than browser playback URLs.

## Preview lifecycle

Gallery cards initially show resized posters. In and just outside the viewport,
preview players preload a paused first frame. HLS.js previews select the lowest
rendition with a four-second forward buffer; hero and full-room streams retain
adaptive quality. The hero starts at the lowest rendition, normally 540p, with
720p/1080p available when source dimensions permit.

Only the active preview plays and uploads video frames to the 3D scene.
Scrolling away releases streams/video resources; HTML and mobile rendering use
the same viewport policy. Posters remain visible until a playback frame arrives.

Desktop gallery planes render within a 20% viewport buffer on every edge so camera
parallax does not expose missing panels; desktop video preloading also covers the
horizontal buffer. The HTML/mobile loading policy is unchanged.

Failed previews are discarded. Active previews get at most two automatic
recovery attempts, after 0.5s and 1.5s; eight seconds without playback progress
triggers a fresh stream. Re-hovering or reconnecting can retry an unavailable
preview. Autoplay denial does not trigger automatic retries. Leaving the
viewport, hiding the tab or opening a full video room cancels pending preview
attachments and recovery work.

## Ownership boundaries

- [`viewport-video-pool.ts`](../src/lib/viewport-video-pool.ts) owns the
  one-active-preview lifecycle shared by the rendering paths.
- [`gallery-targets.ts`](../src/app/gallery-targets.ts) owns gallery-local slug
  registration and responsive handoffs. HTML callback refs supply scene layout
  and visibility targets without DOM discovery, including late grid commits.
- [`room-session.ts`](../src/app/room-session.ts) owns keys and look/walk pose
  across internal rig remounts. Owner teardown releases pointer lock and shared
  visibility.
- [`preview-navigation-bridge.tsx`](../src/app/preview-navigation-bridge.tsx)
  reports public destinations to an allowed parent portfolio origin. Preserve its
  origin restrictions and the parent application's frame validation together.

`npm test` discovers deterministic preview, room-session and gallery-target tests
using fake browser events/layout targets. Browser emulation is not physical
iOS/Safari verification; see the [historical rollout record](../cloudflare-assets/ROLLOUT.md).
