import * as THREE from 'three';

import {
  SKYKIT_ACTIONS,
  createAnchoredImageCatalog,
  createAnchoredImageSkyPlugin,
  createKeyboardNavigationPlugin,
  createSkyGrabPlugin,
  createSkykitAnimationLoop,
  createSkykitDebugBridge,
  createSkykitNavigationPlugin,
  createSkykitStarSourcePlugin,
  createSkykitViewer,
  createStreamingStarsPlugin,
  createViewAnchoredImageController,
  installSkykitDebugGlobal,
} from '@found-in-space/skykit';
import { createTouchOsPanelPlugin } from '@found-in-space/skykit/touch-os';
import {
  applySkykitXrDepthRange,
  computeSkykitXrDepthRange,
  createSkykitXrControlBindings,
  createSkykitXrNavigationPlugin,
  createSkykitXrObserverRig,
  createSkykitXrRaySource,
  createSkykitXrRig,
  createSkykitXrSessionPlugin,
  createSkykitXrStarPickingPlugin,
} from '@found-in-space/skykit/xr';
import {
  createButton,
  createChoiceGroup,
  createColumn,
  createSlider,
  createTextLabel,
  createToggle,
  createValueReadout,
} from '@found-in-space/touch-os';
import { createXrRayPointerSource } from '@found-in-space/touch-os/hosts/three';
import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import {
  createThreeStarField,
  createVrThreeStarFieldMaterialProfile,
} from '@found-in-space/three-star-field';

const WESTERN_SKYCULTURE_MANIFEST_URL = 'https://unpkg.com/@found-in-space/stellarium-skycultures-western@0.1.0/dist/manifest.json';
const PROXIMA_CENTAURI_PC = { x: -0.47, y: -0.36, z: -1.16 };
const SIRIUS_PC = { x: -0.49, y: 2.48, z: -0.76 };
const BETELGEUSE_PC = { x: 4.2, y: 198.3, z: 25.8 };
const SOL_PC = { x: 0, y: 0, z: 0 };
const ORION_CENTER_PC = { x: 62.775, y: 602.667, z: -12.713 };
const DEFAULT_WORLD_SCALE = 1;
const DEFAULT_LIMITING_MAGNITUDE = 7.5;
const DEFAULT_EXPOSURE_LOG10 = 5;
const DEFAULT_EXPOSURE = 10 ** DEFAULT_EXPOSURE_LOG10;
const XR_CONSTELLATION_RADIUS_PC = 8;
const XR_DEMO_ACTIONS = Object.freeze({
  goSelected: 'xr-demo:selected.go',
  pages: Object.freeze({
    home: 'xr-demo:page.home',
    waypoints: 'xr-demo:page.waypoints',
    selected: 'xr-demo:page.selected',
    rendering: 'xr-demo:page.rendering',
  }),
  waypointPrefix: 'xr-demo:waypoint.',
});
const PAGE_OPTIONS = Object.freeze([
  { value: 'home', label: 'Home' },
  { value: 'waypoints', label: 'Waypoints' },
  { value: 'selected', label: 'Target' },
  { value: 'rendering', label: 'Rendering' },
]);
const WAYPOINTS = Object.freeze([
  { id: 'sol', label: 'Sol', targetPc: { x: 0, y: 0, z: 0 }, approachPc: 2 },
  { id: 'proxima', label: 'Proxima', targetPc: PROXIMA_CENTAURI_PC, approachPc: 1.6 },
  { id: 'sirius', label: 'Sirius', targetPc: SIRIUS_PC, approachPc: 1.6 },
  { id: 'betelgeuse', label: 'Betelgeuse', targetPc: BETELGEUSE_PC, approachPc: 8 },
]);

const debug = createSkykitDebugBridge();
installSkykitDebugGlobal(debug);

main().catch((error) => {
  debug.recordDiagnostic({
    level: 'error',
    type: 'xr-free-roam/startup-error',
    message: 'XR free-roam demo failed to start.',
    error,
  });
});

