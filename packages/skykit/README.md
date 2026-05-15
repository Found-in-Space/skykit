# @found-in-space/skykit

Alpha composition package for Found in Space teaching experiences.

This package wires focused packages together. It does not load octree bytes,
interpret star products, own star shaders, manage touch surfaces, or contain
journey/chapter logic.

```js
import { createSkykitViewer, createStreamingStarLayer } from '@found-in-space/skykit';
import { createStarOctreeProviderService } from '@found-in-space/star-octree-provider';
import { createThreeStarField } from '@found-in-space/three-star-field';

const provider = createStarOctreeProviderService({ url: STAR_OCTREE_URL });
const renderer = createThreeStarField({ renderScale: 0.001 });

const viewer = await createSkykitViewer({
  host: document.querySelector('#skykit'),
  parts: [
    createStreamingStarLayer({
      provider,
      renderer,
      session: { strategy: { kind: 'observer-shell' } },
    }),
  ],
});

window.viewer = viewer;
```

Use plugins and parts to hack the viewer. A plugin is just an object or function
that receives a public context and registers lifecycle parts, stores, resources,
events, or scheduled work.
