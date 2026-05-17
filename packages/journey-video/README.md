# @found-in-space/journey-video

Alpha placeholder for deterministic video/export tooling built around
`@found-in-space/journey`.

This package intentionally has no substantial runtime API yet. It reserves the
boundary for:

- deterministic render/export orchestration;
- capture metadata and render-settling rules;
- layout presets for captions, guides, and instrumentation;
- editor/export tooling;
- future integrations with browser capture, ffmpeg, Playwright, or Blender.

Journey math, cue timing, and authored state evaluation belong in
`@found-in-space/journey`. Viewer composition belongs in `@found-in-space/skykit`.
Website-specific editor UI stays outside this package until the reusable
boundary is clearer.