async function main() {
  const host = document.querySelector('[data-viewer]');
  if (!host) {
    throw new Error('XR free-roam demo requires [data-viewer].');
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setClearColor(0x020712, 1);
  renderer.xr.enabled = true;

  const camera = new THREE.PerspectiveCamera(60, 1, 0.02, 2000000);
  const initialOrientation = orientationLookingAt(SOL_PC, ORION_CENTER_PC);
  const xrRig = createSkykitXrRig({
    navigationPose: {
      position: SOL_PC,
      orientation: initialOrientation,
    },
    scaleBandIds: ['constellation-art'],
  });
  const shipDeck = createShipDeckSlab();
  shipDeck.visible = false;
  xrRig.deckRoot.add(shipDeck);

  const provider = createStarOctreeProviderService({ url: OCTREE_DEFAULT });
  const source = createSkykitStarSourcePlugin({ provider });
  const starField = createThreeStarField({
    limitingMagnitude: DEFAULT_LIMITING_MAGNITUDE,
    coordinateUnitsPerParsec: DEFAULT_WORLD_SCALE,
    exposure: DEFAULT_EXPOSURE,
    materialProfile: createVrThreeStarFieldMaterialProfile({
      limitingMagnitude: DEFAULT_LIMITING_MAGNITUDE,
      coordinateUnitsPerParsec: DEFAULT_WORLD_SCALE,
      exposure: DEFAULT_EXPOSURE,
    }),
  });
  const selectedTarget = createSelectedStarTarget();
  starField.object3d.add(selectedTarget.object3d);
  const rightRaySource = createWorldXrRaySource(
    createSkykitXrRaySource({ kind: 'target-ray', handedness: 'right', length: 2000000 }),
    xrRig.xrOrigin,
  );
  const touchPointerSource = createRightHandTouchPointerSource(rightRaySource);
  const panelState = {
    page: 'home',
    limitingMagnitude: DEFAULT_LIMITING_MAGNITUDE,
    exposureLog10: DEFAULT_EXPOSURE_LOG10,
    worldScaleLog10: Math.log10(DEFAULT_WORLD_SCALE),
    nearFloor: true,
    constellationArt: true,
    selected: null,
  };
  let panelRevision = 0;
  let cachedPanelRevision = -1;
  let cachedPanelRoot = null;
  let latestPanelFrame = null;
  let activeXrHandle = null;
  let artController = null;
  let preflightController = null;

  const artPlugin = await createConstellationArtPlugin().catch((error) => {
    debug.recordDiagnostic({
      level: 'warn',
      type: 'xr-free-roam/constellation-art-error',
      message: 'Constellation art could not be loaded.',
      error,
    });
    return null;
  });

  const touchPanel = createTouchOsPanelPlugin({
    id: 'xr-free-roam-touch-panel',
    priority: 20,
    driver: 'pose-anchored',
    root: createPanelRoot,
    surfaceMetrics: { width: 392, height: 430, pixelDensity: 1 },
    pointerSources: [touchPointerSource],
    anchorPose(frame) {
      latestPanelFrame = frame;
      return resolveLeftHandPanelPose(frame, xrRig.xrOrigin);
    },
    driverOptions: {
      panelWidth: 0.34,
      panelHeight: 0.42,
      offset: { x: 0.04, y: 0.02, z: -0.08 },
      tiltRadians: -0.22,
      transparent: true,
      depthTest: false,
      renderOrder: 50,
    },
    onOutput(output) {
      handlePanelOutput(output);
    },
  });

  const viewer = await createSkykitViewer({
    id: 'xr-free-roam-alpha',
    host,
    renderer,
    camera,
    cameraRoot: xrRig.headRoot,
    observerRig: createSkykitXrObserverRig({
      rig: xrRig,
      coordinateUnitsPerParsec: DEFAULT_WORLD_SCALE,
    }),
    roots: {
      originContentRoot: xrRig.originContentRoot,
      observerContentRoot: xrRig.observerContentRoot,
      navigationRoot: xrRig.navigationRoot,
      scaleBandedContentRoots: new Map(Object.entries(xrRig.scaleBandedContentRoots)),
    },
    view: {
      observerPc: SOL_PC,
      targetPc: ORION_CENTER_PC,
      limitingMagnitude: DEFAULT_LIMITING_MAGNITUDE,
      coordinateUnitsPerParsec: DEFAULT_WORLD_SCALE,
      orientationIcrs: initialOrientation,
    },
    plugins: [
      createSkykitXrSessionPlugin({
        renderer,
        referenceSpaceType: 'local-floor',
        onSessionStarted(handle) {
          activeXrHandle = handle;
          shipDeck.visible = true;
          preflightController?.setSessionStatus('XR session active');
          preflightController?.sync();
          invalidatePanel();
          updateXrDepthRange(handle);
        },
      }),
      createSkykitNavigationPlugin(),
      source,
      createStreamingStarsPlugin({ id: 'xr-stars', source, renderer: starField }),
      ...(artPlugin ? [artPlugin] : []),
      createKeyboardNavigationPlugin({ speedPcPerSec: 2, rotationSpeedDegPerSec: 55 }),
      createSkyGrabPlugin({ target: host, sensitivityRadiansPerPixel: 0.0007 }),
      touchPanel,
      createSkykitXrNavigationPlugin({ moveSpeedPcPerSec: 4 }),
      createSkykitXrStarPickingPlugin({
        renderer: starField,
        source,
        raySource: rightRaySource,
        blockers: [touchPanel],
        onPick(event) {
          panelState.selected = {
            label: event.label,
            position: { ...event.pick.position },
            targetPc: renderPositionToPc(event.pick.position, viewer.getViewState().coordinateUnitsPerParsec),
          };
          selectedTarget.setPosition(event.pick.position);
          invalidatePanel();
        },
      }),
    ],
  });
  const loop = createSkykitAnimationLoop(viewer, { scheduler: 'renderer' });

  debug.registerViewer(viewer, {
    id: 'xr-free-roam-alpha',
    label: 'XR Free Roam Alpha',
  });
  viewer.on('xr/session-end', () => {
    activeXrHandle = null;
    shipDeck.visible = false;
    preflightController?.setSessionStatus('Session ended');
    preflightController?.sync();
    invalidatePanel();
  });

  registerDemoActions(viewer);
  applyRenderState(viewer, starField, source);
  preflightController = createPreflightController({
    viewer,
    panelState,
    starField,
    source,
    applyRenderState,
    invalidatePanel,
    setConstellationArtEnabled,
    isPresenting: () => activeXrHandle?.presenting === true,
  });
  preflightController.sync();
  void preflightController.refreshXrSupport();
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', () => {
    loop.dispose();
    selectedTarget.dispose();
    void viewer.dispose();
    void provider.dispose?.();
  });
  loop.start();

  function resize() {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    viewer.resize({
      width,
      height,
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    });
  }

  async function createConstellationArtPlugin() {
    const catalog = await createAnchoredImageCatalog({ manifestUrl: WESTERN_SKYCULTURE_MANIFEST_URL });
    artController = createViewAnchoredImageController({
      strategy: 'nearest',
      maxAngleDeg: 32,
      hysteresisSeconds: 0.25,
    });
    return createAnchoredImageSkyPlugin({
      id: 'xr-constellation-art',
      catalog,
      controller: artController,
      loading: 'lazy',
      fixedAtInfinity: true,
      radius: XR_CONSTELLATION_RADIUS_PC * DEFAULT_WORLD_SCALE,
      opacity: 0.38,
      fadeInSeconds: 0.25,
      fadeOutSeconds: 0.25,
      scaleBandId: 'constellation-art',
      skipTextureErrors: true,
    });
  }

  function createPanelRoot() {
    if (cachedPanelRoot && cachedPanelRevision === panelRevision) return cachedPanelRoot;
    cachedPanelRevision = panelRevision;
    cachedPanelRoot = createColumn('xr-free-roam-panel', {
      gap: 8,
      padding: 10,
      backgroundColor: 'rgba(4, 12, 23, 0.82)',
      children: [
        createChoiceGroup('xr-panel-page', {
          field: 'xrPage',
          selectionMode: 'single',
          value: panelState.page,
          orientation: 'horizontal',
          options: PAGE_OPTIONS,
        }),
        ...createPanelPageChildren(),
      ],
    });
    return cachedPanelRoot;
  }

  function createPanelPageChildren() {
    if (panelState.page === 'waypoints') {
      return WAYPOINTS.map((waypoint) => createButton(`xr-waypoint-${waypoint.id}`, {
        label: waypoint.label,
        actionId: `${XR_DEMO_ACTIONS.waypointPrefix}${waypoint.id}`,
      }));
    }
    if (panelState.page === 'rendering') {
      return [
        createSlider('xr-mag-limit', {
          label: 'Magnitude',
          field: 'limitingMagnitude',
          value: panelState.limitingMagnitude,
          min: 4,
          max: 10,
          step: 0.1,
          valueText: panelState.limitingMagnitude.toFixed(1),
        }),
        createSlider('xr-exposure', {
          label: 'Exposure',
          field: 'exposureLog10',
          value: panelState.exposureLog10,
          min: 3.5,
          max: 5.5,
          step: 0.05,
          valueText: `${Math.round(10 ** panelState.exposureLog10).toLocaleString()}`,
        }),
        createSlider('xr-world-scale', {
          label: 'World scale',
          field: 'worldScaleLog10',
          value: panelState.worldScaleLog10,
          min: -3,
          max: 0,
          step: 0.05,
          valueText: formatWorldScale(10 ** panelState.worldScaleLog10),
        }),
        createToggle('xr-near-floor', {
          label: 'Near floor',
          field: 'nearFloor',
          value: panelState.nearFloor,
        }),
        createToggle('xr-constellation-art', {
          label: 'Constellation art',
          field: 'constellationArt',
          value: panelState.constellationArt,
        }),
      ];
    }
    if (panelState.page === 'selected') {
      return [
        createValueReadout('xr-selected-name', {
          label: 'Target',
          value: panelState.selected?.label ?? 'None',
        }),
        createButton('xr-go-selected', {
          label: 'Go to selected',
          actionId: XR_DEMO_ACTIONS.goSelected,
          disabled: !panelState.selected,
        }),
      ];
    }
    return [
      createValueReadout('xr-home-target', {
        label: 'Target',
        value: panelState.selected?.label ?? 'None',
      }),
      createButton('xr-home-waypoints', {
        label: 'Waypoints',
        actionId: XR_DEMO_ACTIONS.pages.waypoints,
      }),
      createButton('xr-home-selected', {
        label: 'Selected Target',
        actionId: XR_DEMO_ACTIONS.pages.selected,
        disabled: !panelState.selected,
      }),
      createButton('xr-home-rendering', {
        label: 'Rendering',
        actionId: XR_DEMO_ACTIONS.pages.rendering,
      }),
      createTextLabel('xr-home-mode', {
        text: activeXrHandle?.presenting ? 'XR active' : 'Desktop',
        tone: 'muted',
      }),
    ];
  }

  function handlePanelOutput(output) {
    if (!output || output.type !== 'change-request') return;
    if (output.field === 'xrPage' && typeof output.value === 'string') {
      panelState.page = output.value;
      invalidatePanel();
      return;
    }
    if (output.field === 'limitingMagnitude') {
      panelState.limitingMagnitude = clampNumber(output.value, 4, 10, panelState.limitingMagnitude);
      applyRenderState(viewer, starField, source);
      invalidatePanel();
      return;
    }
    if (output.field === 'exposureLog10') {
      panelState.exposureLog10 = clampNumber(output.value, 3.5, 5.5, panelState.exposureLog10);
      applyRenderState(viewer, starField, source);
      invalidatePanel();
      return;
    }
    if (output.field === 'worldScaleLog10') {
      panelState.worldScaleLog10 = clampNumber(output.value, -3, 0, panelState.worldScaleLog10);
      applyRenderState(viewer, starField, source);
      invalidatePanel();
      return;
    }
    if (output.field === 'nearFloor') {
      panelState.nearFloor = output.value === true;
      applyRenderState(viewer, starField, source);
      invalidatePanel();
      return;
    }
    if (output.field === 'constellationArt') {
      setConstellationArtEnabled(output.value === true);
      invalidatePanel();
    }
  }

  function setConstellationArtEnabled(enabled) {
    panelState.constellationArt = enabled;
    artController?.setSelection?.(enabled ? undefined : () => false);
  }

  function applyRenderState(activeViewer, activeStarField, activeSource) {
    const worldScale = 10 ** panelState.worldScaleLog10;
    const exposure = 10 ** panelState.exposureLog10;
    activeViewer.requestViewState({
      limitingMagnitude: panelState.limitingMagnitude,
      coordinateUnitsPerParsec: worldScale,
    }, 'xr-free-roam.rendering');
    activeStarField.setView({
      limitingMagnitude: panelState.limitingMagnitude,
      coordinateUnitsPerParsec: worldScale,
      exposure,
      nearMagLimitFloor: panelState.nearFloor ? 25 : panelState.limitingMagnitude,
      nearMagLimitRadiusPc: panelState.nearFloor ? 1 : 0,
      nearSizeFloor: panelState.nearFloor ? 8 : 0,
      nearAlphaFloor: panelState.nearFloor ? 0.35 : 0,
    });
    void activeSource.refreshDemand?.('xr-free-roam.rendering');
    updateXrDepthRange(activeXrHandle);
  }

  function registerDemoActions(activeViewer) {
    activeViewer.actions.registerAction(XR_DEMO_ACTIONS.pages.home, () => setPanelPage('home'), { label: 'Panel home' });
    activeViewer.actions.registerAction(XR_DEMO_ACTIONS.pages.waypoints, () => setPanelPage('waypoints'), { label: 'Panel waypoints' });
    activeViewer.actions.registerAction(XR_DEMO_ACTIONS.pages.selected, () => setPanelPage('selected'), { label: 'Panel selected target' });
    activeViewer.actions.registerAction(XR_DEMO_ACTIONS.pages.rendering, () => setPanelPage('rendering'), { label: 'Panel rendering' });
    activeViewer.actions.registerAction(XR_DEMO_ACTIONS.goSelected, () => {
      if (panelState.selected) {
        goToTarget(activeViewer, panelState.selected.targetPc, 0.65);
      }
    }, { label: 'Go to selected star' });
    for (const waypoint of WAYPOINTS) {
      activeViewer.actions.registerAction(`${XR_DEMO_ACTIONS.waypointPrefix}${waypoint.id}`, () => {
        goToTarget(activeViewer, waypoint.targetPc, waypoint.approachPc);
      }, { label: waypoint.label });
    }
  }

  function setPanelPage(page) {
    panelState.page = page;
    invalidatePanel();
  }

  function goToTarget(activeViewer, targetPc, approachPc) {
    const current = activeViewer.getViewState();
    const observerPc = approachTargetFromObserver(targetPc, current.observerPc, approachPc);
    void activeViewer.actions.invoke(SKYKIT_ACTIONS.navigation.transitionTo, {
      view: {
        observerPc,
        targetPc,
        orientationIcrs: orientationLookingAt(observerPc, targetPc),
      },
      durationSecs: 2.4,
      movement: 'smoothstep',
      orientation: 'smoothstep',
    }, { source: 'xr-free-roam-demo' });
  }

  function updateXrDepthRange(handle) {
    if (!handle) return;
    const worldScale = 10 ** panelState.worldScaleLog10;
    const range = computeSkykitXrDepthRange({
      observerCentricSpheres: [
        { radiusNavigationUnits: Math.max(500, XR_CONSTELLATION_RADIUS_PC * 2) },
      ],
      scale: {
        navigationUnits: 'pc',
        metersPerNavigationUnit: worldScale,
        worldUnitsPerNavigationUnit: worldScale,
      },
      policy: {
        near: 0.03,
        minFar: 100,
        maxFar: 2000000,
        marginFactor: 1.2,
      },
    });
    camera.near = range.near;
    camera.far = range.far;
    camera.updateProjectionMatrix();
    applySkykitXrDepthRange(handle, range);
  }

  function invalidatePanel() {
    panelRevision += 1;
  }

  function getLatestPanelFrame() {
    return latestPanelFrame;
  }

  touchPointerSource.getLatestPanelFrame = getLatestPanelFrame;
}

