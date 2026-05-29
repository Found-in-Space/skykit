import * as THREE from 'three';

import {
  SKYKIT_ACTIONS,
  createAnchoredImageCatalog,
  createAnchoredImageSkyPlugin,
  createKeyboardNavigationPlugin,
  createObject3dPlugin,
  createSkyGrabPlugin,
  createSkykitAnimationLoop,
  createSkykitDebugBridge,
  createSkykitNavigationPlugin,
  createSkykitRenderCoordinateOutput,
  createSkykitStarPickingPlugin,
  createSkykitStarSourcePlugin,
  createSkykitViewer,
  createStreamingStarsPlugin,
  createViewAnchoredImageController,
  installSkykitDebugGlobal,
} from '@found-in-space/skykit';
import {
  createSkykitShipControlsRoot,
  createTouchOsHudPlugin,
} from '@found-in-space/skykit/touch-os';
import { createAnchoredImageManifest as createWesternSkycultureAnchoredImageManifest } from '@found-in-space/stellarium-skycultures-western/anchored-image';
import { bundledManifest as westernSkycultureManifest } from '@found-in-space/stellarium-skycultures-western/bundled';
import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import {
  createMetaSidecarProviderService,
  deriveMetaSidecarUrlFromRenderUrl,
  metaSidecarEntryDisplayFields,
} from '@found-in-space/meta-sidecar-provider';
import {
  createObserverShellStrategy,
  createStarCellRefStrategy,
  decodeTemperatureK,
} from '@found-in-space/star-trees';
import { createThreeStarField } from '@found-in-space/three-star-field';
import { icrsToRaDec } from '@found-in-space/spatial';

import {
  approachTargetFromObserver,
  buildSimbadBasicSearch,
  createSelectionResultFromCell,
  findSelectionResultInCells,
  icrsTargetFromRaDecDistance,
  readSelectionMarkerFromUrl,
  resolveSkycultureCommonName,
  serializeStarRefBookmark,
  writeSelectionMarkerToUrl,
} from './free-roam-helpers.js';

const DATASET_ID = datasetIdFromOctreeUrl(OCTREE_DEFAULT);
const WORLD_SCALE = 0.001;
const SOL_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const ORION_CENTER_PC = Object.freeze({ x: 62.775, y: 602.667, z: -12.713 });
const CONSTELLATION_TARGET_DISTANCE_PC = Math.hypot(
  ORION_CENTER_PC.x,
  ORION_CENTER_PC.y,
  ORION_CENTER_PC.z,
);
const CONSTELLATION_LOOK_DURATION_SECS = 1.4;
const CONSTELLATION_FLY_APPROACH_PC = 2;
const CONSTELLATION_FLY_DURATION_SECS = 5;
const WESTERN_SKYCULTURE_ASSET_BASE =
  'https://cdn.jsdelivr.net/npm/@found-in-space/stellarium-skycultures-western@0.3.0/dist/';
const ACTIONS = Object.freeze({
  flySelected: 'free-roam:selection.flyTo',
  lookSun: 'free-roam:sun.lookAt',
  flySun: 'free-roam:sun.flyTo',
  fullscreen: 'free-roam:fullscreen.toggle',
  constellationArt: 'free-roam:constellationArt.toggle',
});
let activeViewer = null;

const initialRenderState = {
  limitingMagnitude: 7.5,
  verticalFovDeg: 60,
  exposure: Math.exp(7.82),
  extinctionScale: 1,
  magFadeRange: 3,
  baseSize: 0.9,
  sizeScale: 3,
  sizePower: 0.32,
  haloScale: 1.5,
  haloPower: 0.22,
};

const elements = {
  page: document.querySelector('.free-roam-app-page'),
  host: document.querySelector('[data-viewer]'),
  status: document.querySelector('[data-status]'),
  summary: document.querySelector('[data-summary]'),
  snapshot: document.querySelector('[data-snapshot]'),
  pickInfo: document.querySelector('[data-pick-info]'),
  pickTolerance: document.querySelector('[data-pick-tolerance]'),
  magLimit: document.querySelector('[data-mag-limit]'),
  fov: document.querySelector('[data-fov-deg]'),
  exposure: document.querySelector('[data-star-exposure]'),
  extinction: document.querySelector('[data-star-extinction-scale]'),
  fadeRange: document.querySelector('[data-star-fade-range]'),
  baseSize: document.querySelector('[data-star-base-size]'),
  sizeScale: document.querySelector('[data-star-size-scale]'),
  sizePower: document.querySelector('[data-star-size-power]'),
  glowScale: document.querySelector('[data-star-glow-scale]'),
  glowPower: document.querySelector('[data-star-glow-power]'),
  flyRa: document.querySelector('[data-fly-ra]'),
  flyDec: document.querySelector('[data-fly-dec]'),
  flyDistance: document.querySelector('[data-fly-distance]'),
  flyCoords: document.querySelector('[data-fly-coords]'),
  flyStatus: document.querySelector('[data-fly-status]'),
  constellationIau: document.querySelector('[data-constellation-iau]'),
  constellationName: document.querySelector('[data-constellation-name]'),
  constellationRa: document.querySelector('[data-constellation-ra]'),
  constellationDec: document.querySelector('[data-constellation-dec]'),
  constellationDesc: document.querySelector('[data-constellation-desc]'),
  constellationTarget: document.querySelector('[data-constellation-target]'),
  constellationLook: document.querySelector('[data-constellation-look]'),
  constellationFly: document.querySelector('[data-constellation-fly]'),
  constellationTargetStatus: document.querySelector('[data-constellation-target-status]'),
  artMaxAngle: document.querySelector('[data-art-max-angle-deg]'),
  hysteresis: document.querySelector('[data-hysteresis-secs]'),
  artFade: document.querySelector('[data-art-fade-secs]'),
  artOpacity: document.querySelector('[data-art-opacity]'),
  lookSun: document.querySelector('[data-look-sun]'),
  flySun: document.querySelector('[data-fly-sun]'),
  artToggle: document.querySelector('[data-art-toggle]'),
  fullscreenToggle: document.querySelector('[data-fullscreen-toggle]'),
  speedReadout: document.querySelector('[data-hud-speed]'),
  distanceReadout: document.querySelector('[data-hud-distance]'),
};

