import * as THREE from 'three';
import {
  createButton,
  createRuntime,
  createTextLabel,
  createValueReadout,
} from '@found-in-space/touch-os';
import { createHudPanelDriver } from '@found-in-space/touch-os/hosts/three';
import {
  createCameraRigController,
  createDefaultStarFieldMaterialProfile,
  DEFAULT_STAR_FIELD_STATE,
  createFoundInSpaceDatasetOptions,
  createObserverShellField,
  ORION_CENTER_PC,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  resolveFoundInSpaceDatasetOverrides,
  createStarFieldLayer,
  createViewer,
  getDatasetSession,
  SOLAR_ORIGIN_PC,
} from '../index.js';
import {
  formatDistancePc,
  formatSpeedPcPerSec,
} from '../presets/navigation-presets.js';
import { createRadioBubbleMeshes } from '../layers/radio-bubble-meshes.js';
import { createTouchOsRuntimePart } from './touch-os-runtime-part.js';
import {
  createNavigationTouchOsRoot,
  createTouchOsFullscreenButton,
  handleNavigationTouchOsOutput,
} from './touch-os-navigation.js';
import { installDemoViewerDebugConsole } from './viewer-debug-console.js';

const {
  icrsToScene: ICRS_TO_SCENE_Y_UP,
  sceneToIcrs: SCENE_Y_UP_TO_ICRS,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}


const mount = document.querySelector('[data-skykit-viewer-root]');
const magLimitInput = document.querySelector('[data-mag-limit]');
const statusValue = document.querySelector('[data-status]');

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'radio-bubble-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'radio-bubble',
  },
}));

let viewer = null;
let activeMagLimit = Number.isFinite(Number(magLimitInput?.value))
  ? Number(magLimitInput.value)
  : 6.5;

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

async function warmDatasetSession() {
  try {
    await datasetSession.ensureRenderRootShard();
    return await datasetSession.ensureRenderBootstrap();
  } catch (error) {
    throw error;
  }
}

async function mountViewer() {
  if (viewer) {
    return viewer;
  }

  await warmDatasetSession();

  const cameraController = createCameraRigController({
    id: 'radio-bubble-camera-rig',
    icrsToSceneTransform: ICRS_TO_SCENE_Y_UP,
    sceneToIcrsTransform: SCENE_Y_UP_TO_ICRS,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });
  const hudRuntime = createRuntime({
    root: createRadioBubbleHudRoot(cameraController),
    surface: HUD_SURFACE,
    theme: HUD_THEME,
  });
  const hudDriver = createHudPanelDriver({
    runtime: hudRuntime,
    surface: HUD_SURFACE,
    distance: 0.68,
    sizing: 'viewport',
  });
  const touchOsPart = createTouchOsRuntimePart({
    id: 'radio-bubble-touch-os',
    panels: [
      {
        key: 'desktop-hud',
        runtime: hudRuntime,
        driver: hudDriver,
        sync() {
          hudRuntime.setRoot(createRadioBubbleHudRoot(cameraController));
        },
        getFrame(context) {
          return {
            scene: context.scene,
            camera: context.camera,
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

      if (output?.type !== 'action') {
        return;
      }

      if (output.actionId === 'camera.look-sun') {
        cameraController.lookAt(SOLAR_ORIGIN_PC);
      }
      if (output.actionId === 'camera.fly-sun') {
        cameraController.flyTo(SOLAR_ORIGIN_PC, { speed: 120 });
      }
    },
  });

  viewer = await createViewer(mount, {
    datasetSession,
    camera: createViewerCamera(),
    interestField: createObserverShellField({
      id: 'radio-bubble-field',
      note: 'Radio bubble demo observer shell.',
    }),
    controllers: [
      cameraController,
      createSelectionRefreshController({
        id: 'radio-bubble-selection-refresh',
        observerDistancePc: 12,
        minIntervalMs: 250,
        watchSize: false,
      }),
      touchOsPart,
    ],
    layers: [
      createStarFieldLayer({
        id: 'radio-bubble-star-field',
        positionTransform: ICRS_TO_SCENE_Y_UP,
        materialFactory: () => createDefaultStarFieldMaterialProfile(),
      }),
    ],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      observerPc: { x: 0, y: 0, z: 0 },
      mDesired: activeMagLimit,
      targetPc: ORION_CENTER_PC,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });
  installDemoViewerDebugConsole(viewer, { id: 'radio-bubble' });

  const { group: bubbleGroup } = createRadioBubbleMeshes();
  viewer.contentRoot.add(bubbleGroup);

  if (statusValue) {
    statusValue.textContent = 'running';
  }

  return viewer;
}

function createRadioBubbleHudRoot(cameraController) {
  const stats = cameraController.getStats?.() ?? {};
  const motion = stats.motion ?? null;
  const observerPc = motion?.observerPc ?? stats.observerPc ?? { x: 0, y: 0, z: 0 };
  const distancePc = Math.hypot(
    observerPc.x - SOLAR_ORIGIN_PC.x,
    observerPc.y - SOLAR_ORIGIN_PC.y,
    observerPc.z - SOLAR_ORIGIN_PC.z,
  );

  return createNavigationTouchOsRoot({
    id: 'radio-bubble-hud',
    title: 'Radio Bubble',
    overviewChildren: [
      createTextLabel('radio-bubble-help-1', {
        text: 'Use the HUD or keyboard to drift through the shell.',
        tone: 'muted',
      }),
      createTextLabel('radio-bubble-help-2', {
        text: 'The bubble stays astronomy-specific; the HUD is Touch OS.',
        tone: 'muted',
      }),
    ],
    statusChildren: [
      createValueReadout('radio-bubble-speed', {
        label: 'Speed',
        value: formatSpeedPcPerSec(motion?.speedPcPerSec ?? 0),
      }),
      createValueReadout('radio-bubble-distance', {
        label: 'Distance to Sun',
        value: formatDistancePc(distancePc),
      }),
    ],
    actionChildren: [
      createButton('radio-bubble-look-sun', {
        label: 'Look at Sun',
        actionId: 'camera.look-sun',
      }),
      createButton('radio-bubble-fly-sun', {
        label: 'Fly to Sun',
        actionId: 'camera.fly-sun',
      }),
      createTouchOsFullscreenButton('radio-bubble-fullscreen'),
    ],
  });
}

magLimitInput?.addEventListener('change', () => {
  const parsed = Number(magLimitInput.value);
  if (!Number.isFinite(parsed)) {
    magLimitInput.value = String(activeMagLimit);
    return;
  }
  activeMagLimit = parsed;
  if (!viewer) {
    return;
  }
  viewer.setState({ mDesired: activeMagLimit });
  viewer.refreshSelection().catch((error) => {
    console.error('[radio-bubble] mag limit update failed', error);
  });
});

window.addEventListener('beforeunload', () => {
  viewer?.dispose().catch((error) => {
    console.error('[radio-bubble] cleanup failed', error);
  });
});

mountViewer().catch((error) => {
  if (statusValue) {
    statusValue.textContent = 'error';
  }
  console.error('[radio-bubble] initial mount failed', error);
});
