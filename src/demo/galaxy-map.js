import * as THREE from 'three';
import {
  createButton,
  createColumn,
  createDPad,
  createDockLayout,
  createHoldButton,
  createRuntime,
  createSection,
  createSlider,
  createTextLabel,
  createValueReadout,
} from '@found-in-space/touch-os';
import {
  createHudPanelDriver,
  createScenePanelDriver,
} from '@found-in-space/touch-os/hosts/three';
import {
  createCameraRigController,
  createDefaultStarFieldMaterialProfile,
  createFoundInSpaceDatasetOptions,
  createObserverShellField,
  createPickController,
  createSelectionRefreshController,
  createStarFieldLayer,
  createViewer,
  DEFAULT_STAR_FIELD_STATE,
  DEFAULT_PICK_TOLERANCE_DEG,
  formatDistancePc,
  getDatasetSession,
  ORION_CENTER_PC,
  resolveFoundInSpaceDatasetOverrides,
  createSceneOrientationTransforms,
  SCALE,
  SOLAR_ORIGIN_PC,
} from '../index.js';
import { formatSpeedPcPerSec } from '../presets/navigation-presets.js';
import {
  buildGalaxyMapValue,
  createGalaxyMapControl,
  deriveGalaxyMapScaleHint,
} from '../ui/galaxy-map-control.js';
import { createTouchOsRuntimePart } from './touch-os-runtime-part.js';
import {
  createTouchOsFullscreenButton,
  handleNavigationTouchOsOutput,
} from './touch-os-navigation.js';
import { installDemoViewerDebugConsole } from './viewer-debug-console.js';

const PROXIMA_CEN_PC = { x: -0.47, y: -0.36, z: -1.16 };
const SIRIUS_PC = { x: -0.49, y: 2.48, z: -0.76 };
const BETELGEUSE_PC = { x: 4.2, y: 198.3, z: 25.8 };
const GALAXY_MAP_CONTROL_ID = 'galaxy-map';

const {
  icrsToScene: ORION_SCENE_TRANSFORM,
  sceneToIcrs: ORION_SCENE_TO_ICRS_TRANSFORM,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

const WAYPOINTS = [
  { action: 'fly-sol', label: 'Sol', targetPc: SOLAR_ORIGIN_PC },
  { action: 'fly-proxima', label: 'Proxima Centauri', targetPc: PROXIMA_CEN_PC },
  { action: 'fly-sirius', label: 'Sirius', targetPc: SIRIUS_PC },
  { action: 'fly-betelgeuse', label: 'Betelgeuse', targetPc: BETELGEUSE_PC },
];

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function fmt(value, decimals = 2) {
  return Number.isFinite(value) ? value.toFixed(decimals) : '-';
}

function sceneToIcrsPc(pos) {
  const [ix, iy, iz] = ORION_SCENE_TO_ICRS_TRANSFORM(pos.x, pos.y, pos.z);
  return { x: ix / SCALE, y: iy / SCALE, z: iz / SCALE };
}

function approachTargetFromObserver(targetPc, observerPc, distancePc) {
  const dx = targetPc.x - observerPc.x;
  const dy = targetPc.y - observerPc.y;
  const dz = targetPc.z - observerPc.z;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > distancePc)) {
    return clonePoint(observerPc);
  }
  const factor = distancePc / len;
  return {
    x: targetPc.x - dx * factor,
    y: targetPc.y - dy * factor,
    z: targetPc.z - dz * factor,
  };
}

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

const mount = document.querySelector('[data-skykit-viewer-root]');

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'desktop-galaxy-map-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'desktop-galaxy-map',
  },
}));

let viewer = null;
let cameraController = null;
let starFieldLayer = null;
let pickControllerRef = null;
let touchOsPartRef = null;
let lastPickedResult = null;
let pickGeneration = 0;
let currentTabletPage = 'home';
let activeMagLimit = 7.5;
let activeTolerance = DEFAULT_PICK_TOLERANCE_DEG;
let activeFlySpeed = 180;
let activeExposure = DEFAULT_STAR_FIELD_STATE.starFieldExposure;
let galaxyMapScaleHint = null;

const HUD_SURFACE = Object.freeze({
  width: 1280,
  height: 720,
  pixelDensity: 1,
  safeArea: { top: 18, right: 18, bottom: 18, left: 18 },
});