const state = {
  render: { ...initialRenderState },
  pickToleranceDeg: Number(elements.pickTolerance?.value) || 3,
  artVisible: true,
  artMaxAngleDeg: Number(elements.artMaxAngle?.value) || 60,
  artOpacity: Number(elements.artOpacity?.value) || 0.3,
  artFadeSeconds: Number(elements.artFade?.value) || 0.4,
  constellationHysteresisSeconds: Number(elements.hysteresis?.value) || 0.2,
  selected: null,
  selectedIdentifiersStatus: 'idle',
  activeConstellation: null,
  selectedConstellationKey: 'Ori',
  hudSpeed: '0.00 pc/s',
  hudDistanceToSun: '0.00 pc',
  warmState: {
    stars: 'idle',
    meta: 'idle',
    art: 'idle',
  },
};

if (!elements.host) {
  throw new Error('Free roam console requires [data-viewer].');
}

const pickOptions = { toleranceDeg: state.pickToleranceDeg };
const debug = createSkykitDebugBridge();
installSkykitDebugGlobal(debug);

main().catch((error) => {
  setStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
  debug.recordDiagnostic({
    level: 'error',
    type: 'free-roam/startup-error',
    message: 'Alpha free-roam console failed to start.',
    error,
  });
});

async function main() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setClearColor(0x02040b, 1);
  const camera = new THREE.PerspectiveCamera(state.render.verticalFovDeg, 1, 0.0001, 10000);
  const provider = createStarOctreeProviderService({
    url: OCTREE_DEFAULT,
    datasetId: DATASET_ID,
  });
  const metaProvider = createMetaSidecarProviderService({
    url: deriveMetaSidecarUrlFromRenderUrl(OCTREE_DEFAULT),
    parentDatasetId: DATASET_ID,
  });
  const source = createSkykitStarSourcePlugin({
    provider,
    strategy: createObserverShellStrategy(),
    attributes: ['position', 'magAbs', 'teffLog8'],
  });
  const starField = createThreeStarField({
    ...state.render,
    coordinateUnitsPerParsec: WORLD_SCALE,
  });
  const selectedTarget = createSelectedStarTarget();
  const art = await createConstellationArtPlugin();
  populateConstellationTargetSelect(art.catalog);

  const viewer = await createSkykitViewer({
    id: 'free-roam-alpha',
    host: elements.host,
    renderer,
    camera,
    view: {
      observerPc: SOL_PC,
      lookAt: { targetPc: ORION_CENTER_PC },
      limitingMagnitude: state.render.limitingMagnitude,
      verticalFovDeg: state.render.verticalFovDeg,
      coordinateUnitsPerParsec: WORLD_SCALE,
    },
    plugins: [
      source,
      createStreamingStarsPlugin({
        id: 'stars',
        source,
        renderer: starField,
      }),
      createObject3dPlugin({
        id: 'selection-marker',
        object3d: selectedTarget.object3d,
        anchorMode: 'world-space',
        disposeObject: false,
      }),
      art.managerPlugin,
      createSkykitNavigationPlugin({
        speed: 18,
        acceleration: 22,
        deceleration: 18,
      }),
      createKeyboardNavigationPlugin({ speedPcPerSec: 2 }),
      createSkyGrabPlugin({
        target: elements.host,
        sensitivityRadiansPerPixel: 0.00075,
      }),
      createSkykitStarPickingPlugin({
        id: 'star-picker',
        target: elements.host,
        renderer: starField,
        source,
        pickOptions,
        attributes: ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
        onPick(event) {
          void selectPickEvent(event, {
            viewer,
            metaProvider,
            selectedTarget,
            historyMode: 'push',
          });
        },
      }),
      createTouchOsHudPlugin({
        target: elements.host,
        sourcePrefix: 'free-roam:hud',
        root: () => createHudRoot(),
      }),
      createConstellationPanelSyncPlugin({
        art,
        skycultureManifest: art.skycultureManifest,
      }),
    ],
  });
  activeViewer = viewer;

  debug.registerViewer(viewer, {
    id: 'free-roam',
    label: 'Alpha Free Roam',
  });
  registerConsoleActions(viewer, selectedTarget, art);

  const loop = createSkykitAnimationLoop(viewer);
  const cleanupStatus = installStatusLoop(viewer, provider, metaProvider, source, starField);

  bindControls({
    viewer,
    provider,
    source,
    starField,
    camera,
    metaProvider,
    selectedTarget,
    art,
  });

  function resize() {
    const width = elements.host.clientWidth || 1;
    const height = elements.host.clientHeight || 1;
    camera.aspect = width / height;
    camera.fov = state.render.verticalFovDeg;
    camera.updateProjectionMatrix();
    viewer.resize({ width, height, devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
  }

  window.addEventListener('resize', resize);
  document.addEventListener('fullscreenchange', () => {
    resize();
    renderActionControls();
  });
  window.addEventListener('popstate', () => {
    void syncSelectionFromUrl({
      viewer,
      provider,
      metaProvider,
      selectedTarget,
      historyMode: 'none',
    });
  });
  window.addEventListener('beforeunload', () => {
    cleanupStatus();
    loop.dispose();
    selectedTarget.dispose();
    activeViewer = null;
    void viewer.dispose();
    void provider.dispose?.();
    void metaProvider.dispose?.();
  });

  syncInitialReadouts();
  resize();
  loop.start();
  setStatus('running');
  void syncSelectionFromUrl({
    viewer,
    provider,
    metaProvider,
    selectedTarget,
    historyMode: 'none',
  });
}

async function createConstellationArtPlugin() {
  state.warmState.art = 'loading';
  const catalog = await createAnchoredImageCatalog({
    manifest: createWesternSkycultureAnchoredImageManifest({
      baseUrl: WESTERN_SKYCULTURE_ASSET_BASE,
    }),
  });
  const skycultureManifest = westernSkycultureManifest;
  const runtime = {
    catalog,
    skycultureManifest,
    controller: null,
    plugin: null,
    teardown: null,
    context: null,
    rebuilding: Promise.resolve(),
    managerPlugin: {
      id: 'free-roam-constellation-art-manager',
      setup(context) {
        runtime.context = context;
        return runtime.rebuild().then(() => () => runtime.dispose());
      },
      getSnapshot() {
        return runtime.getSnapshot();
      },
    },
    createPlugin() {
      const controller = createViewAnchoredImageController({
        strategy: 'nearest',
        maxAngleDeg: state.artMaxAngleDeg,
        hysteresisSeconds: state.constellationHysteresisSeconds,
      });
      if (!state.artVisible) {
        controller.setSelection?.([]);
      }
      const plugin = createAnchoredImageSkyPlugin({
        id: 'constellation-art',
        catalog,
        controller,
        loading: 'lazy',
        fixedAtInfinity: true,
        radius: 8,
        opacity: state.artOpacity,
        fadeInSeconds: state.artFadeSeconds,
        fadeOutSeconds: state.artFadeSeconds,
        skipTextureErrors: true,
        onTextureError(event) {
          debug.recordDiagnostic({
            level: 'warn',
            type: 'free-roam/constellation-art-texture-error',
            message: `Constellation art texture failed for ${event.entry.label}.`,
            data: { key: event.entry.key, imageUrl: event.imageUrl },
            error: event.error,
          });
        },
      });
      runtime.controller = controller;
      runtime.plugin = plugin;
      return plugin;
    },
    rebuild() {
      if (!runtime.context) return Promise.resolve();
      runtime.rebuilding = runtime.rebuilding.then(rebuildNow, rebuildNow);
      return runtime.rebuilding;
    },
    dispose() {
      const teardown = runtime.teardown;
      runtime.teardown = null;
      teardown?.();
      runtime.controller = null;
      runtime.plugin = null;
    },
    getSnapshot() {
      return {
        catalogCount: catalog.list().length,
        plugin: runtime.plugin?.getSnapshot?.() ?? null,
      };
    },
  };
  state.warmState.art = `ready (${catalog.list().length})`;
  return runtime;

  async function rebuildNow() {
    state.warmState.art = 'rebuilding';
    const teardown = runtime.teardown;
    runtime.teardown = null;
    teardown?.();
    const plugin = runtime.createPlugin();
    const nextTeardown = await plugin.setup(runtime.context);
    runtime.teardown = typeof nextTeardown === 'function' ? nextTeardown : null;
    state.warmState.art = `ready (${catalog.list().length})`;
    renderActionControls();
  }
}

function createHudRoot() {
  return createSkykitShipControlsRoot({
    id: 'free-roam-hud',
    labels: {
      forward: 'F',
      back: 'B',
      left: 'L',
      right: 'R',
      up: 'Up',
      down: 'Down',
    },
  });
}

function registerConsoleActions(viewer, selectedTarget, art) {
  viewer.actions.registerAction(ACTIONS.lookSun, () => {
    return viewer.actions.invoke(SKYKIT_ACTIONS.navigation.transitionTo, {
      lookAt: { targetPc: SOL_PC },
      durationSecs: 1.4,
    }, { source: 'free-roam' });
  }, { label: 'Look at Sun' });

  viewer.actions.registerAction(ACTIONS.flySun, () => {
    flyToTarget(viewer, SOL_PC, { approachPc: 1, durationSecs: 3 });
  }, { label: 'Fly to Sun' });

  viewer.actions.registerAction(ACTIONS.flySelected, () => {
    flyToSelected(viewer);
  }, { label: 'Fly to selected star' });

  viewer.actions.registerAction(ACTIONS.fullscreen, () => {
    const target = elements.host.closest('.viewer-shell') ?? elements.host;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void target.requestFullscreen?.();
    }
  }, { label: 'Toggle fullscreen' });

  viewer.actions.registerAction(ACTIONS.constellationArt, () => {
    state.artVisible = !state.artVisible;
    art.controller?.setSelection?.(state.artVisible ? undefined : []);
    selectedTarget.object3d.visible = Boolean(state.selected?.position);
    renderActionControls();
  }, { label: 'Toggle constellation art' });
}

