import {
  createDesktopExplorerPreset,
  createDataset,
  createDefaultViewer,
  createJourneyController,
  createJourneyGraph,
  createSnapshotController,
  createViewer,
  createViewerJourneyController,
  queryNearestStars,
  queryVisibleStars,
  type DatasetCommand,
  type DatasetEvent,
  type DatasetSnapshot,
  type JourneyResolvedSceneSpec,
  type SkyKitBuiltinHookMap,
  type SkyKitCommand,
  type SkyKitEvent,
  type ViewerJourneySceneInput,
  type ViewerJourneySceneSpec,
} from '@found-in-space/skykit';

type AppCommand = SkyKitCommand<'app/preload', { scope: string }, { queued: boolean }>;
type AppEvent = SkyKitEvent<'app/queued', { scope: string }, DatasetSnapshot>;
type AppHooks = SkyKitBuiltinHookMap<DatasetSnapshot, DatasetCommand | AppCommand, DatasetEvent<AppEvent>>;
type AppScene = JourneyResolvedSceneSpec<AppCommand>;
type TourSceneInput = ViewerJourneySceneInput<AppCommand>;
type TourScene = ViewerJourneySceneSpec<AppCommand>;

const dataset = createDataset<AppCommand, AppEvent, AppHooks>();
const datasetDescription = dataset.describe();
const datasetVersionKey: string = datasetDescription.versionKey;

dataset.registerHook('selection:resolve', (selection, api) => {
  api.getSnapshot().dataset.versionKey;
  return selection;
});

dataset.subscribe((event) => {
  if (event.type === 'loading/completed') {
    const datasetId: string = event.dataset.id;
    void datasetId;
  }
});

const sceneGraph = createJourneyGraph<AppCommand>({
  initialSceneId: 'overview',
  scenes: {
    overview: {
      commands: [{ type: 'app/preload', scope: 'overview' }],
    },
    detail: {},
  },
  transitions: [
    { fromSceneId: 'overview', toSceneId: 'detail', id: 'overview-detail' },
  ],
});

const journey = createJourneyController<AppScene, AppCommand>({
  graph: sceneGraph,
  autoInitialize: false,
  dispatch: async (command) => {
    if (command.type === 'app/preload') {
      return { queued: command.scope.length > 0 };
    }
    return undefined;
  },
});

const controller = createSnapshotController<DatasetSnapshot, AppCommand, DatasetEvent<AppEvent>, AppHooks>({
  initialSnapshot: dataset.getSnapshot(),
});

controller.addCommandHandler('app/preload', async ({ command }) => {
  return { queued: command.scope.length > 0 };
});

async function verifyRootConsumer() {
  const refreshResult = await dataset.dispatch({ type: 'dataset/refresh' });
  const refreshedVersion: string | undefined = refreshResult.result?.versionKey;
  void refreshedVersion;

  const nearest = await queryNearestStars(dataset, {
    centerPc: { x: 0, y: 0, z: 0 },
    count: 10,
  });
  const firstNearest = nearest.stars[0];
  if (firstNearest) {
    const absoluteMagnitude: number = firstNearest.absoluteMagnitude;
    void absoluteMagnitude;
  }

  const visible = await queryVisibleStars(dataset, {
    observerPc: { x: 0, y: 0, z: 0 },
    strategy: 'observer-shell',
  });
  const selectedStrategy: string = visible.strategy;
  void selectedStrategy;

  const sceneResult = await journey.dispatch({
    type: 'journey/go-to-scene',
    sceneId: 'overview',
    source: 'test',
  });
  const activeSceneId: string | undefined = sceneResult.result?.sceneId;
  void activeSceneId;

  const host = document.createElement('div');
  const viewer = await createDefaultViewer(host);
  const startResult = await viewer.dispatch({ type: 'viewer/start' });
  const running: boolean | undefined = startResult.result?.running;
  void running;

  const resizeResult = await viewer.dispatch({
    type: 'viewer/resize',
    size: {
      width: 640,
      height: 360,
    },
  });
  const resizeWidth: number | undefined = resizeResult.result?.width;
  void resizeWidth;

  const explorer = createDesktopExplorerPreset({
    navigationHud: true,
    picking: true,
  });
  const modularViewer = await createViewer(document.createElement('div'), explorer);
  const modularSnapshot = modularViewer.getSnapshot();
  const modularSelectionStrategy: string | null = modularSnapshot.selection.strategy;
  void modularSelectionStrategy;

  const tourScenes: Record<string, TourSceneInput> = {
    overview: {
      commands: [{ type: 'app/preload', scope: 'tour' }],
      observerPc: { x: 0, y: 0, z: 0 },
      lookAtPc: { x: 0, y: 0, z: -1 },
      state: { mDesired: 7.5 },
    },
    freeRoam: {
      type: 'free-roam',
      observerPc: { x: 1, y: 2, z: 3 },
      lookAtPc: { x: 0, y: 0, z: 0 },
    },
  };

  const viewerJourneyGraph = createJourneyGraph<AppCommand>({
    initialSceneId: 'overview',
    scenes: tourScenes,
    transitions: [{ fromSceneId: 'overview', toSceneId: 'freeRoam', id: 'overview-free-roam' }],
  });

  const viewerJourney = createViewerJourneyController<TourScene, AppCommand>({
    graph: viewerJourneyGraph,
    autoInitialize: false,
    viewer: modularViewer,
    cameraController: explorer.cameraController,
    dispatch: async (command) => {
      if (command.type === 'app/preload') {
        return { queued: command.scope.length > 0 };
      }
      return undefined;
    },
  });

  const enteredScene = await viewerJourney.activateScene('overview');
  const enteredSceneId: string | null = enteredScene?.sceneId ?? null;
  void enteredSceneId;
}

void verifyRootConsumer;