function createPreflightController(options) {
  const shell = document.querySelector('.xr-free-roam-shell');
  const enterButton = document.querySelector('[data-action="enter-xr"]');
  const exitButton = document.querySelector('[data-action="exit-xr"]');
  const supportValue = document.querySelector('[data-xr-supported]');
  const sessionStatus = document.querySelector('[data-session-status]');
  const settingInputs = Array.from(document.querySelectorAll('[data-setting]'))
    .filter((input) => input instanceof HTMLInputElement);
  let xrSupported = null;

  for (const input of settingInputs) {
    input.addEventListener('input', () => {
      readSettingInput(input, options.panelState, options.setConstellationArtEnabled);
      syncSettingOutputs(options.panelState);
    });
    input.addEventListener('change', () => {
      readSettingInput(input, options.panelState, options.setConstellationArtEnabled);
      options.applyRenderState(options.viewer, options.starField, options.source);
      options.invalidatePanel();
      sync();
    });
  }

  enterButton?.addEventListener('click', async () => {
    setSessionStatus('Opening XR session');
    sync();
    const results = await options.viewer.actions.invoke(SKYKIT_ACTIONS.xr.enter, null, {
      source: 'xr-free-roam-dom',
    });
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected) {
      const reason = rejected.reason instanceof Error ? rejected.reason.message : String(rejected.reason);
      setSessionStatus(reason || 'XR session failed');
    } else {
      setSessionStatus('XR session requested');
    }
    sync();
  });

  exitButton?.addEventListener('click', async () => {
    setSessionStatus('Ending XR session');
    await options.viewer.actions.invoke(SKYKIT_ACTIONS.xr.exit, null, {
      source: 'xr-free-roam-dom',
    });
    sync();
  });

  return {
    sync,
    setSessionStatus,
    refreshXrSupport,
  };

  function sync() {
    const presenting = options.isPresenting();
    shell?.classList.toggle('is-presenting', presenting);
    if (enterButton instanceof HTMLButtonElement) {
      enterButton.hidden = presenting;
      enterButton.disabled = xrSupported === false || presenting;
    }
    if (exitButton instanceof HTMLButtonElement) {
      exitButton.hidden = !presenting;
      exitButton.disabled = !presenting;
    }
    syncSettingInputs(options.panelState, settingInputs);
    syncSettingOutputs(options.panelState);
  }

  function setSessionStatus(text) {
    if (sessionStatus) {
      sessionStatus.textContent = text;
    }
  }

  async function refreshXrSupport() {
    try {
      xrSupported = await globalThis.navigator?.xr?.isSessionSupported?.('immersive-vr') ?? false;
    } catch {
      xrSupported = false;
    }
    if (supportValue) {
      supportValue.textContent = xrSupported ? 'Available' : 'Unavailable';
    }
    sync();
    return xrSupported;
  }
}