function bindControls(context) {
  bindSlider(elements.pickTolerance, 'pick-tolerance', (value, input) => {
    state.pickToleranceDeg = positiveNumber(value, state.pickToleranceDeg);
    pickOptions.toleranceDeg = state.pickToleranceDeg;
    input.value = String(state.pickToleranceDeg);
    return `${state.pickToleranceDeg.toFixed(1)} deg`;
  });

  bindSlider(elements.magLimit, 'mag-limit', (value) => {
    state.render.limitingMagnitude = finiteNumber(value, state.render.limitingMagnitude);
    applyRenderState(context);
    return state.render.limitingMagnitude.toFixed(1);
  });

  bindSlider(elements.fov, 'fov', (value) => {
    state.render.verticalFovDeg = positiveNumber(value, state.render.verticalFovDeg);
    context.camera.fov = state.render.verticalFovDeg;
    context.camera.updateProjectionMatrix();
    context.viewer.requestViewState({ verticalFovDeg: state.render.verticalFovDeg }, 'free-roam.fov');
    return `${state.render.verticalFovDeg.toFixed(0)} deg`;
  });

  bindSlider(elements.exposure, 'exposure', (value) => {
    state.render.exposure = Math.exp(finiteNumber(value, Math.log(state.render.exposure)));
    applyRenderState(context);
    return formatExposure(state.render.exposure);
  });
  bindViewSlider(elements.extinction, 'extinction', 'extinctionScale', context, 2);
  bindViewSlider(elements.fadeRange, 'fade-range', 'magFadeRange', context, 1);
  bindViewSlider(elements.baseSize, 'base-size', 'baseSize', context, 2);
  bindViewSlider(elements.sizeScale, 'size-scale', 'sizeScale', context, 2);
  bindViewSlider(elements.sizePower, 'size-power', 'sizePower', context, 2);
  bindViewSlider(elements.glowScale, 'glow-scale', 'haloScale', context, 2);
  bindViewSlider(elements.glowPower, 'glow-power', 'haloPower', context, 2);
  bindArtConfigSlider(elements.artMaxAngle, 'art-max-angle', context, (value, input) => {
    state.artMaxAngleDeg = nonNegativeNumber(value, state.artMaxAngleDeg);
    input.value = String(state.artMaxAngleDeg);
    return `${state.artMaxAngleDeg.toFixed(0)} deg`;
  });
  bindArtConfigSlider(elements.hysteresis, 'hysteresis', context, (value, input) => {
    state.constellationHysteresisSeconds = nonNegativeNumber(value, state.constellationHysteresisSeconds);
    input.value = String(state.constellationHysteresisSeconds);
    return `${state.constellationHysteresisSeconds.toFixed(2)}s`;
  });
  bindArtConfigSlider(elements.artFade, 'art-fade', context, (value, input) => {
    state.artFadeSeconds = nonNegativeNumber(value, state.artFadeSeconds);
    input.value = String(state.artFadeSeconds);
    return `${state.artFadeSeconds.toFixed(2)}s`;
  });
  bindArtConfigSlider(elements.artOpacity, 'art-opacity', context, (value, input) => {
    state.artOpacity = clampNumber(value, 0, 1, state.artOpacity);
    input.value = String(state.artOpacity);
    return state.artOpacity.toFixed(2);
  });
  elements.constellationTarget?.addEventListener('change', () => {
    state.selectedConstellationKey = elements.constellationTarget.value;
    setReadout('constellation-target', state.selectedConstellationKey || '—');
    void lookAtSelectedConstellation(context);
  });
  elements.constellationLook?.addEventListener('click', () => {
    void lookAtSelectedConstellation(context);
  });
  elements.constellationFly?.addEventListener('click', () => {
    void flyTowardSelectedConstellation(context);
  });

  elements.flyCoords?.addEventListener('click', () => {
    try {
      const { targetPc, raDeg, decDeg, distancePc } = icrsTargetFromRaDecDistance(
        elements.flyRa?.value,
        elements.flyDec?.value,
        elements.flyDistance?.value,
      );
      selectCoordinateTarget(context.viewer, context.selectedTarget, targetPc, { historyMode: 'push' });
      flyToTarget(context.viewer, targetPc, { approachPc: 0.25, durationSecs: 3 });
      setFlyStatus(`Flying to RA ${raDeg.toFixed(4)} deg, Dec ${decDeg.toFixed(4)} deg, ${distancePc.toFixed(2)} pc.`);
    } catch (error) {
      setFlyStatus(error instanceof Error ? error.message : String(error));
    }
  });

  for (const input of [elements.flyRa, elements.flyDec, elements.flyDistance]) {
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        elements.flyCoords?.click();
      }
    });
  }

  bindActionButton(elements.lookSun, context.viewer, ACTIONS.lookSun, 'sidebar');
  bindActionButton(elements.flySun, context.viewer, ACTIONS.flySun, 'sidebar');
  bindActionButton(elements.artToggle, context.viewer, ACTIONS.constellationArt, 'sidebar');
  bindActionButton(elements.fullscreenToggle, context.viewer, ACTIONS.fullscreen, 'hud-corner');
  renderActionControls();
}

