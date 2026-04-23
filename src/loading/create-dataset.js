import { DatasetSession, getDatasetSession } from '../core/dataset-session.js';
import { createSnapshotController } from '../core/snapshot-controller.js';
import { createFoundInSpaceDatasetOptions } from '../found-in-space-dataset.js';

function resolveDatasetSession(input = {}) {
  if (input instanceof DatasetSession) {
    return input;
  }

  if (input?.session instanceof DatasetSession) {
    return input.session;
  }

  if (input?.datasetSession instanceof DatasetSession) {
    return input.datasetSession;
  }

  return getDatasetSession(createFoundInSpaceDatasetOptions(input));
}

function buildDatasetSnapshot(session, loading = {}) {
  return {
    kind: 'dataset',
    dataset: session.describe(),
    loading: {
      bootstrap: loading.bootstrap ?? 'idle',
      rootShard: loading.rootShard ?? 'idle',
    },
  };
}

export function createDataset(options = {}) {
  const session = resolveDatasetSession(options);
  let loadingState = {
    bootstrap: 'idle',
    rootShard: 'idle',
  };

  const controller = createSnapshotController({
    initialSnapshot: buildDatasetSnapshot(session, loadingState),
  });

  function syncSnapshot(meta = {}) {
    controller.setSnapshot(
      buildDatasetSnapshot(session, loadingState),
      {
        type: meta.type ?? 'state/changed',
        commandType: meta.commandType ?? null,
        reason: meta.reason ?? null,
      },
    );
  }

  controller.addCommandHandler('dataset/refresh', async ({ command }) => {
    syncSnapshot({
      commandType: command.type,
      reason: 'dataset-refreshed',
    });
    return session.describe();
  });

  controller.addCommandHandler('dataset/ensure-bootstrap', async ({ command, emit }) => {
    loadingState = {
      ...loadingState,
      bootstrap: 'loading',
    };
    syncSnapshot({
      type: 'loading/changed',
      commandType: command.type,
      reason: 'bootstrap-loading',
    });
    emit({
      type: 'loading/started',
      stage: 'bootstrap',
    });

    const bootstrap = await session.ensureRenderBootstrap();
    loadingState = {
      ...loadingState,
      bootstrap: 'ready',
    };
    syncSnapshot({
      type: 'loading/changed',
      commandType: command.type,
      reason: 'bootstrap-ready',
    });
    emit({
      type: 'loading/completed',
      stage: 'bootstrap',
      dataset: session.describe(),
    });
    return bootstrap;
  });

  controller.addCommandHandler('dataset/ensure-root-shard', async ({ command, emit }) => {
    loadingState = {
      ...loadingState,
      rootShard: 'loading',
    };
    syncSnapshot({
      type: 'loading/changed',
      commandType: command.type,
      reason: 'root-shard-loading',
    });
    emit({
      type: 'loading/started',
      stage: 'root-shard',
    });

    const rootShard = await session.ensureRenderRootShard();
    loadingState = {
      ...loadingState,
      rootShard: 'ready',
    };
    syncSnapshot({
      type: 'loading/changed',
      commandType: command.type,
      reason: 'root-shard-ready',
    });
    emit({
      type: 'loading/completed',
      stage: 'root-shard',
      dataset: session.describe(),
    });
    return rootShard;
  });

  controller.addCommandHandler('dataset/dispose', async ({ command, emit }) => {
    session.dispose();
    syncSnapshot({
      commandType: command.type,
      reason: 'dataset-disposed',
    });
    emit({
      type: 'dataset/disposed',
      dataset: session.describe(),
    });
    return true;
  });

  return {
    session,
    dispatch: controller.dispatch,
    emit: controller.emit,
    getSnapshot: controller.getSnapshot,
    select: controller.select,
    subscribe: controller.subscribe,
    registerHook: controller.registerHook,
    registerPlugin: controller.registerPlugin,
    describe() {
      return session.describe();
    },
    ensureBootstrap() {
      return controller.dispatch({ type: 'dataset/ensure-bootstrap' }).then((result) => result.result);
    },
    ensureRootShard() {
      return controller.dispatch({ type: 'dataset/ensure-root-shard' }).then((result) => result.result);
    },
    getRenderService() {
      return session.getRenderService();
    },
    getSidecarService(name) {
      return session.getSidecarService(name);
    },
    resolveStarById(starDataId, datasetOptions = {}) {
      return session.resolveStarById(starDataId, datasetOptions);
    },
    resolveSidecarMetaByStarId(name, starDataId) {
      return session.resolveSidecarMetaByStarId(name, starDataId);
    },
    dispose() {
      return controller.dispatch({ type: 'dataset/dispose' }).then(() => undefined);
    },
  };
}

export function unwrapDatasetSession(value) {
  if (value instanceof DatasetSession) {
    return value;
  }

  if (value?.session instanceof DatasetSession) {
    return value.session;
  }

  if (value?.datasetSession instanceof DatasetSession) {
    return value.datasetSession;
  }

  return null;
}