function readSettingInput(input, panelState, setConstellationArtEnabled) {
  const field = input.dataset.setting;
  if (field === 'limitingMagnitude') {
    panelState.limitingMagnitude = clampNumber(input.value, 4, 10, panelState.limitingMagnitude);
  } else if (field === 'exposureLog10') {
    panelState.exposureLog10 = clampNumber(input.value, 3.5, 5.5, panelState.exposureLog10);
  } else if (field === 'worldScaleLog10') {
    panelState.worldScaleLog10 = clampNumber(input.value, -3, 0, panelState.worldScaleLog10);
  } else if (field === 'nearFloor') {
    panelState.nearFloor = input.checked;
  } else if (field === 'constellationArt') {
    setConstellationArtEnabled(input.checked);
  }
}

function syncSettingInputs(panelState, inputs) {
  for (const input of inputs) {
    const field = input.dataset.setting;
    if (field === 'limitingMagnitude') {
      input.value = String(panelState.limitingMagnitude);
    } else if (field === 'exposureLog10') {
      input.value = String(panelState.exposureLog10);
    } else if (field === 'worldScaleLog10') {
      input.value = String(panelState.worldScaleLog10);
    } else if (field === 'nearFloor') {
      input.checked = panelState.nearFloor;
    } else if (field === 'constellationArt') {
      input.checked = panelState.constellationArt;
    }
  }
}