const HUD_THEME = Object.freeze({
  backgroundColor: '#08111d',
  surfaceColor: '#132238',
  borderColor: '#27405e',
  accentColor: '#38bdf8',
  focusColor: '#22c55e',
  controlHeight: 42,
  spacing: 8,
  padding: 12,
  radius: 10,
  typography: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: 600,
    fontFamily: 'Avenir Next, ui-sans-serif',
  },
});

const TABLET_SURFACE = Object.freeze({
  width: 420,
  height: 588,
  pixelDensity: 1,
});

const TABLET_THEME = Object.freeze({
  backgroundColor: '#08111d',
  surfaceColor: '#132238',
  borderColor: '#27405e',
  accentColor: '#38bdf8',
  focusColor: '#22c55e',
  controlHeight: 38,
  spacing: 8,
  padding: 12,
  radius: 10,
  typography: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: 600,
    fontFamily: 'Avenir Next, ui-sans-serif',
  },
});

function createMovementBinding(code, label) {
  return {
    label,
    actionId: 'movement.key',
    startPayload: { code, active: true },
    stopPayload: { code, active: false },
  };
}

function getObserverPc() {
  return viewer?.getSnapshotState?.()?.state?.observerPc ?? { x: 0, y: 0, z: 0 };
}

function getSelectedPc() {
  return lastPickedResult?.position ? sceneToIcrsPc(lastPickedResult.position) : null;
}

function formatPoint(point, decimals = 1) {
  if (!point) {
    return '—';
  }
  return `${fmt(point.x, decimals)}, ${fmt(point.y, decimals)}, ${fmt(point.z, decimals)}`;
}

function buildSelectedStarLines(result = lastPickedResult) {
  if (!result?.position) {
    return [];
  }

  const fields = result.sidecarFields ?? {};
  const icrsPc = sceneToIcrsPc(result.position);
  const observerPc = getObserverPc();
  const dist = Math.hypot(
    icrsPc.x - observerPc.x,
    icrsPc.y - observerPc.y,
    icrsPc.z - observerPc.z,
  );

  const lines = [];
  if (fields?.properName) {
    lines.push(fields.properName);
  }
  if (fields?.bayer) {
    lines.push(fields.bayer);
  }
  if (fields?.hip) {
    lines.push(`HIP ${fields.hip}`);
  } else if (fields?.gaia) {
    lines.push(`Gaia ${fields.gaia}`);
  }
  lines.push(`Distance: ${formatDistancePc(dist)}`);
  lines.push(`Mag: ${fmt(result.apparentMagnitude)} app / ${fmt(result.absoluteMagnitude)} abs`);
  if (Number.isFinite(result.temperatureK)) {
    lines.push(`Temp: ${Math.round(result.temperatureK).toLocaleString()} K`);
  }
  return lines;
}

function createLineChildren(prefix, lines, emptyText) {
  const source = lines.length > 0 ? lines : [emptyText];
  return source.map((text, index) => createTextLabel(`${prefix}-${index}`, {
    text,
    tone: lines.length > 0 ? 'default' : 'muted',
  }));
}

function setTabletPage(pageId) {
  currentTabletPage = pageId;
}

function createGalaxyMapHudRoot() {
  const motion = cameraController?.getStats?.()?.motion ?? null;

  return createDockLayout('galaxy-map-hud', {
    padding: 0,
    topRight: {
      maxWidth: 260,
      child: createSection('galaxy-map-hud-actions', {
        title: 'Actions',
        backgroundColor: '#0f1b2d',
        children: [
          createButton('galaxy-map-look-sun', {
            label: 'Look at Sun',
            actionId: 'camera.look-sun',
          }),
          createButton('galaxy-map-fly-sun', {
            label: 'Fly to Sun',
            actionId: 'camera.fly-sun',
          }),
          createTouchOsFullscreenButton('galaxy-map-fullscreen'),
        ],
      }),
    },
    bottomLeft: {
      maxWidth: 240,
      child: createSection('galaxy-map-hud-move', {
        title: 'Move',
        backgroundColor: '#0f1b2d',
        children: [
          createDPad('galaxy-map-hud-dpad', {
            up: createMovementBinding('KeyW', 'Fwd'),
            down: createMovementBinding('KeyS', 'Back'),
            left: createMovementBinding('KeyA', 'Left'),
            right: createMovementBinding('KeyD', 'Right'),
          }),
        ],
      }),
    },
    bottomRight: {
      maxWidth: 240,
      child: createSection('galaxy-map-hud-status', {
        title: 'Lift + Speed',
        backgroundColor: '#0f1b2d',
        children: [
          createHoldButton('galaxy-map-hud-up', {
            label: 'Up',
            actionId: 'movement.key',
            startPayload: { code: 'KeyQ', active: true },
            stopPayload: { code: 'KeyQ', active: false },
          }),
          createHoldButton('galaxy-map-hud-down', {
            label: 'Down',
            actionId: 'movement.key',
            startPayload: { code: 'KeyE', active: true },
            stopPayload: { code: 'KeyE', active: false },
          }),
          createValueReadout('galaxy-map-hud-speed', {
            label: 'Speed',
            value: formatSpeedPcPerSec(motion?.speedPcPerSec ?? 0),
          }),
        ],
      }),
    },
  });
}

