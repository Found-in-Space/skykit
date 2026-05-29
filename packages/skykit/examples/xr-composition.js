import * as THREE from 'three';

import {
  createSkykitLayerHostPlugin,
  createSkykitProductRegistryPlugin,
  createSkykitStarSourcePlugin,
  createSkykitViewer,
  createStreamingStarsPlugin,
  productRef,
} from '@found-in-space/skykit';
import {
  createSkykitXrComposition,
  createSkykitXrPickBridgePlugin,
} from '@found-in-space/skykit/xr';
import { createObserverShellStrategy } from '@found-in-space/star-trees';
import { createThreeStarField } from '@found-in-space/three-star-field';

const XR_EXAMPLE_TARGET_PRODUCT = 'interaction:xr-composition-example/target';

/**
 * Package-level XR composition example.
 *
 * @param {{
 *   host: HTMLElement;
 *   provider: import('@found-in-space/star-octree-provider').StarOctreeProviderService;
 * }} options
 */
export async function createXrCompositionExample(options) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, xrCompatible: true });
  const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10000);
  const products = createSkykitProductRegistryPlugin({ id: 'xr-example-products' });
  const stellarSource = createSkykitStarSourcePlugin({
    id: 'xr-example-stellar-source',
    provider: options.provider,
    session: {
      id: 'xr-example-stars',
      strategy: createObserverShellStrategy(),
    },
    publish: {
      source: 'stars:stellar/source',
      store: 'stars:stellar/store',
    },
  });
  const starField = createThreeStarField({
    limitingMagnitude: 7.5,
    exposure: 2500,
  });
  const xr = createSkykitXrComposition({
    renderer,
    camera,
    coordinateUnitsPerParsec: 0.001,
    scaleBandIds: ['galactic'],
    rayVisuals: true,
  });
  const layerHost = createSkykitLayerHostPlugin({
    layers: [
      {
        id: 'xr-example-target-layer',
        setup(ctx) {
          ctx.provideProduct(XR_EXAMPLE_TARGET_PRODUCT, {
            pick(ray, context) {
              return {
                distance: context.maxDistance ?? ray.length ?? 1,
                label: 'XR example target',
              };
            },
          }, {
            kind: 'interaction-target',
            ownerId: 'xr-composition-example',
          });
        },
      },
    ],
  });
  const xrPick = createSkykitXrPickBridgePlugin({
    raySource: xr.rays.right,
    targetProducts: [productRef(XR_EXAMPLE_TARGET_PRODUCT)],
    routeOnFrame: true,
  });

  const viewer = await createSkykitViewer({
    host: options.host,
    renderer,
    camera,
    roots: xr.roots,
    cameraRoot: xr.cameraRoot,
    observerRig: xr.observerRig,
    view: {
      coordinateUnitsPerParsec: 0.001,
      limitingMagnitude: 7.5,
    },
    plugins: [
      ...xr.plugins,
      products,
      stellarSource,
      createStreamingStarsPlugin({
        id: 'xr-example-stars',
        source: stellarSource,
        renderer: starField,
      }),
      layerHost,
      xrPick,
    ],
  });

  return {
    viewer,
    xr,
    products,
    stellarSource,
    starField,
    layerHost,
    xrPick,
    enter: () => xr.enter(),
    exit: () => xr.exit(),
    async dispose() {
      await viewer.dispose();
      await xr.dispose();
    },
  };
}
