import { ORION_NEBULA_PC, createSceneOrientationTransforms } from '@found-in-space/skykit/coords';
import { createDataset } from '@found-in-space/skykit/loading';
import { buildPolylineRoute, createCameraRig } from '@found-in-space/skykit/movement';
import { createJourneyGraph } from '@found-in-space/skykit/presets';
import { queryVisibleStars } from '@found-in-space/skykit/query';
import { HRDiagramRenderer, createVolumeHRLoader } from '@found-in-space/skykit/render2d';
import { ViewerRuntime, createViewer } from '@found-in-space/skykit/render3d';

const dataset = createDataset();
const transforms = createSceneOrientationTransforms(ORION_NEBULA_PC);
const rig = createCameraRig({
  positionPc: ORION_NEBULA_PC,
});
const route = buildPolylineRoute([
  { x: 0, y: 0, z: 0 },
  ORION_NEBULA_PC,
]);

const graph = createJourneyGraph({
  initialSceneId: 'intro',
  scenes: {
    intro: {},
  },
});

const host = document.createElement('div');
const viewerPromise = createViewer(host, {
  state: {
    observerPc: ORION_NEBULA_PC,
  },
});

async function verifySubpaths() {
  await queryVisibleStars(dataset, {
    observerPc: ORION_NEBULA_PC,
  });

  const viewer = await viewerPromise;
  const snapshot = viewer.getSnapshot();
  const runtime = new ViewerRuntime({
    host,
  });
  const renderer = new HRDiagramRenderer(document.createElement('canvas'));
  const loader = createVolumeHRLoader();

  void transforms;
  void rig;
  void route;
  void graph;
  void snapshot;
  void runtime;
  void renderer;
  void loader;
}

void verifySubpaths;
