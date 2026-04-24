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
  buildHRDiagramValue,
  createCameraRigController,
  createDefaultStarFieldMaterialProfile,
  createFoundInSpaceDatasetOptions,
  createHRDiagramControl,
  createObserverShellField,
  createPickController,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  createStarFieldLayer,
  createViewer,
  createVolumeHRLoader,
  DEFAULT_PICK_TOLERANCE_DEG,
  DEFAULT_STAR_FIELD_STATE,
  getDatasetSession,
  ORION_CENTER_PC,
  resolveFoundInSpaceDatasetOverrides,
  SCALE,
  SOLAR_ORIGIN_PC,
} from '../index.js';
import {
  formatDistancePc,
  formatSpeedPcPerSec,
} from '../presets/navigation-presets.js';
import { createTouchOsRuntimePart } from './touch-os-runtime-part.js';
import {
  createTouchOsFullscreenButton,
  handleNavigationTouchOsOutput,
} from './touch-os-navigation.js';
import { installDemoViewerDebugConsole } from './viewer-debug-console.js';

const PROXIMA_CEN_PC = { x: -0.47, y: -0.36, z: -1.16 };
const SIRIUS_PC = { x: -0.49, y: 2.48, z: -0.76 };
const BETELGEUSE_PC = { x: 4.2, y: 198.3, z: 25.8 };

const WAYPOINTS = [
  { id: 'fly-sol', label: 'Fly: Sol', targetPc: SOLAR_ORIGIN_PC },
  { id: 'fly-proxima', label: 'Fly: Proxima', targetPc: PROXIMA_CEN_PC },
  { id: 'fly-sirius', label: 'Fly: Sirius', targetPc: SIRIUS_PC },
  { id: 'fly-betelgeuse', label: 'Fly: Betelgeuse', targetPc: BETELGEUSE_PC },
];

const {
  icrsToScene: ORION_SCENE_TRANSFORM,
  sceneToIcrs: ORION_SCENE_TO_ICRS_TRANSFORM,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

const mount = document.querySelector('[data-skykit-viewer-root]');

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'desktop-hr-diagram-touch-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'desktop-hr-diagram-touch',
  },
}));

let viewer = null;
let cameraController = null;
let touchOsPartRef = null;
let pickControllerRef = null;
let volumeLoader = null;
let activePage = 'home';
let activeMode = 0;
let activeMagLimit = 7.5;
let activeRadius = 25;
let activeFlySpeed = 180;
let latestGeometry = null;
let latestStarCount = 0;
let volumeGeometry = null;
let volumeStarCount = 0;
let lastVolumeObserverPc = { ...SOLAR_ORIGIN_PC };
let volumeReloadQueued = false;
let nextHrUpdateAtMs = 0;
let lastPickedResult = null;
let latestHrValue = null;

