import {
  createDataset,
  createDefaultViewer,
  createJourneyController,
  createJourneyGraph,
  createSnapshotController,
  queryNearestStars,
  queryVisibleStars,
  type DatasetCommand,
  type DatasetEvent,
  type DatasetSnapshot,
  type JourneyResolvedSceneSpec,
  type SkyKitBuiltinHookMap,
  type SkyKitCommand,
  type SkyKitEvent,
} from '@found-in-space/skykit';

type AppCommand = SkyKitCommand<'app/preload', { scope: string }, { queued: boolean }>;
type AppEvent = SkyKitEvent<'app/queued', { scope: string }, DatasetSnapshot>;
type AppHooks = SkyKitBuiltinHookMap<DatasetSnapshot, DatasetCommand | AppCommand, DatasetEvent<AppEvent>>;
type AppScene = JourneyResolvedSceneSpec<AppCommand>;

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
}

void verifyRootConsumer;
