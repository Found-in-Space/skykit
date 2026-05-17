# Journey Video TODO

Implemented in the first alpha editor slice:

- standalone vanilla-DOM editor package and example app;
- timed journey JSON import/export/download;
- projection, perspective, and SkyKit streamed-stars preview tiles;
- guide/timeline editing and retiming/ease controls.

Implemented in the first alpha export slice:

- deterministic browser render page;
- JavaScript canvas sky-frame capture;
- cached full-frame transparent overlay block PNGs;
- ffmpeg compositing/MP4 encoding arguments;
- Playwright-backed Node runner and `journey-video-render` bin;
- render metadata with profile, layout, timings, artifacts, and readiness stats.

Future work:

- richer editorial overlay block types beyond cue text;
- deterministic render settling policies for layers that need extra warm-up;
- alternate codecs/containers beyond MP4/H.264;
- timeline/editor controls that preview export-safe overlay blocks;
- video capture/export UI around the existing Node runner.

The website editor route is reference material only; this package should remain
the home for reusable journey video editor and export tooling.