function createGalaxyMapTabletRoot() {
  const observerPc = getObserverPc();
  const selectedPc = getSelectedPc();

  if (currentTabletPage === 'selection') {
    const lines = buildSelectedStarLines();
    return createColumn('galaxy-map-tablet-selection', {
      pointerOpaque: true,
      padding: 10,
      gap: 10,
      backgroundColor: '#08111d',
      children: [
        createButton('galaxy-map-selection-back', {
          label: '< Back',
          actionId: 'tablet.page.home',
        }),
        createSection('galaxy-map-selection-target', {
          title: 'Selected Target',
          backgroundColor: '#0f1b2d',
          children: [
            ...createLineChildren('galaxy-map-selection-line', lines, 'No target selected.'),
            createButton('galaxy-map-selection-go', {
              label: 'Go to Selected',
              actionId: 'tablet.go-selected',
            }),
            createButton('galaxy-map-selection-look', {
              label: 'Look at Selected',
              actionId: 'tablet.look-selected',
            }),
            createButton('galaxy-map-selection-clear', {
              label: 'Clear Selection',
              actionId: 'tablet.clear-selection',
            }),
          ],
        }),
      ],
    });
  }

  if (currentTabletPage === 'rendering') {
    return createColumn('galaxy-map-tablet-rendering', {
      pointerOpaque: true,
      padding: 10,
      gap: 10,
      backgroundColor: '#08111d',
      children: [
        createButton('galaxy-map-rendering-back', {
          label: '< Back',
          actionId: 'tablet.page.home',
        }),
        createSection('galaxy-map-rendering-controls', {
          title: 'Rendering',
          backgroundColor: '#0f1b2d',
          children: [
            createSlider('galaxy-map-mag-limit', {
              label: 'Mag Limit',
              value: activeMagLimit,
              min: 0,
              max: 25,
              step: 0.1,
              valueText: activeMagLimit.toFixed(1),
            }),
            createSlider('galaxy-map-exposure', {
              label: 'Exposure',
              value: Math.log10(Math.max(activeExposure, 1)),
              min: 0,
              max: 5,
              step: 0.05,
              valueText: Math.round(activeExposure).toLocaleString(),
            }),
            createSlider('galaxy-map-pick-tolerance', {
              label: 'Pick Tol. deg',
              value: activeTolerance,
              min: 0.1,
              max: 10,
              step: 0.1,
              valueText: activeTolerance.toFixed(1),
            }),
            createSlider('galaxy-map-fly-speed', {
              label: 'Fly Speed',
              value: activeFlySpeed,
              min: 1,
              max: 2000,
              step: 1,
              valueText: `${Math.round(activeFlySpeed).toLocaleString()} pc/s`,
            }),
            createButton('galaxy-map-cancel-auto', {
              label: 'Cancel Automation',
              actionId: 'tablet.cancel-auto',
            }),
          ],
        }),
      ],
    });
  }

  if (currentTabletPage === 'waypoints') {
    return createColumn('galaxy-map-tablet-waypoints', {
      pointerOpaque: true,
      padding: 10,
      gap: 10,
      backgroundColor: '#08111d',
      children: [
        createButton('galaxy-map-waypoints-back', {
          label: '< Back',
          actionId: 'tablet.page.home',
        }),
        createSection('galaxy-map-waypoints-list', {
          title: 'Waypoints',
          backgroundColor: '#0f1b2d',
          children: WAYPOINTS.map((waypoint, index) => createButton(`galaxy-map-waypoint-${index}`, {
            label: waypoint.label,
            actionId: `tablet.waypoint.${index}`,
          })),
        }),
      ],
    });
  }

  return createColumn('galaxy-map-tablet-home', {
    pointerOpaque: true,
    padding: 10,
    gap: 10,
    backgroundColor: '#08111d',
    children: [
      createSection('galaxy-map-home-pages', {
        title: 'Pages',
        backgroundColor: '#0f1b2d',
        children: [
          createButton('galaxy-map-page-rendering', {
            label: 'Rendering',
            actionId: 'tablet.page.rendering',
          }),
          createButton('galaxy-map-page-waypoints', {
            label: 'Waypoints',
            actionId: 'tablet.page.waypoints',
          }),
          ...(lastPickedResult
            ? [
              createButton('galaxy-map-page-selection', {
                label: 'Selection',
                actionId: 'tablet.page.selection',
              }),
            ]
            : []),
        ],
      }),
      createSection('galaxy-map-home-observer', {
        title: 'Observer',
        backgroundColor: '#0f1b2d',
        children: [
          createValueReadout('galaxy-map-observer-position', {
            label: 'ICRS pc',
            value: formatPoint(observerPc),
          }),
          createValueReadout('galaxy-map-observer-fly-speed', {
            label: 'Fly Speed',
            value: `${Math.round(activeFlySpeed).toLocaleString()} pc/s`,
          }),
        ],
      }),
      createGalaxyMapControl(GALAXY_MAP_CONTROL_ID, {
        value: buildGalaxyMapValue(observerPc, selectedPc, galaxyMapScaleHint),
        height: 210,
      }),
    ],
  });
}

