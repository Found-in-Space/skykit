import { createSnapshotController } from '../core/snapshot-controller.js';

function cloneSceneSpec(spec = {}) {
  return {
    ...spec,
  };
}

function createTransitionKey(fromSceneId, toSceneId) {
  return `${fromSceneId}->${toSceneId}`;
}

export function createJourneyGraph({
  initialSceneId = null,
  scenes = {},
  transitions = [],
} = {}) {
  const sceneMap = new Map(
    Object.entries(scenes).map(([sceneId, scene]) => [
      sceneId,
      {
        ...cloneSceneSpec(scene),
        sceneId,
      },
    ]),
  );

  const transitionList = transitions.map((transition) => {
    const fromSceneId = transition.fromSceneId ?? transition.from;
    const toSceneId = transition.toSceneId ?? transition.to;
    if (typeof fromSceneId !== 'string' || typeof toSceneId !== 'string') {
      throw new TypeError('Journey transitions require string fromSceneId/toSceneId values.');
    }

    return {
      ...cloneSceneSpec(transition),
      id: transition.id ?? createTransitionKey(fromSceneId, toSceneId),
      fromSceneId,
      toSceneId,
    };
  });

  const transitionMap = new Map(
    transitionList.map((transition) => [
      createTransitionKey(transition.fromSceneId, transition.toSceneId),
      transition,
    ]),
  );

  function getScene(sceneId) {
    return sceneMap.get(sceneId) ?? null;
  }

  function getTransition(fromSceneId, toSceneId) {
    if (typeof fromSceneId !== 'string' || typeof toSceneId !== 'string') {
      return null;
    }
    return transitionMap.get(createTransitionKey(fromSceneId, toSceneId)) ?? null;
  }

  function resolve(toSceneId, { fromSceneId = null } = {}) {
    const scene = getScene(toSceneId);
    if (!scene) {
      return null;
    }

    const transition = getTransition(fromSceneId, toSceneId);
    const resolved = {
      ...cloneSceneSpec(scene),
      ...(transition ? cloneSceneSpec(transition) : {}),
      sceneId: toSceneId,
    };

    if (transition) {
      resolved.transitionId = transition.id;
      resolved.fromSceneId = transition.fromSceneId;
      resolved.toSceneId = transition.toSceneId;
    }

    return resolved;
  }

  function listResolvedTransitionSpecs() {
    return transitionList
      .map((transition) =>
        resolve(transition.toSceneId, { fromSceneId: transition.fromSceneId }))
      .filter(Boolean);
  }

  return {
    initialSceneId,
    getScene,
    getTransition,
    resolveSceneSpec: resolve,
    listResolvedTransitionSpecs,
    sceneIds: [...sceneMap.keys()],
    transitions: transitionList,
  };
}

export function resolveSceneSpec(graph, sceneId, fromSceneId = null) {
  if (!graph || typeof graph.resolveSceneSpec !== 'function') {
    throw new TypeError('resolveSceneSpec() requires a journey graph');
  }

  return graph.resolveSceneSpec(sceneId, { fromSceneId });
}

function buildSceneCommands(scene, context = {}) {
  if (Array.isArray(scene?.commands) && scene.commands.length > 0) {
    return scene.commands.map((command) => ({
      ...command,
      sceneId: scene.sceneId,
      fromSceneId: context.fromSceneId ?? null,
      source: context.source ?? null,
    }));
  }

  return [{
    type: 'journey/apply-scene',
    scene,
    sceneId: scene?.sceneId ?? null,
    fromSceneId: context.fromSceneId ?? null,
    transitionId: scene?.transitionId ?? null,
    source: context.source ?? null,
  }];
}

export function createJourneyController(options = {}) {
  const graph = options.graph;
  if (!graph || typeof graph.resolveSceneSpec !== 'function') {
    throw new TypeError('createJourneyController() requires a journey graph');
  }

  const applyScene = typeof options.applyScene === 'function' ? options.applyScene : null;
  const externalDispatch = typeof options.dispatch === 'function' ? options.dispatch : null;
  if (!applyScene && !externalDispatch) {
    throw new TypeError('createJourneyController() requires a dispatch or applyScene function');
  }

  const controller = createSnapshotController({
    initialSnapshot: {
      journey: {
        activeSceneId: graph.initialSceneId ?? null,
        previousSceneId: null,
        transitionId: null,
        lastSource: 'init',
      },
    },
  });

  controller.addCommandHandler('journey/go-to-scene', async ({
    command,
    emit,
    getSnapshot,
    setSnapshot,
  }) => {
    const previousSceneId = command.fromSceneId
      ?? getSnapshot().journey?.activeSceneId
      ?? null;
    const nextSceneId = typeof command.sceneId === 'string'
      ? command.sceneId
      : command.toSceneId;
    const scene = graph.resolveSceneSpec(nextSceneId, { fromSceneId: previousSceneId });
    if (!scene) {
      throw new Error(`Unknown journey scene "${nextSceneId}"`);
    }

    if (previousSceneId) {
      emit({
        type: 'journey/scene-exited',
        sceneId: previousSceneId,
        toSceneId: scene.sceneId,
        source: command.source ?? null,
      });
    }

    const sceneCommands = buildSceneCommands(scene, {
      fromSceneId: previousSceneId,
      source: command.source ?? null,
    });
    for (const sceneCommand of sceneCommands) {
      if (externalDispatch) {
        await externalDispatch(sceneCommand);
      } else {
        await applyScene(scene, sceneCommand);
      }
    }

    setSnapshot({
      journey: {
        activeSceneId: scene.sceneId,
        previousSceneId,
        transitionId: scene.transitionId ?? null,
        lastSource: command.source ?? null,
      },
    }, {
      commandType: command.type,
      reason: 'journey-scene-changed',
    });

    emit({
      type: 'journey/scene-entered',
      sceneId: scene.sceneId,
      fromSceneId: previousSceneId,
      transitionId: scene.transitionId ?? null,
      source: command.source ?? null,
      scene,
    });

    return scene;
  });

  const api = {
    graph,
    dispatch: controller.dispatch,
    emit: controller.emit,
    getSnapshot: controller.getSnapshot,
    select: controller.select,
    subscribe: controller.subscribe,
    registerHook: controller.registerHook,
    registerPlugin: controller.registerPlugin,
    resolveSceneSpec(sceneId, fromSceneId = null) {
      return graph.resolveSceneSpec(sceneId, { fromSceneId });
    },
    activateScene(sceneId, options = {}) {
      return controller.dispatch({
        type: 'journey/go-to-scene',
        sceneId,
        ...options,
      }).then((result) => result.result);
    },
  };

  if (graph.initialSceneId && options.autoInitialize !== false) {
    void api.activateScene(graph.initialSceneId, {
      source: 'init',
    }).catch((error) => {
      console.error('[JourneyController] initial scene activation failed', error);
    });
  }

  return api;
}