function bindActionButton(button, viewer, actionId, sourceSuffix) {
  button?.addEventListener('click', () => {
    void viewer.actions.invoke(actionId, undefined, { source: `free-roam:${sourceSuffix}` });
  });
}

function bindViewSlider(input, readout, key, context, decimals) {
  bindSlider(input, readout, (value) => {
    state.render[key] = Math.max(0, finiteNumber(value, state.render[key]));
    applyRenderState(context);
    return state.render[key].toFixed(decimals);
  });
}

function bindArtConfigSlider(input, readout, context, apply) {
  if (!input) return;
  const update = () => {
    const text = apply(Number(input.value), input);
    setReadout(readout, text);
  };
  input.addEventListener('input', update);
  input.addEventListener('change', () => {
    update();
    void rebuildConstellationArt(context);
  });
  update();
}

function bindSlider(input, readout, apply) {
  if (!input) return;
  const update = () => {
    const text = apply(Number(input.value), input);
    setReadout(readout, text);
  };
  input.addEventListener('input', update);
  update();
}

function applyRenderState({ viewer, source, starField }) {
  viewer.requestViewState({
    limitingMagnitude: state.render.limitingMagnitude,
    verticalFovDeg: state.render.verticalFovDeg,
  }, 'free-roam.rendering');
  starField.setView({
    ...state.render,
    coordinateUnitsPerParsec: WORLD_SCALE,
  });
  void source.refreshDemand?.('free-roam.rendering');
}

function populateConstellationTargetSelect(catalog) {
  const select = elements.constellationTarget;
  if (!select) return;
  const entries = catalog.list();
  select.innerHTML = '';
  for (const entry of entries) {
    const option = document.createElement('option');
    option.value = entry.key;
    option.textContent = entry.label;
    select.append(option);
  }
  const defaultKey = catalog.get('Ori')?.key ?? entries[0]?.key ?? '';
  state.selectedConstellationKey = defaultKey;
  select.value = defaultKey;
  select.disabled = entries.length === 0;
  if (elements.constellationLook) elements.constellationLook.disabled = entries.length === 0;
  if (elements.constellationFly) elements.constellationFly.disabled = entries.length === 0;
  setReadout('constellation-target', defaultKey || '—');
  setConstellationTargetStatus(entries.length > 0
    ? 'Choose a constellation to look or fly toward it.'
    : 'No constellation targets loaded.');
}