function syncSettingOutputs(panelState) {
  for (const output of document.querySelectorAll('[data-setting-value]')) {
    const field = output.dataset.settingValue;
    if (field === 'limitingMagnitude') {
      output.textContent = `Mag ${panelState.limitingMagnitude.toFixed(1)}`;
    } else if (field === 'exposureLog10') {
      output.textContent = Math.round(10 ** panelState.exposureLog10).toLocaleString();
    } else if (field === 'worldScaleLog10') {
      output.textContent = formatWorldScale(10 ** panelState.worldScaleLog10);
    }
  }
}

function formatWorldScale(value) {
  return `${value.toLocaleString('en-US', { maximumSignificantDigits: 3 })} m/pc`;
}

function createRightHandTouchPointerSource(raySource) {
  const controls = createSkykitXrControlBindings({
    buttons: {
      select: { hand: 'right', button: 'trigger' },
    },
  });
  const pointerSource = createXrRayPointerSource(() => {
    const skykitFrame = pointerSource.getLatestPanelFrame?.();
    const xr = skykitFrame?.xr;
    if (xr?.presenting !== true || !xr.session) return undefined;
    const inputSources = xr.session && typeof xr.session === 'object'
      ? xr.session.inputSources ?? []
      : [];
    controls.update({ inputSources });
    const ray = raySource.getRay({
      frame: xr.frame,
      referenceSpace: xr.referenceSpace,
      session: xr.session,
      inputSources,
    });
    if (!ray) return undefined;

    const select = controls.getButton('select');
    const phase = select.pressedEdge ? 'down' : select.releasedEdge ? 'up' : 'move';
    return {
      pointerId: 'right-trigger',
      pointerType: 'xr',
      handedness: 'right',
      phase,
      timestamp: skykitFrame.elapsedSeconds * 1000,
      sourceId: 'right-controller',
      pressure: select.value,
      origin: ray.origin,
      direction: ray.direction,
    };
  });
  pointerSource.getLatestPanelFrame = () => null;
  return pointerSource;
}

