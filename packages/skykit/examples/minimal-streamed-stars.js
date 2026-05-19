import {
  createKeyboardNavigationPlugin,
  createSkykitAnimationLoop,
  createSkykitStatusPlugin,
  createSkykitViewer,
  createStreamingStarsPlugin,
} from '@found-in-space/skykit';
import {
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createObserverShellStrategy } from '@found-in-space/star-trees';
import { createThreeStarField } from '@found-in-space/three-star-field';

/**
 * Minimal browser teaching helper.
 *
 * @param {{
 *   host: HTMLElement;
 *   statusTarget?: { textContent?: string | null } | null;
 *   octreeUrl: string;
 * }} options
 */
export async function createMinimalStreamedStarViewer(options) {
  const provider = createStarOctreeProviderService({ url: options.octreeUrl });
  const starField = createThreeStarField();
  const viewer = await createSkykitViewer({
    host: options.host,
    view: { coordinateUnitsPerParsec: 0.001 },
    plugins: [
      createStreamingStarsPlugin({
        provider,
        renderer: starField,
        session: { strategy: createObserverShellStrategy() },
      }),
      createKeyboardNavigationPlugin({ speedPcPerSec: 2 }),
      createSkykitStatusPlugin({ target: options.statusTarget }),
    ],
  });

  const loop = createSkykitAnimationLoop(viewer);
  loop.start();

  return {
    viewer,
    provider,
    starField,
    loop,
    async dispose() {
      loop.dispose();
      await viewer.dispose();
      await provider.dispose?.();
    },
  };
}