async function lookAtSelectedConstellation(context) {
  const resolved = resolveSelectedConstellationLook(context);
  if (!resolved) return;
  const { entry, look } = resolved;
  const lookAt = look.orientationIcrs
    ? { orientationIcrs: look.orientationIcrs }
    : { targetPc: look.targetPc };
  setConstellationTargetStatus(`Slewing toward ${entry.label}.`);
  await context.viewer.actions.invoke(SKYKIT_ACTIONS.navigation.transitionTo, {
    lookAt,
    durationSecs: CONSTELLATION_LOOK_DURATION_SECS,
    orientation: { durationSecs: CONSTELLATION_LOOK_DURATION_SECS },
    onArrive() {
      context.viewer.requestViewState({
        targetPc: look.targetPc,
        lookAt,
      }, 'free-roam.constellation.look.arrive');
    },
  }, { source: 'free-roam:constellation-target' });
}

async function flyTowardSelectedConstellation(context) {
  const resolved = resolveSelectedConstellationLook(context);
  if (!resolved) return;
  flyToTarget(context.viewer, resolved.look.targetPc, {
    approachPc: CONSTELLATION_FLY_APPROACH_PC,
    durationSecs: CONSTELLATION_FLY_DURATION_SECS,
  });
  setConstellationTargetStatus(`Flying toward ${resolved.entry.label}.`);
}

function resolveSelectedConstellationLook({ viewer, art }) {
  const key = elements.constellationTarget?.value || state.selectedConstellationKey;
  const entry = key ? art.catalog.get(key) : null;
  if (!entry) {
    setConstellationTargetStatus('Choose a constellation target first.');
    return null;
  }
  const look = art.catalog.resolveLookAt(entry.key, {
    observerPc: viewer.getViewState().observerPc,
    distancePc: CONSTELLATION_TARGET_DISTANCE_PC,
  });
  if (!look) {
    setConstellationTargetStatus(`Could not resolve ${entry.label}.`);
    return null;
  }
  state.selectedConstellationKey = entry.key;
  setReadout('constellation-target', entry.key);
  return { entry, look };
}

async function rebuildConstellationArt({ art }) {
  try {
    await art.rebuild();
  } catch (error) {
    state.warmState.art = 'error';
    debug.recordDiagnostic({
      level: 'error',
      type: 'free-roam/constellation-art-rebuild-error',
      message: 'Constellation art settings could not be applied.',
      error,
    });
  }
}

async function selectPickEvent(event, context) {
  const pick = event.pick;
  const view = context.viewer.getViewState();
  const targetPc = renderPositionToPc(pick.position, view.coordinateUnitsPerParsec);
  const objectRef = pick.objectRef ?? normalizePickMetaRef(pick.pickMeta);
  const bookmarkId = objectRef ? serializeStarRefBookmark({ ...objectRef, datasetId: objectRef.datasetId ?? DATASET_ID }) : null;
  const selection = {
    kind: 'star',
    label: event.label ?? 'Selected star',
    source: 'pick',
    cellKey: pick.cellKey,
    objectIndex: pick.objectIndex,
    position: pick.position,
    targetPc,
    distancePc: pick.distancePc,
    apparentMagnitude: pick.apparentMagnitude,
    magAbs: pick.magAbs,
    teffLog8: pick.teffLog8 ?? null,
    temperatureK: Number.isFinite(Number(pick.teffLog8)) ? decodeTemperatureK(Number(pick.teffLog8)) : null,
    visualRadiusPx: pick.visualRadiusPx,
    score: pick.score,
    angularDistanceDeg: pick.angularDistanceDeg,
    objectRef,
    pickMeta: pick.pickMeta ?? null,
    bookmarkId,
    identifiers: createEmptyIdentifierFields(),
    identifierStatus: 'loading',
    pickTimeMs: event.pickTimeMs ?? null,
  };
  selectResult(selection, context.selectedTarget, { historyMode: 'push' });
  await resolveSelectionIdentifiers(selection, context.metaProvider);
}

function selectResult(selection, selectedTarget, options = {}) {
  state.selected = selection;
  state.selectedIdentifiersStatus = selection?.identifierStatus ?? 'idle';
  if (selection?.position) {
    selectedTarget.setPosition(selection.position);
  } else {
    selectedTarget.clear();
  }
  updateSelectionUrl(selection, options.historyMode ?? 'push');
  renderPickInfo();
}

function selectCoordinateTarget(viewer, selectedTarget, targetPc, options = {}) {
  const view = viewer.getViewState();
  const position = pcToRenderPosition(targetPc, view.coordinateUnitsPerParsec);
  selectResult({
    kind: 'icrs',
    label: 'Coordinate target',
    position,
    targetPc,
    cellKey: null,
    objectIndex: null,
    distancePc: distancePc(view.observerPc, targetPc),
    apparentMagnitude: null,
    magAbs: null,
    teffLog8: null,
    temperatureK: null,
    visualRadiusPx: null,
    score: null,
    angularDistanceDeg: null,
    objectRef: null,
    pickMeta: null,
    bookmarkId: null,
    identifiers: createEmptyIdentifierFields(),
    identifierStatus: 'synthetic',
  }, selectedTarget, options);
}

async function syncSelectionFromUrl({ viewer, provider, metaProvider, selectedTarget, historyMode }) {
  const marker = readSelectionMarkerFromUrl(window.location.href);
  if (!marker) {
    selectResult(null, selectedTarget, { historyMode });
    return;
  }
  if (marker.kind === 'icrs') {
    selectCoordinateTarget(viewer, selectedTarget, marker.icrsPc, { historyMode });
    return;
  }
  const selection = await resolveStarRefSelection(provider, marker.ref, viewer.getViewState());
  if (!selection) {
    selectResult(null, selectedTarget, { historyMode: 'replace' });
    return;
  }
  selection.bookmarkId = marker.bookmarkId;
  selectResult(selection, selectedTarget, { historyMode });
  await resolveSelectionIdentifiers(selection, metaProvider);
}