function createWorldXrRaySource(source, transformRoot) {
  return {
    id: `${source.id}:world`,
    getRay(context) {
      const ray = source.getRay(context);
      if (!ray) return null;
      transformRoot.updateMatrixWorld(true);
      const origin = new THREE.Vector3(ray.origin.x, ray.origin.y, ray.origin.z)
        .applyMatrix4(transformRoot.matrixWorld);
      const rootQuaternion = transformRoot.getWorldQuaternion(new THREE.Quaternion());
      const direction = new THREE.Vector3(ray.direction.x, ray.direction.y, ray.direction.z)
        .applyQuaternion(rootQuaternion)
        .normalize();
      return {
        ...ray,
        origin: { x: origin.x, y: origin.y, z: origin.z },
        direction: { x: direction.x, y: direction.y, z: direction.z },
      };
    },
    getSnapshot() {
      return source.getSnapshot?.() ?? { id: `${source.id}:world` };
    },
    dispose() {
      source.dispose?.();
    },
  };
}

function resolveLeftHandPanelPose(frame, transformRoot) {
  const gripPose = resolveInputPose(frame, 'left', 'gripSpace');
  if (!gripPose) return undefined;
  return transformPoseByObject(gripPose, transformRoot);
}

function resolveInputPose(frame, handedness, spaceKey) {
  const xr = frame.xr;
  const xrFrame = xr?.frame;
  const referenceSpace = xr?.referenceSpace;
  const inputSources = xr?.session && typeof xr.session === 'object'
    ? xr.session.inputSources ?? []
    : [];
  if (!xrFrame || !referenceSpace || typeof xrFrame.getPose !== 'function') return null;
  for (const inputSource of inputSources) {
    if (inputSource?.handedness !== handedness || !inputSource[spaceKey]) continue;
    const pose = xrFrame.getPose(inputSource[spaceKey], referenceSpace);
    const transform = pose?.transform;
    if (!transform) continue;
    return {
      position: {
        x: Number(transform.position?.x ?? 0),
        y: Number(transform.position?.y ?? 0),
        z: Number(transform.position?.z ?? 0),
      },
      orientation: {
        x: Number(transform.orientation?.x ?? 0),
        y: Number(transform.orientation?.y ?? 0),
        z: Number(transform.orientation?.z ?? 0),
        w: Number(transform.orientation?.w ?? 1),
      },
    };
  }
  return null;
}

