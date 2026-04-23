import { ORION_NEBULA_PC, createSceneOrientationTransforms } from '@found-in-space/skykit/coords';
import { createFoundInSpaceDataset } from '@found-in-space/skykit/loading';
import { buildPolylineRoute, createCameraRig } from '@found-in-space/skykit/movement';
import {
  createDesktopExplorerPreset,
  createJourneyGraph,
  createViewerJourneyController,
  type ViewerJourneySceneInput,
} from '@found-in-space/skykit/presets';
import { queryVisibleStars } from '@found-in-space/skykit/query';
import { HRDiagramRenderer, createVolumeHRLoader } from '@found-in-space/skykit/render2d';
import { ViewerRuntime, createViewer } from '@found-in-space/skykit/render3d';

const dataset = createFoundInSpaceDataset();
const transforms = createSceneOrientationTransforms(ORION_NEBULA_PC);
const rig = createCameraRig({
  positionPc: ORION_NEBULA_PC,
});
const route = buildPolylineRoute([
  { x: 0, y: 0, z: 0 },
  ORION_NEBULA_PC,
]);

const journeyScenes = {
  intro: {
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: ORION_NEBULA_PC,
    state: { targetPc: ORION_NEBULA_PC },
  },
  roam: {
    type: 'free-roam',
    observerPc: ORION_NEBULA_PC,
    lookAtPc: { x: 0, y: 0, z: 0 },
  },
} satisfies Record<string, ViewerJourneySceneInput>;

const graph = createJourneyGraph({
  initialSceneId: 'intro',
  scenes: journeyScenes,
  transitions: [{ fromSceneId: 'intro', toSceneId: 'roam', id: 'intro-roam' }],
});

const host = document.createElement('div');
const explorer = createDesktopExplorerPreset({
  observerPc: ORION_NEBULA_PC,
  navigationHud: true,
});
const viewerPromise = createViewer(host, explorer);

async function verifySubpaths() {
  await dataset.ensureRootShard();
  await dataset.ensureBootstrap();

  await queryVisibleStars(dataset, {
    observerPc: ORION_NEBULA_PC,
  });

  const viewer = await viewerPromise;
  const snapshot = viewer.getSnapshot();
  const journey = createViewerJourneyController({
    graph,
    autoInitialize: false,
    viewer,
    cameraController: explorer.cameraController,
  });
  const activeScene = await journey.activateScene('intro');
  const runtime = new ViewerRuntime({
    host,
  });
  const renderer = new HRDiagramRenderer(document.createElement('canvas'));
  const loader = createVolumeHRLoader();

  void transforms;
  void rig;
  void route;
  void graph;
  void activeScene;
  void snapshot;
  void runtime;
  void renderer;
  void loader;
}

void verifySubpaths;
