# @found-in-space/journey-video

Standalone alpha editor and deterministic export tooling for authored
`fis-journey-v1` video journeys.

This package now owns the browser editor surface that used to live inside the
website. It is editor-first: JSON import/export, projection tiles, a perspective
preview, a SkyKit streamed-stars preview, guide editing, timeline editing, and
retiming/ease controls.

It also owns the viable render path: deterministic browser rendering,
JavaScript canvas capture, cached transparent overlay blocks, post-capture
ffmpeg compositing, and render metadata. Blender, screenshot-primary capture,
MediaRecorder capture, and benchmark experiments are intentionally not part of
this package.

```js
import { createJourneyVideoEditor } from '@found-in-space/journey-video/editor';

const editor = createJourneyVideoEditor({
  host: document.querySelector('#editor'),
  journey,
});
```

The standalone app runs at:

```txt
packages/journey-video/examples/editor/index.html
```

## Deterministic Export

The export runner is Node-only and lives behind `@found-in-space/journey-video/export/node`.
It starts the package render page unless you provide `--page-url`, captures sky
frames from the browser canvas, renders each active text block once as a
transparent PNG, and lets `ffmpeg` do the compositing.

```sh
npm run video:install-browsers --workspace @found-in-space/journey-video

npm run video:journey:test --workspace @found-in-space/journey-video

journey-video-render \
  --mode=preview \
  --layout=landscape-1080p \
  --journey=packages/journey-video/examples/radio-bubble/radio-bubble-journey.json
```

`ffmpeg` is an external binary and must be on `PATH`. The browser package is
loaded dynamically so normal editor/package usage does not need Playwright.
For deterministic repository work, Playwright is locked as a root dev
dependency. For consumers, it is an optional peer: install it explicitly only
when using the Node export runner. Unit tests do not require Playwright,
browsers, or ffmpeg; the full render smoke test lives in
`npm run test:integration:export --workspace @found-in-space/journey-video`.

Export helper imports:

```js
import {
  createJourneyVideoOverlayBlocks,
  normalizeJourneyVideoRenderProfile,
} from '@found-in-space/journey-video/export';

import { runJourneyVideoExport } from '@found-in-space/journey-video/export/node';
```

## Package Boundary

- `@found-in-space/spatial` owns path and coordinate math.
- `@found-in-space/journey` owns journey schema, timed evaluation, and retiming
  helpers.
- `@found-in-space/skykit` owns viewer composition.
- `@found-in-space/journey-video` owns editor state, DOM layout, tiles,
  inspector state, import/export, draft storage, deterministic render pages,
  overlay block assets, ffmpeg argument construction, and export metadata.

No website Astro code or old SkyKit runtime code is imported here.