function createGalaxyMapTouchOsPart() {
  const tabletRuntime = createRuntime({
    root: createGalaxyMapTabletRoot(),
    surface: TABLET_SURFACE,
    theme: TABLET_THEME,
  });
  const tabletDriver = createScenePanelDriver({
    runtime: tabletRuntime,
    surface: TABLET_SURFACE,
    panelWidth: 0.24,
    panelHeight: 0.336,
    depthTest: false,
    parent(frame) {
      return frame.camera ?? null;
    },
    updatePlacement(panelMesh, frame) {
      const distance = 0.52;
      const tabletWidth = 0.24;
      const tabletHeight = 0.336;
      const aspect = frame.camera?.aspect ?? 16 / 9;
      const fovDeg = frame.camera?.isPerspectiveCamera ? frame.camera.fov : 60;
      const halfHeight = Math.tan((fovDeg * Math.PI / 180) * 0.5) * distance;
      const halfWidth = halfHeight * aspect;
      const hudPaddingPx = 12;
      const viewportWidth = Math.max(1, frame.size?.width ?? 1);
      const viewportHeight = Math.max(1, frame.size?.height ?? 1);
      const marginX = (halfWidth * 2) * (hudPaddingPx / viewportWidth);
      const marginY = (halfHeight * 2) * (hudPaddingPx / viewportHeight);
      const x = -halfWidth + tabletWidth * 0.5 + marginX;
      const y = halfHeight - tabletHeight * 0.5 - marginY;

      panelMesh.position.set(x, y, -distance);
      panelMesh.rotation.set(0, 0, 0);
      return true;
    },
  });

  const hudRuntime = createRuntime({
    root: createGalaxyMapHudRoot(),
    surface: HUD_SURFACE,
    theme: HUD_THEME,
  });
  const hudDriver = createHudPanelDriver({
    runtime: hudRuntime,
    surface: HUD_SURFACE,
    distance: 0.68,
    sizing: 'viewport',
  });

  return createTouchOsRuntimePart({
    id: 'desktop-galaxy-map-touch-os',
    panels: [
      {
        key: 'scene-tablet',
        runtime: tabletRuntime,
        driver: tabletDriver,
        sync() {
          tabletRuntime.setRoot(createGalaxyMapTabletRoot());
        },
        getFrame(context) {
          return {
            scene: context.scene,
            camera: context.camera,
            size: context.size,
            surfaceMetrics: TABLET_SURFACE,
          };
        },
      },
      {
        key: 'desktop-hud',
        runtime: hudRuntime,
        driver: hudDriver,
        sync() {
          hudRuntime.setRoot(createGalaxyMapHudRoot());
        },
        getFrame(context) {
          return {
            scene: context.scene,
            camera: context.camera,
            size: context.size,
            surfaceMetrics: {
              width: context.size.width,
              height: context.size.height,
              pixelDensity: globalThis.window?.devicePixelRatio ?? 1,
            },
          };
        },
      },
    ],
    onOutput(output, _panel, context) {
      if (handleNavigationTouchOsOutput(output, {
        cameraController,
        fullscreenTarget: context.host,
      })) {
        return;
      }

      if (output?.type === 'action') {
        if (output.actionId === 'camera.look-sun') {
          cameraController?.lookAt(SOLAR_ORIGIN_PC);
          return;
        }
        if (output.actionId === 'camera.fly-sun') {
          cameraController?.flyTo(SOLAR_ORIGIN_PC, { speed: 120 });
          return;
        }
        if (output.actionId === 'tablet.page.home') {
          setTabletPage('home');
          return;
        }
        if (output.actionId === 'tablet.page.selection') {
          setTabletPage('selection');
          return;
        }
        if (output.actionId === 'tablet.page.rendering') {
          setTabletPage('rendering');
          return;
        }
        if (output.actionId === 'tablet.page.waypoints') {
          setTabletPage('waypoints');
          return;
        }
        if (output.actionId === 'tablet.go-selected') {
          goToPickedStar();
          return;
        }
        if (output.actionId === 'tablet.look-selected') {
          if (lastPickedResult?.position) {
            cameraController?.lookAt(sceneToIcrsPc(lastPickedResult.position), { blend: 0.06 });
          }
          return;
        }
        if (output.actionId === 'tablet.clear-selection') {
          handlePick(null);
          return;
        }
        if (output.actionId === 'tablet.cancel-auto') {
          cameraController?.cancelAutomation();
          return;
        }
        const waypointMatch = output.actionId.match(/^tablet\.waypoint\.(\d+)$/);
        if (waypointMatch) {
          const waypoint = WAYPOINTS[Number.parseInt(waypointMatch[1], 10)];
          if (waypoint) {
            goToStarTarget(waypoint.targetPc);
          }
          setTabletPage('home');
        }
        return;
      }

      if (output?.type !== 'change-request') {
        return;
      }

      if (output.componentId === 'galaxy-map-mag-limit') {
        const nextValue = Number(output.value);
        if (Number.isFinite(nextValue)) {
          activeMagLimit = nextValue;
          applyViewerState({ refreshSelection: true });
        }
        return;
      }
      if (output.componentId === 'galaxy-map-exposure') {
        const nextValue = Number(output.value);
        if (Number.isFinite(nextValue)) {
          activeExposure = 10 ** nextValue;
          applyViewerState();
        }
        return;
      }
      if (output.componentId === 'galaxy-map-pick-tolerance') {
        const nextValue = Number(output.value);
        if (Number.isFinite(nextValue) && nextValue > 0) {
          activeTolerance = nextValue;
          pickControllerRef?.setToleranceDeg(activeTolerance);
        }
        return;
      }
      if (output.componentId === 'galaxy-map-fly-speed') {
        const nextValue = Number(output.value);
        if (Number.isFinite(nextValue) && nextValue > 0) {
          activeFlySpeed = nextValue;
        }
      }
    },
  });
}

