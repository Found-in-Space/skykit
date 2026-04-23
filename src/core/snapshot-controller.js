function cloneValue(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeSnapshot(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return cloneValue(value);
}

function normalizeEvent(event, snapshot) {
  if (!event || typeof event !== 'object') {
    throw new TypeError('event must be an object');
  }

  if (typeof event.type !== 'string' || !event.type.trim()) {
    throw new TypeError('event.type must be a non-empty string');
  }

  return {
    ...cloneValue(event),
    type: event.type.trim(),
    timeMs: Number.isFinite(event.timeMs) ? Number(event.timeMs) : Date.now(),
    snapshot: snapshot ?? null,
  };
}

function normalizeCommand(command) {
  if (!command || typeof command !== 'object') {
    throw new TypeError('command must be an object');
  }

  if (typeof command.type !== 'string' || !command.type.trim()) {
    throw new TypeError('command.type must be a non-empty string');
  }

  return {
    ...command,
    type: command.type.trim(),
  };
}

export function createSnapshotController(options = {}) {
  let snapshot = normalizeSnapshot(options.initialSnapshot);
  const listeners = new Set();
  const commandHandlers = new Map();
  const hookHandlers = new Map();

  function getSnapshot() {
    return cloneValue(snapshot);
  }

  function select(selector) {
    if (typeof selector === 'function') {
      return selector(snapshot);
    }

    if (typeof selector === 'string' && selector.trim()) {
      return snapshot?.[selector];
    }

    return snapshot;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function emit(event) {
    const normalized = normalizeEvent(event, getSnapshot());

    for (const listener of listeners) {
      try {
        listener(normalized);
      } catch (error) {
        console.error('[SnapshotController] event listener failed', error);
      }
    }

    return normalized;
  }

  function setSnapshot(nextSnapshot, meta = {}) {
    snapshot = normalizeSnapshot(nextSnapshot);
    emit({
      type: meta.type ?? 'state/changed',
      commandType: meta.commandType ?? null,
      reason: meta.reason ?? null,
      detail: meta.detail ?? null,
    });
    return getSnapshot();
  }

  function updateSnapshot(updater, meta = {}) {
    const currentSnapshot = getSnapshot();
    const nextSnapshot = typeof updater === 'function'
      ? updater(currentSnapshot)
      : updater;
    return setSnapshot(nextSnapshot, meta);
  }

  function addCommandHandler(type, handler) {
    if (typeof type !== 'string' || !type.trim()) {
      throw new TypeError('command type must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('command handler must be a function');
    }

    const normalizedType = type.trim();
    const handlers = commandHandlers.get(normalizedType) ?? [];
    handlers.push(handler);
    commandHandlers.set(normalizedType, handlers);

    return () => {
      const currentHandlers = commandHandlers.get(normalizedType) ?? [];
      const nextHandlers = currentHandlers.filter((entry) => entry !== handler);
      if (nextHandlers.length > 0) {
        commandHandlers.set(normalizedType, nextHandlers);
      } else {
        commandHandlers.delete(normalizedType);
      }
    };
  }

  function registerHook(name, handler) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new TypeError('hook name must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('hook handler must be a function');
    }

    const normalizedName = name.trim();
    const handlers = hookHandlers.get(normalizedName) ?? [];
    handlers.push(handler);
    hookHandlers.set(normalizedName, handlers);

    return () => {
      const currentHandlers = hookHandlers.get(normalizedName) ?? [];
      const nextHandlers = currentHandlers.filter((entry) => entry !== handler);
      if (nextHandlers.length > 0) {
        hookHandlers.set(normalizedName, nextHandlers);
      } else {
        hookHandlers.delete(normalizedName);
      }
    };
  }

  async function runHook(name, value, context = {}) {
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const handlers = normalizedName ? (hookHandlers.get(normalizedName) ?? []) : [];
    let currentValue = value;

    for (const handler of handlers) {
      const nextValue = await handler(currentValue, {
        ...context,
        dispatch,
        getSnapshot,
        select,
        subscribe,
      });
      if (nextValue !== undefined) {
        currentValue = nextValue;
      }
    }

    return currentValue;
  }

  function registerPlugin(plugin) {
    if (!plugin || typeof plugin !== 'object') {
      throw new TypeError('plugin must be an object');
    }

    const setup = typeof plugin.setup === 'function'
      ? plugin.setup.bind(plugin)
      : null;

    if (!setup) {
      throw new TypeError('plugin.setup must be a function');
    }

    return setup({
      dispatch,
      getSnapshot,
      select,
      subscribe,
      registerHook,
    });
  }

  async function dispatch(command) {
    const normalizedCommand = normalizeCommand(command);
    emit({
      type: 'command/dispatched',
      command: normalizedCommand,
    });

    const handlers = commandHandlers.get(normalizedCommand.type) ?? [];
    if (handlers.length === 0) {
      emit({
        type: 'diagnostic/warn',
        code: 'unknown-command',
        command: normalizedCommand,
      });
      return {
        handled: false,
        result: null,
        snapshot: getSnapshot(),
      };
    }

    let result = null;
    try {
      for (const handler of handlers) {
        const nextResult = await handler({
          command: normalizedCommand,
          dispatch,
          emit,
          getSnapshot,
          select,
          setSnapshot,
          updateSnapshot,
          runHook,
          registerHook,
        });
        if (nextResult !== undefined) {
          result = nextResult;
        }
      }

      emit({
        type: 'command/completed',
        command: normalizedCommand,
        result,
      });
      return {
        handled: true,
        result,
        snapshot: getSnapshot(),
      };
    } catch (error) {
      emit({
        type: 'command/failed',
        command: normalizedCommand,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  if (options.commandHandlers && typeof options.commandHandlers === 'object') {
    for (const [type, handler] of Object.entries(options.commandHandlers)) {
      if (Array.isArray(handler)) {
        for (const entry of handler) {
          addCommandHandler(type, entry);
        }
      } else if (typeof handler === 'function') {
        addCommandHandler(type, handler);
      }
    }
  }

  return {
    dispatch,
    emit,
    getSnapshot,
    select,
    subscribe,
    setSnapshot,
    updateSnapshot,
    addCommandHandler,
    registerHook,
    runHook,
    registerPlugin,
  };
}