function transformPoseByObject(pose, object) {
  object.updateMatrixWorld(true);
  const position = new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z)
    .applyMatrix4(object.matrixWorld);
  const objectQuaternion = object.getWorldQuaternion(new THREE.Quaternion());
  const orientation = new THREE.Quaternion(
    pose.orientation.x,
    pose.orientation.y,
    pose.orientation.z,
    pose.orientation.w,
  ).premultiply(objectQuaternion).normalize();
  return {
    position: { x: position.x, y: position.y, z: position.z },
    orientation: { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w },
  };
}

function createSelectedStarTarget() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const center = canvas.width / 2;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(255, 218, 136, 0.98)';
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
  object3d.name = 'xr-selected-star-target';
  object3d.visible = false;
  object3d.renderOrder = 10_000;
  object3d.scale.set(0.085, 0.085, 1);

  return {
    object3d,
    setPosition(position) {
      object3d.position.set(position.x, position.y, position.z);
      object3d.visible = true;
    },
    dispose() {
      object3d.parent?.remove(object3d);
      material.dispose();
      texture.dispose();
    },
  };
}

function createShipDeckSlab() {
  const root = new THREE.Group();
  root.name = 'xr-ship-deck';
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.025, 1.45),
    new THREE.MeshBasicMaterial({
      color: 0x1f8f90,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );
  base.position.set(0, -0.015, -0.08);
  root.add(base);
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.03, 0.34),
    new THREE.MeshBasicMaterial({
      color: 0xb5fff2,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    }),
  );
  nose.position.set(0, -0.012, -0.7);
  root.add(nose);
  return root;
}

function approachTargetFromObserver(targetPc, observerPc, distancePc) {
  const direction = new THREE.Vector3(
    observerPc.x - targetPc.x,
    observerPc.y - targetPc.y,
    observerPc.z - targetPc.z,
  );
  if (direction.lengthSq() < 1e-8) {
    direction.set(0, 0, 1);
  }
  direction.normalize();
  return {
    x: targetPc.x + direction.x * distancePc,
    y: targetPc.y + direction.y * distancePc,
    z: targetPc.z + direction.z * distancePc,
  };
}

function orientationLookingAt(observerPc, targetPc) {
  const direction = new THREE.Vector3(
    targetPc.x - observerPc.x,
    targetPc.y - observerPc.y,
    targetPc.z - observerPc.z,
  );
  if (direction.lengthSq() < 1e-8) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  direction.normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

function renderPositionToPc(position, coordinateUnitsPerParsec) {
  const scale = Number.isFinite(coordinateUnitsPerParsec) && coordinateUnitsPerParsec > 0
    ? coordinateUnitsPerParsec
    : 1;
  return {
    x: position.x / scale,
    y: position.y / scale,
    z: position.z / scale,
  };
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}