async function resolveStarRefSelection(provider, ref, view) {
  const cells = [];
  for await (const delta of provider.streamCells({
    strategy: createStarCellRefStrategy(ref),
    view,
    attributes: ['position', 'magAbs', 'teffLog8', 'objectRef', 'pickMeta'],
    coordinates: createSkykitRenderCoordinateOutput(view.coordinateUnitsPerParsec),
  })) {
    if (delta.type === 'stars/cells-upsert') {
      cells.push(...delta.cells);
      const found = findSelectionResultInCells(cells, ref, view);
      if (found) return bookmarkSelectionFromResult(found, ref);
    }
    if (delta.type === 'stars/error') {
      throw new Error(delta.error?.message ?? 'Bookmark stream failed.');
    }
    if (delta.type === 'stars/current') break;
  }
  return null;
}

function bookmarkSelectionFromResult(result, ref) {
  return {
    ...result,
    kind: 'star',
    label: 'Selected star',
    objectIndex: ref.ordinal,
    bookmarkId: serializeStarRefBookmark(ref),
    identifiers: createEmptyIdentifierFields(),
    identifierStatus: 'loading',
    pickTimeMs: null,
  };
}

async function resolveSelectionIdentifiers(selection, metaProvider) {
  if (!selection || !selection.objectRef) {
    renderPickInfo();
    return;
  }
  try {
    const entry = await metaProvider.getMeta(selection.objectRef);
    if (state.selected !== selection) return;
    const identifiers = metaSidecarEntryDisplayFields(entry);
    selection.identifiers = identifiers;
    selection.label = identifiers.primaryLabel || selection.label || 'Selected star';
    selection.identifierStatus = entry ? 'ready' : 'unavailable';
  } catch (error) {
    if (state.selected !== selection) return;
    selection.identifierStatus = 'error';
    debug.recordDiagnostic({
      level: 'warn',
      type: 'free-roam/meta-lookup-error',
      message: 'Selected star metadata could not be loaded.',
      error,
    });
  }
  state.selectedIdentifiersStatus = selection.identifierStatus;
  renderPickInfo();
}

function updateSelectionUrl(selection, historyMode = 'push') {
  if (historyMode === 'none') return;
  let marker = null;
  if (selection?.kind === 'star' && selection.bookmarkId) {
    marker = { kind: 'bookmark', bookmarkId: selection.bookmarkId };
  } else if (selection?.targetPc) {
    marker = { kind: 'icrs', icrsPc: selection.targetPc };
  }
  const nextUrl = writeSelectionMarkerToUrl(marker, window.location.href);
  if (nextUrl === window.location.href) return;
  if (historyMode === 'replace') {
    window.history.replaceState(null, '', nextUrl);
  } else {
    window.history.pushState(null, '', nextUrl);
  }
}

function flyToSelected(viewer) {
  if (!state.selected?.targetPc) return;
  flyToTarget(viewer, state.selected.targetPc, { approachPc: 0.25, durationSecs: 3 });
}

function flyToTarget(viewer, targetPc, options = {}) {
  const view = viewer.getViewState();
  const observerPc = approachTargetFromObserver(
    targetPc,
    view.observerPc,
    options.approachPc ?? 0.25,
  );
  void viewer.actions.invoke(SKYKIT_ACTIONS.navigation.transitionTo, {
    observerPc,
    lookAt: { targetPc },
    movement: { durationSecs: options.durationSecs ?? 3 },
    orientationTransition: { durationSecs: Math.min(options.durationSecs ?? 3, 1.5) },
  }, { source: 'free-roam' });
}

function createConstellationPanelSyncPlugin({ art, skycultureManifest }) {
  return {
    id: 'free-roam-constellation-panel-sync',
    setup(context) {
      context.addPart({
        id: 'free-roam-constellation-panel-sync',
        update() {
          const active = art.plugin?.getActive?.()[0] ?? null;
          const next = active ? describeConstellationMatch(active, skycultureManifest) : null;
          if (JSON.stringify(next) !== JSON.stringify(state.activeConstellation)) {
            state.activeConstellation = next;
            renderConstellationPanel();
          }
        },
        getSnapshot() {
          return {
            active: state.activeConstellation,
            art: art.plugin?.getSnapshot?.() ?? null,
          };
        },
      });
    },
  };
}

function describeConstellationMatch(match, skycultureManifest) {
  const entry = match.entry;
  const metadata = entry.metadata ?? {};
  const skycultureConstellation = findSkycultureConstellation(skycultureManifest, metadata.iau ?? entry.groupId ?? entry.id);
  const commonName = metadata.common_name && typeof metadata.common_name === 'object'
    ? metadata.common_name
    : skycultureConstellation?.common_name && typeof skycultureConstellation.common_name === 'object'
      ? skycultureConstellation.common_name
    : null;
  const raDec = icrsToRaDec(entry.centroidIcrs);
  return {
    iau: String(metadata.iau ?? skycultureConstellation?.iau ?? entry.groupId ?? entry.key ?? 'none'),
    name: resolveSkycultureCommonName(commonName, entry.label),
    raDeg: raDec?.raDeg ?? null,
    decDeg: raDec?.decDeg ?? null,
    description: String(
      skycultureConstellation?.description
        ?? skycultureConstellation?.story
        ?? skycultureConstellation?.summary
        ?? metadata.description
        ?? metadata.story
        ?? metadata.summary
        ?? 'No description provided in this art manifest.',
    ),
  };
}

function findSkycultureConstellation(manifest, key) {
  const needle = String(key ?? '').trim().toLowerCase();
  if (!needle || !Array.isArray(manifest?.constellations)) return null;
  return manifest.constellations.find((constellation) => {
    if (!constellation || typeof constellation !== 'object') return false;
    return [constellation.iau, constellation.id].some((value) =>
      String(value ?? '').trim().toLowerCase() === needle);
  }) ?? null;
}