const viewProjection = new THREE.Matrix4();

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

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function sceneToIcrsPc(scenePosition) {
  const [ix, iy, iz] = ORION_SCENE_TO_ICRS_TRANSFORM(scenePosition.x, scenePosition.y, scenePosition.z);
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

function setTabletPage(page) {
  activePage = page;
}

function createMovementBinding(code, label) {
  return {
    label,
    actionId: 'movement.key',
    startPayload: { code, active: true },
    stopPayload: { code, active: false },
  };
}

function getObserverPc() {
  return viewer?.getSnapshotState?.()?.state?.observerPc ?? { ...SOLAR_ORIGIN_PC };
}

function formatPoint(point, decimals = 1) {
  if (!point) {
    return '—';
  }
  return `${point.x.toFixed(decimals)}, ${point.y.toFixed(decimals)}, ${point.z.toFixed(decimals)}`;
}

function buildSelectedStarLines() {
  if (!lastPickedResult) {
    return [];
  }
  const lines = [];
  const temp = Number(lastPickedResult.temperatureK);
  const absMag = Number(lastPickedResult.absoluteMagnitude);
  const appMag = Number(lastPickedResult.apparentMagnitude);
  const targetPc = lastPickedResult.position ? sceneToIcrsPc(lastPickedResult.position) : null;
  const observerPc = getObserverPc();
  const distPc = targetPc
    ? Math.hypot(
      targetPc.x - observerPc.x,
      targetPc.y - observerPc.y,
      targetPc.z - observerPc.z,
    )
    : Number(lastPickedResult.distancePc);

  if (targetPc) {
    lines.push(`ICRS pc: ${formatPoint(targetPc)}`);
  }
  if (Number.isFinite(temp)) {
    lines.push(`Temp: ${Math.round(temp).toLocaleString()} K`);
  }
  if (Number.isFinite(appMag) || Number.isFinite(absMag)) {
    lines.push(`Mag: ${Number.isFinite(appMag) ? appMag.toFixed(2) : '-'} app / ${Number.isFinite(absMag) ? absMag.toFixed(2) : '-'} abs`);
  }
  if (Number.isFinite(distPc)) {
    lines.push(`Distance: ${formatDistancePc(distPc)}`);
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

function createHrDiagramHudRoot() {
  const motion = cameraController?.getStats?.()?.motion ?? null;
  const observerPc = motion?.observerPc ?? getObserverPc();
  const distancePc = Math.hypot(
    observerPc.x - SOLAR_ORIGIN_PC.x,
    observerPc.y - SOLAR_ORIGIN_PC.y,
    observerPc.z - SOLAR_ORIGIN_PC.z,
  );

  return createDockLayout('hr-diagram-touch-hud', {
    padding: 0,
    topRight: {
      maxWidth: 260,
      child: createSection('hr-diagram-touch-hud-actions', {
        title: 'Actions',
        backgroundColor: '#0f1b2d',
        children: [
          createButton('hr-diagram-touch-look-sun', {
            label: 'Look at Sun',
            actionId: 'camera.look-sun',
          }),
          createButton('hr-diagram-touch-fly-sun', {
            label: 'Fly to Sun',
            actionId: 'camera.fly-sun',
          }),
          createTouchOsFullscreenButton('hr-diagram-touch-fullscreen'),
        ],
      }),
    },
    bottomLeft: {
      maxWidth: 240,
      child: createSection('hr-diagram-touch-hud-move', {
        title: 'Move',
        backgroundColor: '#0f1b2d',
        children: [
          createDPad('hr-diagram-touch-hud-dpad', {
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
      child: createSection('hr-diagram-touch-hud-status', {
        title: 'Lift + Status',
        backgroundColor: '#0f1b2d',
        children: [
          createHoldButton('hr-diagram-touch-hud-up', {
            label: 'Up',
            actionId: 'movement.key',
            startPayload: { code: 'KeyQ', active: true },
            stopPayload: { code: 'KeyQ', active: false },
          }),
          createHoldButton('hr-diagram-touch-hud-down', {
            label: 'Down',
            actionId: 'movement.key',
            startPayload: { code: 'KeyE', active: true },
            stopPayload: { code: 'KeyE', active: false },
          }),
          createValueReadout('hr-diagram-touch-hud-speed', {
            label: 'Speed',
            value: formatSpeedPcPerSec(motion?.speedPcPerSec ?? 0),
          }),
          createValueReadout('hr-diagram-touch-hud-distance', {
            label: 'Distance to Sun',
            value: formatDistancePc(distancePc),
          }),
        ],
      }),
    },
  });
}

function createHrDiagramTabletRoot() {
  if (activePage === 'selection') {
    return createColumn('hr-diagram-touch-tablet-selection', {
      pointerOpaque: true,
      padding: 10,
      gap: 10,
      backgroundColor: '#08111d',
      children: [
        createButton('hr-diagram-touch-selection-back', {
          label: '< Back',
          actionId: 'tablet.page.home',
        }),
        createSection('hr-diagram-touch-selection-panel', {
          title: 'Selected Star',
          backgroundColor: '#0f1b2d',
          children: [
            ...createLineChildren(
              'hr-diagram-touch-selection-line',
              buildSelectedStarLines(),
              'No star selected.',
            ),
            createButton('hr-diagram-touch-selection-go', {
              label: 'Go to Selected',
              actionId: 'tablet.go-selected',
            }),
            createButton('hr-diagram-touch-selection-look', {
              label: 'Look at Selected',
              actionId: 'tablet.look-selected',
            }),
            createButton('hr-diagram-touch-selection-clear', {
              label: 'Clear Selection',
              actionId: 'tablet.clear-selection',
            }),
          ],
        }),
      ],
    });
  }

  if (activePage === 'rendering') {
    return createColumn('hr-diagram-touch-tablet-rendering', {
      pointerOpaque: true,
      padding: 10,
      gap: 10,
      backgroundColor: '#08111d',
      children: [
        createButton('hr-diagram-touch-rendering-back', {
          label: '< Back',
          actionId: 'tablet.page.home',
        }),
        createSection('hr-diagram-touch-rendering-panel', {
          title: 'Rendering Controls',
          backgroundColor: '#0f1b2d',
          children: [
            createSlider('hr-diagram-touch-mode', {
              label: 'Mode',
              value: activeMode,
              min: 0,
              max: 2,
              step: 1,
              valueLabels: [
                { value: 0, text: 'Mag' },
                { value: 1, text: 'Volume' },
                { value: 2, text: 'Frustum' },
              ],
            }),
            createSlider('hr-diagram-touch-mag-limit', {
              label: 'Mag Limit',
              value: activeMagLimit,
              min: 0,
              max: 25,
              step: 0.1,
              valueText: activeMagLimit.toFixed(1),
            }),
            createSlider('hr-diagram-touch-volume-radius', {
              label: 'Volume Radius',
              value: activeRadius,
              min: 5,
              max: 150,
              step: 5,
              valueText: `${Math.round(activeRadius)} pc`,
            }),
            createSlider('hr-diagram-touch-fly-speed', {
              label: 'Fly Speed',
              value: activeFlySpeed,
              min: 5,
              max: 2000,
              step: 5,
              valueText: `${Math.round(activeFlySpeed).toLocaleString()} pc/s`,
            }),
            createButton('hr-diagram-touch-cancel-auto', {
              label: 'Cancel Automation',
              actionId: 'tablet.cancel-auto',
            }),
          ],
        }),
      ],
    });
  }

  if (activePage === 'waypoints') {
    return createColumn('hr-diagram-touch-tablet-waypoints', {
      pointerOpaque: true,
      padding: 10,
      gap: 10,
      backgroundColor: '#08111d',
      children: [
        createButton('hr-diagram-touch-waypoints-back', {
          label: '< Back',
          actionId: 'tablet.page.home',
        }),
        createSection('hr-diagram-touch-waypoints-panel', {
          title: 'Waypoints',
          backgroundColor: '#0f1b2d',
          children: WAYPOINTS.map((waypoint, index) => createButton(`hr-diagram-touch-waypoint-${index}`, {
            label: waypoint.label,
            actionId: `tablet.waypoint.${index}`,
          })),
        }),
      ],
    });
  }

  return createColumn('hr-diagram-touch-tablet-home', {
    pointerOpaque: true,
    padding: 10,
    gap: 10,
    backgroundColor: '#08111d',
    children: [
      createSection('hr-diagram-touch-home-pages', {
        title: 'Pages',
        backgroundColor: '#0f1b2d',
        children: [
          ...(lastPickedResult
            ? [
              createButton('hr-diagram-touch-page-selection', {
                label: 'Selection',
                actionId: 'tablet.page.selection',
              }),
            ]
            : []),
          createButton('hr-diagram-touch-page-rendering', {
            label: 'Rendering Controls',
            actionId: 'tablet.page.rendering',
          }),
          createButton('hr-diagram-touch-page-waypoints', {
            label: 'Waypoints',
            actionId: 'tablet.page.waypoints',
          }),
        ],
      }),
      createSection('hr-diagram-touch-home-observer', {
        title: 'Observer',
        backgroundColor: '#0f1b2d',
        children: [
          createValueReadout('hr-diagram-touch-observer-position', {
            label: 'ICRS pc',
            value: formatPoint(getObserverPc()),
          }),
          createValueReadout('hr-diagram-touch-observer-mode', {
            label: 'Mode',
            value: ['Mag', 'Volume', 'Frustum'][activeMode] ?? String(activeMode),
          }),
        ],
      }),
      createHRDiagramControl('hr-diagram-touch-plot', {
        value: latestHrValue,
        height: 220,
      }),
    ],
  });
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
        console.error('[hr-diagram-touch-demo] refresh after flyTo failed', error);
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

function handlePick(result) {
  lastPickedResult = result ?? null;
  if (!result) {
    pickControllerRef?.clearSelection?.();
  }
  if (lastPickedResult) {
    setTabletPage('selection');
  } else if (activePage === 'selection') {
    setTabletPage('home');
  }
  nextHrUpdateAtMs = 0;
}

async function loadVolumeHR() {
  if (!volumeLoader || activeMode !== 1) {
    return;
  }

  const observerPc = viewer?.getSnapshotState?.()?.state?.observerPc ?? SOLAR_ORIGIN_PC;
  const result = await volumeLoader.load({
    observerPc,
    maxRadiusPc: activeRadius,
  });

  if (!result) {
    return;
  }

  volumeGeometry = result.geometry;
  volumeStarCount = result.starCount;
  lastVolumeObserverPc = clonePoint(observerPc);
  nextHrUpdateAtMs = 0;
}

function queueVolumeReload() {
  if (volumeReloadQueued) {
    return;
  }
  volumeReloadQueued = true;
  requestAnimationFrame(() => {
    volumeReloadQueued = false;
    loadVolumeHR().catch((error) => {
      console.error('[hr-diagram-touch-demo] volume load failed', error);
    });
  });
}

function updateHrDisplay(context) {
  const observerPc = context.state?.observerPc ?? SOLAR_ORIGIN_PC;
  if (activeMode === 1) {
    const dx = observerPc.x - lastVolumeObserverPc.x;
    const dy = observerPc.y - lastVolumeObserverPc.y;
    const dz = observerPc.z - lastVolumeObserverPc.z;
    const movedPc = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (movedPc > Math.max(2, activeRadius * 0.15)) {
      queueVolumeReload();
    }
  }

  const geometry = activeMode === 1 ? volumeGeometry : latestGeometry;
  const starCount = activeMode === 1 ? volumeStarCount : latestStarCount;
  if (!geometry || !(starCount > 0) || activePage !== 'home') {
    latestHrValue = null;
    return;
  }

  const now = performance.now();
  const updateIntervalMs = activeMode === 2 ? 90 : 140;
  if (now < nextHrUpdateAtMs) {
    return;
  }
  nextHrUpdateAtMs = now + updateIntervalMs;

  latestHrValue = buildHRDiagramValue(geometry, {
    starCount,
    observerPc,
    mode: activeMode,
    appMagLimit: activeMagLimit,
    viewProjection: activeMode === 2
      ? viewProjection.multiplyMatrices(
        context.camera.projectionMatrix,
        context.camera.matrixWorldInverse,
      ).elements
      : undefined,
    selectedStars: lastPickedResult
      ? [{
        teffK: lastPickedResult.temperatureK,
        magAbs: lastPickedResult.absoluteMagnitude,
      }]
      : null,
  });
}

function createHrDiagramTouchOsPart() {
  const tabletRuntime = createRuntime({
    root: createHrDiagramTabletRoot(),
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
    root: createHrDiagramHudRoot(),
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
    id: 'desktop-hr-diagram-touch-os',
    panels: [
      {
        key: 'scene-tablet',
        runtime: tabletRuntime,
        driver: tabletDriver,
        sync(context) {
          updateHrDisplay(context);
          tabletRuntime.setRoot(createHrDiagramTabletRoot());
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
          hudRuntime.setRoot(createHrDiagramHudRoot());
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
          nextHrUpdateAtMs = 0;
          return;
        }
        if (output.actionId === 'tablet.page.selection') {
          setTabletPage('selection');
          nextHrUpdateAtMs = 0;
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
        if (output.actionId === 'tablet.cancel-auto') {
          cameraController?.cancelAutomation();
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
        const waypointMatch = output.actionId.match(/^tablet\.waypoint\.(\d+)$/);
        if (waypointMatch) {
          const waypoint = WAYPOINTS[Number.parseInt(waypointMatch[1], 10)];
          if (waypoint) {
            cameraController?.lookAt(waypoint.targetPc);
            goToStarTarget(waypoint.targetPc);
          }
        }
        return;
      }

      if (output?.type !== 'change-request') {
        return;
      }

      if (output.componentId === 'hr-diagram-touch-mag-limit') {
        activeMagLimit = Number(output.value);
        viewer?.setState({ mDesired: activeMagLimit });
        viewer?.refreshSelection().catch((error) => {
          console.error('[hr-diagram-touch-demo] refresh after mag change failed', error);
        });
        nextHrUpdateAtMs = 0;
        return;
      }
      if (output.componentId === 'hr-diagram-touch-mode') {
        activeMode = Number(output.value);
        nextHrUpdateAtMs = 0;
        if (activeMode === 1) {
          queueVolumeReload();
        }
        return;
      }
      if (output.componentId === 'hr-diagram-touch-volume-radius') {
        activeRadius = Number(output.value);
        if (activeMode === 1) {
          queueVolumeReload();
        }
        nextHrUpdateAtMs = 0;
        return;
      }
      if (output.componentId === 'hr-diagram-touch-fly-speed') {
        activeFlySpeed = Number(output.value);
      }
    },
  });
}

async function mountViewer() {
  await datasetSession.ensureRenderRootShard();
  await datasetSession.ensureRenderBootstrap();

  volumeLoader = createVolumeHRLoader({ datasetSession });

  cameraController = createCameraRigController({
    id: 'desktop-hr-diagram-touch-camera-rig',
    icrsToSceneTransform: ORION_SCENE_TRANSFORM,
    sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });

  const starFieldLayer = createStarFieldLayer({
    id: 'desktop-hr-diagram-touch-star-field-layer',
    positionTransform: ORION_SCENE_TRANSFORM,
    includePickMeta: true,
    materialFactory: () => createDefaultStarFieldMaterialProfile(),
    onCommit({ geometry, starCount }) {
      latestGeometry = geometry;
      latestStarCount = starCount;
      nextHrUpdateAtMs = 0;
    },
  });

  touchOsPartRef = createHrDiagramTouchOsPart();
  pickControllerRef = createPickController({
    id: 'desktop-hr-diagram-touch-pick-controller',
    getStarData: () => starFieldLayer?.getStarData?.(),
    toleranceDeg: DEFAULT_PICK_TOLERANCE_DEG,
    onPick(result) {
      handlePick(result);
    },
  });

  viewer = await createViewer(mount, {
    datasetSession,
    interestField: createObserverShellField({
      id: 'desktop-hr-diagram-touch-field',
      note: 'Desktop touch HR diagram sandbox.',
    }),
    controllers: [
      cameraController,
      createSelectionRefreshController({
        id: 'desktop-hr-diagram-touch-selection-refresh',
        observerDistancePc: 4,
        minIntervalMs: 140,
      }),
      touchOsPartRef,
      pickControllerRef,
    ],
    layers: [starFieldLayer],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      observerPc: { ...SOLAR_ORIGIN_PC },
      mDesired: activeMagLimit,
      pickToleranceDeg: DEFAULT_PICK_TOLERANCE_DEG,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });

  queueVolumeReload();
  installDemoViewerDebugConsole(viewer, { id: 'hr-diagram-touch' });
}

window.addEventListener('beforeunload', () => {
  volumeLoader?.cancel();
  viewer?.dispose().catch((error) => {
    console.error('[hr-diagram-touch-demo] cleanup failed', error);
  });
});

mountViewer().catch((error) => {
  console.error('[hr-diagram-touch-demo] mount failed', error);
});
