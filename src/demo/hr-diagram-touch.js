import * as THREE from 'three';
import {
  createCameraRigController,
  createDefaultStarFieldMaterialProfile,
  createFoundInSpaceDatasetOptions,
  createHRDiagramControl,
  buildHRDiagramValue,
  createHud,
  createObserverShellField,
  createSceneOrientationTransforms,
  createSceneTouchDisplayController,
  createSelectionRefreshController,
  createStarFieldLayer,
  createViewer,
  DEFAULT_PICK_TOLERANCE_DEG,
  DEFAULT_STAR_FIELD_STATE,
  getDatasetSession,
  ORION_CENTER_PC,
  resolveFoundInSpaceDatasetOverrides,
  SOLAR_ORIGIN_PC,
} from '../index.js';
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
let tabletDisplay = null;
let activeMode = 0;
let activeMagLimit = 7.5;
let activeFlySpeed = 180;
let latestGeometry = null;
let latestStarCount = 0;
let nextHrUpdateAtMs = 0;
const viewProjection = new THREE.Matrix4();

function buildTabletItems() {
  return [
    {
      id: 'hr',
      type: 'hr-diagram',
      value: null,
    },
    {
      id: 'hr-mode',
      type: 'range',
      label: 'Mode',
      min: 0,
      max: 2,
      step: 1,
      value: activeMode,
      formatValue(value) {
        return ['Mag', 'Volume', 'Frustum'][Number(value)] ?? String(value);
      },
    },
    {
      id: 'mag-limit',
      type: 'range',
      label: 'Mag Limit',
      value: activeMagLimit,
      min: 0,
      max: 25,
      step: 0.1,
      formatValue(value) {
        return Number(value).toFixed(1);
      },
    },
    {
      id: 'fly-speed',
      type: 'range',
      label: 'Fly Speed',
      value: activeFlySpeed,
      min: 5,
      max: 2000,
      step: 5,
      formatValue(value) {
        return `${Math.round(Number(value)).toLocaleString()} pc/s`;
      },
    },
    ...WAYPOINTS.map((waypoint) => ({
      id: waypoint.id,
      label: waypoint.label,
      type: 'button',
    })),
    { id: 'cancel-auto', label: 'Cancel Automation', type: 'button' },
  ];
}

function updateHrDisplay(context) {
  if (!tabletDisplay || !latestGeometry) {
    return;
  }

  const now = performance.now();
  const updateIntervalMs = activeMode === 2 ? 90 : 140;
  if (now < nextHrUpdateAtMs) {
    return;
  }
  nextHrUpdateAtMs = now + updateIntervalMs;

  const observerPc = context.state?.observerPc ?? SOLAR_ORIGIN_PC;
  const value = buildHRDiagramValue(latestGeometry, {
    starCount: latestStarCount,
    observerPc,
    mode: activeMode,
    appMagLimit: activeMagLimit,
    viewProjection: activeMode === 2
      ? viewProjection.multiplyMatrices(
        context.camera.projectionMatrix,
        context.camera.matrixWorldInverse,
      ).elements
      : undefined,
  });

  tabletDisplay.setItemValue('hr', value);
}

function onTabletChange(id, value) {
  if (id === 'mag-limit') {
    activeMagLimit = Number(value);
    viewer?.setState({ mDesired: activeMagLimit });
    viewer?.refreshSelection().catch((error) => {
      console.error('[hr-diagram-touch-demo] refresh after mag change failed', error);
    });
    return;
  }

  if (id === 'hr-mode') {
    activeMode = Number(value);
    nextHrUpdateAtMs = 0;
    return;
  }

  if (id === 'fly-speed') {
    activeFlySpeed = Number(value);
    return;
  }

  if (id === 'cancel-auto') {
    cameraController?.cancelAutomation();
    return;
  }

  const waypoint = WAYPOINTS.find((entry) => entry.id === id);
  if (!waypoint) {
    return;
  }

  cameraController?.lookAt(waypoint.targetPc);
  cameraController?.flyTo(waypoint.targetPc, {
    speed: activeFlySpeed,
    deceleration: Math.max(activeFlySpeed * 0.6, 5),
    arrivalThreshold: 0.03,
  });
}

async function mountViewer() {
  await datasetSession.ensureRenderRootShard();
  await datasetSession.ensureRenderBootstrap();

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
    materialFactory: () => createDefaultStarFieldMaterialProfile(),
    onCommit({ geometry, starCount }) {
      latestGeometry = geometry;
      latestStarCount = starCount;
      nextHrUpdateAtMs = 0;
    },
  });

  tabletDisplay = createSceneTouchDisplayController({
    id: 'desktop-hr-diagram-touch-tablet',
    title: 'SkyKit HR',
    items: buildTabletItems(),
    panelWidth: 0.22,
    panelHeight: 0.33,
    mouseControls: true,
    parent: 'cameraMount',
    position: { x: -0.14, y: -0.03, z: -0.33 },
    rotation: { x: -0.18, y: 0.14, z: 0.03 },
    displayOptions: {
      controls: {
        'hr-diagram': createHRDiagramControl({ height: 220 }),
      },
    },
    onChange(id, value) {
      onTabletChange(id, value);
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
      tabletDisplay,
      createHud({
        cameraController,
        controls: [
          { preset: 'arrows', position: 'bottom-right' },
          { preset: 'wasd-qe', position: 'bottom-left' },
        ],
      }),
    ],
    layers: [starFieldLayer],
    overlays: [
      {
        id: 'desktop-hr-diagram-touch-overlay',
        update(context) {
          updateHrDisplay(context);
        },
      },
    ],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      observerPc: { ...SOLAR_ORIGIN_PC },
      mDesired: activeMagLimit,
      pickToleranceDeg: DEFAULT_PICK_TOLERANCE_DEG,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });

  installDemoViewerDebugConsole(viewer, { id: 'hr-diagram-touch' });
}

window.addEventListener('beforeunload', () => {
  viewer?.dispose().catch((error) => {
    console.error('[hr-diagram-touch-demo] cleanup failed', error);
  });
});

mountViewer().catch((error) => {
  console.error('[hr-diagram-touch-demo] mount failed', error);
});