function renderPickInfo() {
  const root = elements.pickInfo;
  if (!root) return;
  const selected = state.selected;
  const empty = root.querySelector('[data-pick-empty]');
  const detail = root.querySelector('[data-pick-detail]');
  if (!selected) {
    if (empty) empty.hidden = false;
    if (detail) detail.hidden = true;
    return;
  }
  if (empty) empty.hidden = true;
  if (detail) detail.hidden = false;
  const fields = selected.identifiers ?? createEmptyIdentifierFields();
  setPickText('proper', fields.properName || '—');
  setPickText('bayer', fields.bayer || '—');
  setPickText('hd', fields.hd || '—');
  setPickText('hip', fields.hip || '—');
  setPickText('gaia', fields.gaia || '—');
  setPickText('bookmark', selected.bookmarkId || '—');
  setPickObs('icrs', selected.targetPc ? formatIcrs(selected.targetPc, 2) : '—');
  setPickObs('distance', Number.isFinite(selected.distancePc) ? `${formatNumber(selected.distancePc, 2)} pc` : '—');
  setPickObs('absMag', formatNullable(selected.magAbs, 2));
  setPickObs('appMag', formatNullable(selected.apparentMagnitude, 2));
  setPickObs('temp', Number.isFinite(selected.temperatureK) ? `${Math.round(selected.temperatureK).toLocaleString()} K` : '—');
  setPickObs('visualPx', Number.isFinite(selected.visualRadiusPx) ? `${formatNumber(selected.visualRadiusPx, 1)} px` : '—');
  setPickObs('score', Number.isFinite(selected.score) ? formatNumber(selected.score, 3) : '—');
  setPickObs('offset', Number.isFinite(selected.angularDistanceDeg) ? `${formatNumber(selected.angularDistanceDeg, 3)} deg` : '—');
  setPickObs('bufferIndex', Number.isInteger(selected.objectIndex) ? String(selected.objectIndex) : '—');
  const simbad = buildSimbadBasicSearch(fields);
  const simbadEmpty = root.querySelector('[data-pick-simbad-empty]');
  const simbadLink = root.querySelector('[data-pick-simbad-link]');
  if (simbadLink && simbadEmpty) {
    if (simbad) {
      simbadLink.href = simbad.url;
      simbadLink.textContent = `SIMBAD (${simbad.label})`;
      simbadLink.hidden = false;
      simbadEmpty.hidden = true;
    } else {
      simbadLink.removeAttribute('href');
      simbadLink.hidden = true;
      simbadEmpty.hidden = false;
    }
  }
  const timing = root.querySelector('[data-pick-timing]');
  if (timing) {
    timing.hidden = selected.pickTimeMs == null;
    timing.textContent = selected.pickTimeMs == null ? '' : `Pick took ${formatNumber(selected.pickTimeMs, 1)} ms`;
  }
  const flyButton = root.querySelector('[data-pick-action="flyTo"]');
  if (flyButton) {
    flyButton.disabled = !selected.targetPc;
    flyButton.onclick = () => {
      if (activeViewer) {
        void activeViewer.actions.invoke(ACTIONS.flySelected, undefined, { source: 'free-roam:sidebar' });
      }
    };
  }
}

function renderConstellationPanel() {
  const active = state.activeConstellation;
  elements.constellationIau.textContent = active?.iau ?? 'none';
  elements.constellationName.textContent = active?.name ?? 'none';
  elements.constellationRa.textContent = active?.raDeg == null ? '—' : `${active.raDeg.toFixed(2)} deg`;
  elements.constellationDec.textContent = active?.decDeg == null ? '—' : `${active.decDeg.toFixed(2)} deg`;
  elements.constellationDesc.textContent = active?.description ?? 'No active constellation yet.';
}

function renderActionControls() {
  if (elements.artToggle) {
    elements.artToggle.textContent = state.artVisible ? 'Hide art' : 'Show art';
    elements.artToggle.setAttribute('aria-pressed', state.artVisible ? 'true' : 'false');
  }
  if (elements.fullscreenToggle) {
    const active = document.fullscreenElement != null;
    elements.fullscreenToggle.setAttribute('aria-pressed', active ? 'true' : 'false');
    elements.fullscreenToggle.title = active ? 'Exit full screen' : 'Full screen';
    elements.fullscreenToggle.setAttribute('aria-label', active ? 'Exit full screen' : 'Toggle fullscreen');
  }
}

function installStatusLoop(viewer, provider, metaProvider, source, starField) {
  let previousObserver = { ...viewer.getViewState().observerPc };
  let previousTime = performance.now();
  const timer = window.setInterval(() => {
    const view = viewer.getViewState();
    const now = performance.now();
    const dt = Math.max((now - previousTime) / 1000, 1e-6);
    const speed = distancePc(previousObserver, view.observerPc) / dt;
    previousObserver = { ...view.observerPc };
    previousTime = now;
    state.warmState.stars = source.getSnapshot?.().status ?? 'idle';
    state.warmState.meta = metaProvider.getSnapshot?.().ready ? 'ready' : 'idle';
    state.hudSpeed = `${formatNumber(speed, 2)} pc/s`;
    state.hudDistanceToSun = `${formatNumber(distancePc(view.observerPc, SOL_PC), 2)} pc`;
    if (elements.speedReadout) elements.speedReadout.textContent = state.hudSpeed;
    if (elements.distanceReadout) elements.distanceReadout.textContent = state.hudDistanceToSun;
    renderStatus(viewer, provider, metaProvider, source, starField);
  }, 500);
  return () => window.clearInterval(timer);
}