function handlePick(result) {
  pickGeneration += 1;
  const generation = pickGeneration;
  lastPickedResult = result ?? null;

  if (result) {
    delete result.sidecarFields;
  } else {
    cameraController?.cancelOrientation?.();
    pickControllerRef?.clearSelection?.();
  }
  if (result) {
    setTabletPage('selection');
  } else if (currentTabletPage === 'selection') {
    setTabletPage('home');
  }

  if (!result) {
    return;
  }

  const starData = starFieldLayer?.getStarData?.();
  const pickMeta = starData?.pickMeta?.[result.index];
  if (!pickMeta || !datasetSession.getSidecarService('meta')) {
    return;
  }

  void (async () => {
    try {
      const fields = await datasetSession.resolveSidecarMetaFields('meta', pickMeta);
      if (generation !== pickGeneration || lastPickedResult !== result || !fields) {
        return;
      }
      result.sidecarFields = fields;
    } catch {
      // Sidecar is optional for this demo.
    }
  })();
}

function goToStarTarget(targetPc) {
  if (!cameraController || !targetPc) {
    return;
  }
  const observerPc = viewer?.getSnapshotState?.()?.state?.observerPc;
  if (!observerPc) {
    return;
  }
  const arrivalTarget = approachTargetFromObserver(targetPc, observerPc, 0.25);
  cameraController.cancelAutomation();
  cameraController.lockAt(targetPc, {
    dwellMs: 5000,
    recenterSpeed: 0.06,
  });
  cameraController.flyTo(arrivalTarget, {
    speed: activeFlySpeed,
    deceleration: 2.4,
    onArrive: () => {
      cameraController?.cancelOrientation?.();
      viewer?.refreshSelection().catch((error) => {
        console.error('[galaxy-map-demo] refresh after flyTo failed', error);
      });
    },
  });
}

