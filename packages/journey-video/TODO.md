# Journey Video TODO

Implemented in the first alpha editor slice:

- standalone vanilla-DOM editor package and example app;
- timed journey JSON import/export/download;
- projection, perspective, and SkyKit streamed-stars preview tiles;
- guide/timeline editing and retiming/ease controls.

Future work for deterministic capture/export:

- deterministic frame stepping and render-settling rules;
- capture metadata, viewport, scale, codec, and timing profiles;
- browser capture orchestration;
- optional ffmpeg, Playwright, or Blender helpers;
- an editor/export split if capture tooling becomes large enough.

The website editor route is reference material only; this package should remain
the home for reusable journey video editor and export tooling.