function renderStatus(viewer, provider, metaProvider, source, starField) {
  setStatus(viewer.getSnapshot().disposed ? 'disposed' : 'running');
  const summary = {
    demo: 'free-roam-alpha',
    render: state.render,
    pickToleranceDeg: state.pickToleranceDeg,
    selected: summarizeSelection(state.selected),
    constellation: state.activeConstellation,
    warmState: state.warmState,
    stars: source.getSnapshot?.(),
    starField: starField.getSnapshot?.(),
    meta: metaProvider.getSnapshot?.(),
    provider: provider.getSnapshot?.(),
  };
  if (elements.summary) elements.summary.textContent = JSON.stringify(summary, null, 2);
  if (elements.snapshot) elements.snapshot.textContent = JSON.stringify(viewer.getSnapshot(), null, 2);
}

function summarizeSelection(selection) {
  if (!selection) return null;
  return {
    kind: selection.kind,
    label: selection.label,
    bookmarkId: selection.bookmarkId,
    targetPc: selection.targetPc,
    cellKey: selection.cellKey,
    objectIndex: selection.objectIndex,
    distancePc: selection.distancePc,
    apparentMagnitude: selection.apparentMagnitude,
    score: selection.score,
    angularDistanceDeg: selection.angularDistanceDeg,
    identifierStatus: selection.identifierStatus,
  };
}

function syncInitialReadouts() {
  setReadout('mag-limit', state.render.limitingMagnitude.toFixed(1));
  setReadout('fov', `${state.render.verticalFovDeg.toFixed(0)} deg`);
  setReadout('exposure', formatExposure(state.render.exposure));
  setReadout('extinction', state.render.extinctionScale.toFixed(2));
  setReadout('fade-range', state.render.magFadeRange.toFixed(1));
  setReadout('base-size', state.render.baseSize.toFixed(2));
  setReadout('size-scale', state.render.sizeScale.toFixed(2));
  setReadout('size-power', state.render.sizePower.toFixed(2));
  setReadout('glow-scale', state.render.haloScale.toFixed(2));
  setReadout('glow-power', state.render.haloPower.toFixed(2));
  setReadout('pick-tolerance', `${state.pickToleranceDeg.toFixed(1)} deg`);
  setReadout('art-max-angle', `${state.artMaxAngleDeg.toFixed(0)} deg`);
  setReadout('hysteresis', `${state.constellationHysteresisSeconds.toFixed(2)}s`);
  setReadout('art-fade', `${state.artFadeSeconds.toFixed(2)}s`);
  setReadout('art-opacity', state.artOpacity.toFixed(2));
  setReadout('constellation-target', state.selectedConstellationKey || '—');
  renderPickInfo();
  renderConstellationPanel();
  renderActionControls();
}

function createSelectedStarTarget() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const center = canvas.width / 2;
  context.strokeStyle = 'rgba(255, 216, 132, 0.96)';
  context.lineWidth = 5;
  context.beginPath();
  context.arc(center, center, 34, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(center - 52, center);
  context.lineTo(center - 22, center);
  context.moveTo(center + 22, center);
  context.lineTo(center + 52, center);
  context.moveTo(center, center - 52);
  context.lineTo(center, center - 22);
  context.moveTo(center, center + 22);
  context.lineTo(center, center + 52);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
  });
  const object3d = new THREE.Sprite(material);
  object3d.name = 'free-roam-selected-star-target';
  object3d.visible = false;
  object3d.renderOrder = 10_000;
  object3d.scale.set(0.09, 0.09, 1);

  return {
    object3d,
    setPosition(position) {
      object3d.position.set(position.x, position.y, position.z);
      object3d.visible = true;
    },
    clear() {
      object3d.visible = false;
    },
    dispose() {
      object3d.parent?.remove(object3d);
      material.dispose();
      texture.dispose();
    },
  };
}

function normalizePickMetaRef(pickMeta) {
  if (!pickMeta || typeof pickMeta !== 'object') return null;
  return {
    datasetId: DATASET_ID,
    level: pickMeta.level,
    mortonCode: pickMeta.mortonCode,
    ordinal: pickMeta.ordinal,
  };
}

function renderPositionToPc(position, coordinateUnitsPerParsec) {
  return {
    x: position.x / coordinateUnitsPerParsec,
    y: position.y / coordinateUnitsPerParsec,
    z: position.z / coordinateUnitsPerParsec,
  };
}

function pcToRenderPosition(point, coordinateUnitsPerParsec) {
  return {
    x: point.x * coordinateUnitsPerParsec,
    y: point.y * coordinateUnitsPerParsec,
    z: point.z * coordinateUnitsPerParsec,
  };
}

function createEmptyIdentifierFields() {
  return {
    properName: '',
    bayer: '',
    hd: '',
    hip: '',
    gaia: '',
    primaryLabel: '',
  };
}

function setPickText(name, value) {
  const element = elements.pickInfo?.querySelector(`[data-pick-meta="${name}"]`);
  if (element) element.textContent = value;
}

function setPickObs(name, value) {
  const element = elements.pickInfo?.querySelector(`[data-pick-obs="${name}"]`);
  if (element) element.textContent = value;
}

function setReadout(name, value) {
  const element = document.querySelector(`[data-readout="${name}"]`);
  if (element) element.textContent = value;
}

function setStatus(value) {
  if (elements.status) elements.status.textContent = value;
}

function setFlyStatus(value) {
  if (elements.flyStatus) elements.flyStatus.textContent = value;
}

function setConstellationTargetStatus(value) {
  if (elements.constellationTargetStatus) elements.constellationTargetStatus.textContent = value;
}

function formatIcrs(point, decimals = 1) {
  return `{x:${formatNumber(point.x, decimals)}, y:${formatNumber(point.y, decimals)}, z:${formatNumber(point.z, decimals)}}`;
}

function formatExposure(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(3);
}

function formatNullable(value, decimals = 2) {
  return Number.isFinite(value) ? formatNumber(value, decimals) : '—';
}

function formatNumber(value, decimals = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(decimals) : '—';
}

function finiteNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function distancePc(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function datasetIdFromOctreeUrl(url) {
  try {
    const [, datasetId] = new URL(url).pathname.split('/');
    return datasetId || 'unknown-dataset';
  } catch {
    return 'unknown-dataset';
  }
}