function goToPickedStar() {
  if (!lastPickedResult?.position) {
    return;
  }
  goToStarTarget(sceneToIcrsPc(lastPickedResult.position));
}

async function warmDatasetSession() {
  try {
    const renderService = datasetSession.getRenderService();
    const { bootstrap, rootShard } = await renderService.ensureBootstrapAndRootShard();
    galaxyMapScaleHint = deriveGalaxyMapScaleHint(bootstrap, rootShard);

    const metaService = datasetSession.getSidecarService('meta');
    if (metaService) {
      try {
        await metaService.ensureHeader();
      } catch (error) {
        console.warn('[galaxy-map-demo] meta sidecar unavailable', error);
      }
    }

    return bootstrap;
  } catch (error) {
    throw error;
  }
}

async function mountViewer() {
  if (viewer) {
    return viewer;
  }

  await warmDatasetSession();

  cameraController = createCameraRigController({
    id: 'desktop-galaxy-map-camera-rig',
    icrsToSceneTransform: ORION_SCENE_TRANSFORM,
    sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });

  starFieldLayer = createStarFieldLayer({
    id: 'desktop-galaxy-map-star-field-layer',
    positionTransform: ORION_SCENE_TRANSFORM,
    includePickMeta: true,
    materialFactory: () => createDefaultStarFieldMaterialProfile(),
  });

  pickControllerRef = createPickController({
    id: 'desktop-galaxy-map-pick-controller',
    getStarData: () => starFieldLayer?.getStarData?.(),
    toleranceDeg: activeTolerance,
    onPick(result) {
      handlePick(result);
    },
  });
  touchOsPartRef = createGalaxyMapTouchOsPart();

  viewer = await createViewer(mount, {
    datasetSession,
    camera: createViewerCamera(),
    interestField: createObserverShellField({
      id: 'desktop-galaxy-map-field',
      note: 'Desktop galaxy-map validation sandbox.',
    }),
    controllers: [
      touchOsPartRef,
      cameraController,
      createSelectionRefreshController({
        id: 'desktop-galaxy-map-selection-refresh',
        observerDistancePc: 12,
        minIntervalMs: 250,
        watchSize: false,
      }),
      pickControllerRef,
    ],
    layers: [starFieldLayer],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      demo: 'desktop-galaxy-map',
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: ORION_CENTER_PC,
      mDesired: activeMagLimit,
      starFieldExposure: activeExposure,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });
  installDemoViewerDebugConsole(viewer, { id: 'galaxy-map' });
  return viewer;
}

function applyViewerState(options = {}) {
  if (!viewer) {
    return;
  }

  viewer.setState({
    mDesired: activeMagLimit,
    starFieldExposure: activeExposure,
  });

  if (options.refreshSelection) {
    viewer.refreshSelection()
      .catch((error) => {
        console.error('[galaxy-map-demo] state refresh failed', error);
      });
  }
}

globalThis.window?.addEventListener('beforeunload', () => {
  if (viewer) {
    viewer.dispose().catch((error) => {
      console.error('[galaxy-map-demo] cleanup failed', error);
    });
  }
});

mountViewer().catch((error) => {
  console.error('[galaxy-map-demo] initial mount failed', error);
});
