# @found-in-space/journey-video

Standalone alpha editor for authored `fis-journey-v1` video journeys.

This package now owns the browser editor surface that used to live inside the
website. It is editor-first: JSON import/export, projection tiles, a perspective
preview, a SkyKit streamed-stars preview, guide editing, timeline editing, and
retiming/ease controls. Deterministic capture/export with Playwright, ffmpeg, or
Blender remains future work.

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

## Package Boundary

- `@found-in-space/spatial` owns path and coordinate math.
- `@found-in-space/journey` owns journey schema, timed evaluation, and retiming
  helpers.
- `@found-in-space/skykit` owns viewer composition.
- `@found-in-space/journey-video` owns editor state, DOM layout, tiles,
  inspector state, import/export, draft storage, and future capture tooling.

No website Astro code or old SkyKit runtime code is imported here.
