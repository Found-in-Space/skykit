# Chapter And Camera Timeline Architecture

SkyKit core does not own a guided-tour runtime. Website topics keep chapter
behavior in their viewer scripts, and Studio owns deterministic camera timeline
authoring/export.

## Website Chapters

A topic viewer should define a `chapters` object keyed by chapter ID. Each
chapter exposes a label and an `activate(ctx)` function:

```js
const chapters = {
  pleiades: {
    label: 'Pleiades',
    async activate({ viewer }) {
      await viewer.actions.invoke('skykit:navigation.cancel');
      await viewer.actions.invoke('skykit:navigation.transitionTo', {
        view: { lookAt: { targetPc: { x: -3, y: 4, z: 130 } } },
        movement: { durationSecs: 4 },
      });
    },
  },
};
```

`setupNarratedTour()` is only DOM/article wiring. It should call the viewer
result's `goTo(id)`, and `goTo(id)` should dispatch to
`chapters[id].activate({ viewer, provider, renderer })`. Any preload behavior is
an optional app-owned `chapter.preload?.(ctx)` function.

## Studio Camera Timelines

Timed video/editor data belongs to the sibling
[`Found-in-Space/skykit-studio`](https://github.com/Found-in-Space/skykit-studio)
repository. The Studio-owned public subpath is
`@found-in-space/skykit-studio/camera-timeline`. It owns camera timeline
normalization, evaluation, cue/track helpers, and retiming utilities used by the
editor and deterministic export pipeline.

Core SkyKit remains focused on reusable viewer, navigation, renderer, star
streaming, action, and plugin primitives.
