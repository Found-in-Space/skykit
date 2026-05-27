import * as THREE from 'three';

import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createObserverShellStrategy } from '@found-in-space/star-trees';
import { createThreeStarField } from '@found-in-space/three-star-field';

import { createSkykitAnimationLoop } from './animation-loop.js';
import {
  createKeyboardNavigationPlugin,
  createSkyGrabPlugin,
  createSkykitStatusPlugin,
  createStreamingStarsPlugin,
} from './plugins.js';
import { createSkykitViewer } from './viewer.js';

const DEFAULT_LIMITING_MAGNITUDE = 6.5;
const DEFAULT_EXPOSURE = 2400;
const DEFAULT_UNITS_PER_PARSEC = 0.001;
const DEFAULT_MAX_DEVICE_PIXEL_RATIO = 2;

/**
 * Create the default browser star viewer used by the starter lessons.
 *
 * @param {import('./browser.d.ts').SkykitBrowserOptions | import('./browser.d.ts').SkykitBrowserHost} [input]
 * @returns {Promise<import('./browser.d.ts').SkykitBrowser>}
 */
export async function createSkykitBrowser(input = {}) {
  const options = normalizeOptions(input);
  const host = resolveTarget(options.host ?? '#viewer', 'SkyKit browser host');
  const statusTarget = options.status === false || options.status == null
    ? null
    : resolveTarget(options.status, 'SkyKit status target');
  const limitingMagnitude = positive(options.limitingMagnitude, DEFAULT_LIMITING_MAGNITUDE);
  const renderer = options.renderer ?? new THREE.WebGLRenderer({
    antialias: options.antialias !== false,
  });
  const camera = options.camera ?? new THREE.PerspectiveCamera(
    positive(options.fovDeg, 58),
    1,
    positive(options.near, 0.0001),
    positive(options.far, 1000),
  );
  const provider = options.provider ?? createStarOctreeProviderService({
    url: options.octreeUrl ?? OCTREE_DEFAULT,
  });
  const starField = options.starField ?? createThreeStarField({
    limitingMagnitude,
    exposure: positive(options.exposure, DEFAULT_EXPOSURE),
  });

  renderer.setClearColor?.(options.background ?? 0x02040b, 1);
  if (host.style && options.disableTouchAction !== false) host.style.touchAction = 'none';

  const viewer = await createSkykitViewer({
    host,
    renderer,
    camera,
    view: {
      observerPc: { x: 0, y: 0, z: 0 },
      coordinateUnitsPerParsec: positive(options.coordinateUnitsPerParsec, DEFAULT_UNITS_PER_PARSEC),
      limitingMagnitude,
      ...(options.view ?? {}),
    },
    plugins: [
      createStreamingStarsPlugin({
        id: 'stars',
        provider,
        renderer: starField,
        session: {
          strategy: options.strategy ?? createObserverShellStrategy(),
          ...(options.session ?? {}),
        },
      }),
      ...(options.keyboard === false ? [] : [
        createKeyboardNavigationPlugin({
          speedPcPerSec: positive(options.speedPcPerSec, 2),
          ...(options.keyboard ?? {}),
        }),
      ]),
      ...(options.grab === false ? [] : [
        createSkyGrabPlugin({
          target: host,
          sensitivityRadiansPerPixel: 0.00075,
          ...(options.grab ?? {}),
        }),
      ]),
      ...(statusTarget ? [createStatusPlugin(statusTarget)] : []),
      ...(options.plugins ?? []),
    ],
  });

  const loop = createSkykitAnimationLoop(viewer, options.loop);
  let disposed = false;

  const resize = () => {
    viewer.resize({
      devicePixelRatio: Math.min(
        window.devicePixelRatio || 1,
        positive(options.maxDevicePixelRatio, DEFAULT_MAX_DEVICE_PIXEL_RATIO),
      ),
    });
  };
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('resize', resize);
    window.removeEventListener('pagehide', disposeSoon);
    window.removeEventListener('beforeunload', disposeSoon);
    loop.dispose();
    await viewer.dispose();
    if (!options.provider) await provider.dispose?.();
    if (!options.renderer) renderer.dispose?.();
  };
  const disposeSoon = () => { void dispose(); };

  if (options.autoResize !== false) window.addEventListener('resize', resize);
  if (options.autoDispose !== false) {
    window.addEventListener('pagehide', disposeSoon, { once: true });
    window.addEventListener('beforeunload', disposeSoon, { once: true });
  }
  resize();
  if (options.autoStart !== false) loop.start();

  return { viewer, renderer, camera, provider, starField, loop, resize, dispose };
}

function createStatusPlugin(target) {
  return createSkykitStatusPlugin({
    intervalSeconds: 0.5,
    render({ viewer }) {
      const stars = viewer.parts.find((part) => part.id === 'stars')?.snapshot;
      target.textContent = JSON.stringify({
        observerPc: viewer.view.observerPc,
        starsLoaded: stars?.renderer?.starCount ?? 0,
        stream: stars?.status ?? 'starting',
      }, null, 2);
    },
  });
}

function normalizeOptions(input) {
  if (typeof input === 'string' || isElementLike(input)) return { host: input };
  return input ?? {};
}

function resolveTarget(input, label) {
  if (typeof input !== 'string') {
    if (input) return input;
    throw new Error(`${label} is missing.`);
  }
  const target = document.querySelector(input);
  if (!target) throw new Error(`${label} not found: ${input}`);
  return target;
}

function isElementLike(value) {
  return Boolean(value && typeof value === 'object' && 'appendChild' in value);
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
