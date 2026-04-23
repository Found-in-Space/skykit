import { DatasetSession, getDatasetSession } from '../core/dataset-session.js';
import { ViewerRuntime } from '../core/viewer-runtime.js';

function unwrapDatasetSession(value) {
  if (value instanceof DatasetSession) {
    return value;
  }

  if (value?.session instanceof DatasetSession) {
    return value.session;
  }

  if (value?.datasetSession instanceof DatasetSession) {
    return value.datasetSession;
  }

  return value ?? null;
}

function resolveDatasetSession(options) {
  const directSession = unwrapDatasetSession(options.datasetSession);
  if (directSession instanceof DatasetSession) {
    return directSession;
  }

  const datasetSession = unwrapDatasetSession(options.dataset);
  if (datasetSession instanceof DatasetSession) {
    return datasetSession;
  }

  if (options.datasetOptions) {
    return getDatasetSession(options.datasetOptions);
  }

  return null;
}

function createViewerHandle(runtime) {
  return {
    runtime,
    camera: runtime.camera,
    canvas: runtime.canvas,
    datasetSession: runtime.datasetSession,
    mount: runtime.mount,
    contentRoot: runtime.contentRoot,
    navigationRoot: runtime.navigationRoot,
    cameraMount: runtime.cameraMount,
    attachmentRoot: runtime.attachmentRoot,
    deck: runtime.deck,
    rigType: runtime.rigType,
    start: () => runtime.start(),
    stop: () => runtime.stop(),
    isXrModeSupported: (mode) => runtime.isXrModeSupported(mode),
    enterXR: (options) => runtime.enterXR(options),
    exitXR: () => runtime.exitXR(),
    resize: (widthOrSize, height) => runtime.resize(widthOrSize, height),
    refreshSelection: () => runtime.refreshSelection(),
    setState: (nextState) => runtime.setState(nextState),
    getSnapshotState: () => runtime.getSnapshotState(),
    getSnapshot: () => runtime.getSnapshot(),
    dispatch: (command) => runtime.dispatch(command),
    select: (selector) => runtime.select(selector),
    subscribe: (listener) => runtime.subscribe(listener),
    dispose: () => runtime.dispose(),
  };
}

export async function createViewer(host, options = {}) {
  const runtime = new ViewerRuntime({
    ...options,
    host,
    datasetSession: resolveDatasetSession(options),
  });

  await runtime.initialize();
  return createViewerHandle(runtime);
}
