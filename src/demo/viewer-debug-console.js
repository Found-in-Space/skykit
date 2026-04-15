const GALACTIC_TO_ICRS_ROTATION = [
  [-0.0548755604, +0.4941094279, -0.8676661490],
  [-0.8734370902, -0.4448296300, -0.1980763734],
  [-0.4838350155, +0.7469822445, +0.4559837762],
];

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function icrsToGalactic(point) {
  if (!point) {
    return null;
  }
  return {
    x: GALACTIC_TO_ICRS_ROTATION[0][0] * point.x
      + GALACTIC_TO_ICRS_ROTATION[1][0] * point.y
      + GALACTIC_TO_ICRS_ROTATION[2][0] * point.z,
    y: GALACTIC_TO_ICRS_ROTATION[0][1] * point.x
      + GALACTIC_TO_ICRS_ROTATION[1][1] * point.y
      + GALACTIC_TO_ICRS_ROTATION[2][1] * point.z,
    z: GALACTIC_TO_ICRS_ROTATION[0][2] * point.x
      + GALACTIC_TO_ICRS_ROTATION[1][2] * point.y
      + GALACTIC_TO_ICRS_ROTATION[2][2] * point.z,
  };
}

function galacticToIcrs(point) {
  if (!point) {
    return null;
  }
  return {
    x: GALACTIC_TO_ICRS_ROTATION[0][0] * point.x
      + GALACTIC_TO_ICRS_ROTATION[0][1] * point.y
      + GALACTIC_TO_ICRS_ROTATION[0][2] * point.z,
    y: GALACTIC_TO_ICRS_ROTATION[1][0] * point.x
      + GALACTIC_TO_ICRS_ROTATION[1][1] * point.y
      + GALACTIC_TO_ICRS_ROTATION[1][2] * point.z,
    z: GALACTIC_TO_ICRS_ROTATION[2][0] * point.x
      + GALACTIC_TO_ICRS_ROTATION[2][1] * point.y
      + GALACTIC_TO_ICRS_ROTATION[2][2] * point.z,
  };
}

function normalizeTargetPoint(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    return { x, y, z };
  }
  return null;
}

function parseTargetArgs(argsLike) {
  const args = Array.from(argsLike);
  if (args.length === 0) {
    return { targetPc: null, options: {} };
  }

  if (typeof args[0] === 'object' && args[0] != null) {
    return {
      targetPc: normalizeTargetPoint(args[0]),
      options: args[1] && typeof args[1] === 'object' ? { ...args[1] } : {},
    };
  }

  return {
    targetPc: normalizeTargetPoint({ x: args[0], y: args[1], z: args[2] }),
    options: args[3] && typeof args[3] === 'object' ? { ...args[3] } : {},
  };
}

function findNavigationController(viewer) {
  for (const controller of Array.from(viewer?.runtime?.controllers ?? [])) {
    if (
      controller
      && (
        typeof controller.flyTo === 'function'
        || typeof controller.lookAt === 'function'
        || typeof controller.cancelAutomation === 'function'
      )
    ) {
      return controller;
    }
  }
  return null;
}

function queueRefreshSelection(viewer) {
  if (typeof viewer?.refreshSelection !== 'function') {
    return;
  }

  Promise.resolve()
    .then(() => viewer.refreshSelection())
    .catch(() => {
      // The debug console should stay non-fatal if a demo lacks selection wiring.
    });
}

function createEntryApi(entry) {
  return {
    id: entry.id,
    label: entry.label,
    get rigType() {
      return entry.viewer?.rigType ?? entry.viewer?.runtime?.rigType ?? null;
    },
    getSnapshotState() {
      return entry.viewer?.getSnapshotState?.() ?? null;
    },
    getObserverPc() {
      const snapshotPc = entry.viewer?.getSnapshotState?.()?.state?.observerPc ?? null;
      if (snapshotPc) {
        return clonePoint(snapshotPc);
      }
      const statsPc = entry.navigationController?.getStats?.()?.observerPc ?? null;
      return clonePoint(statsPc);
    },
    getGalacticPc() {
      return icrsToGalactic(this.getObserverPc());
    },
    setObserverPc(...args) {
      const { targetPc } = parseTargetArgs(args);
      if (!targetPc) {
        throw new TypeError('setObserverPc requires finite x, y, z parsec coordinates.');
      }
      entry.viewer?.setState?.({ observerPc: targetPc });
      queueRefreshSelection(entry.viewer);
      return clonePoint(targetPc);
    },
    setGalacticPc(...args) {
      const { targetPc } = parseTargetArgs(args);
      if (!targetPc) {
        throw new TypeError('setGalacticPc requires finite x, y, z parsec coordinates.');
      }
      const icrsTargetPc = galacticToIcrs(targetPc);
      entry.viewer?.setState?.({ observerPc: icrsTargetPc });
      queueRefreshSelection(entry.viewer);
      return clonePoint(targetPc);
    },
    flyToPc(...args) {
      const { targetPc, options } = parseTargetArgs(args);
      if (!targetPc) {
        throw new TypeError('flyToPc requires finite x, y, z parsec coordinates.');
      }

      if (typeof entry.navigationController?.flyTo === 'function') {
        const userOnArrive = typeof options.onArrive === 'function' ? options.onArrive : null;
        entry.navigationController.flyTo(targetPc, {
          ...options,
          onArrive() {
            queueRefreshSelection(entry.viewer);
            userOnArrive?.();
          },
        });
      } else {
        entry.viewer?.setState?.({ observerPc: targetPc });
        queueRefreshSelection(entry.viewer);
      }

      return clonePoint(targetPc);
    },
    flyToGalacticPc(...args) {
      const { targetPc, options } = parseTargetArgs(args);
      if (!targetPc) {
        throw new TypeError('flyToGalacticPc requires finite x, y, z parsec coordinates.');
      }
      const icrsTargetPc = galacticToIcrs(targetPc);
      this.flyToPc(icrsTargetPc, options);
      return clonePoint(targetPc);
    },
    lookAtPc(...args) {
      const { targetPc, options } = parseTargetArgs(args);
      if (!targetPc) {
        throw new TypeError('lookAtPc requires finite x, y, z parsec coordinates.');
      }

      if (typeof entry.navigationController?.lookAt === 'function') {
        entry.navigationController.lookAt(targetPc, options);
      } else {
        entry.viewer?.setState?.({ targetPc });
      }

      return clonePoint(targetPc);
    },
    lookAtGalacticPc(...args) {
      const { targetPc, options } = parseTargetArgs(args);
      if (!targetPc) {
        throw new TypeError('lookAtGalacticPc requires finite x, y, z parsec coordinates.');
      }
      const icrsTargetPc = galacticToIcrs(targetPc);
      this.lookAtPc(icrsTargetPc, options);
      return clonePoint(targetPc);
    },
    cancelAutomation() {
      entry.navigationController?.cancelAutomation?.();
      return true;
    },
  };
}

function createRegistryState() {
  return {
    entries: [],
    nextAutoId: 1,
    activeId: null,
  };
}

let registryState = createRegistryState();
const WRAPPED_DISPOSE = Symbol('demoViewerDebugWrappedDispose');

function listEntryMetadata(entries, activeId) {
  return entries.map((entry, index) => ({
    index,
    id: entry.id,
    label: entry.label,
    rigType: entry.api.rigType,
    active: entry.id === activeId,
    canFlyTo: typeof entry.navigationController?.flyTo === 'function',
    canLookAt: typeof entry.navigationController?.lookAt === 'function',
  }));
}

function resolveEntry(target, requireActive = false) {
  if (registryState.entries.length === 0) {
    return null;
  }

  if (target == null) {
    const active = registryState.entries.find((entry) => entry.id === registryState.activeId) ?? null;
    if (active || !requireActive) {
      return active;
    }
    return registryState.entries[0] ?? null;
  }

  if (typeof target === 'number' && Number.isInteger(target)) {
    return registryState.entries[target] ?? null;
  }

  if (typeof target === 'string') {
    return registryState.entries.find((entry) => entry.id === target) ?? null;
  }

  if (target?.viewer) {
    return registryState.entries.find((entry) => entry.viewer === target.viewer) ?? null;
  }

  return registryState.entries.find((entry) => entry.viewer === target) ?? null;
}

function unregisterEntry(target) {
  const entry = resolveEntry(target);
  if (!entry) {
    return false;
  }

  const index = registryState.entries.indexOf(entry);
  if (index < 0) {
    return false;
  }

  registryState.entries.splice(index, 1);
  if (registryState.activeId === entry.id) {
    registryState.activeId = registryState.entries[0]?.id ?? null;
  }
  return true;
}

function createGlobalDebugApi() {
  return {
    listViewers() {
      return listEntryMetadata(registryState.entries, registryState.activeId);
    },
    useViewer(target) {
      const entry = resolveEntry(target);
      if (!entry) {
        return null;
      }
      registryState.activeId = entry.id;
      return entry.api;
    },
    getViewer(target = null) {
      return resolveEntry(target, true)?.api ?? null;
    },
    getObserverPc(target = null) {
      return resolveEntry(target, true)?.api.getObserverPc() ?? null;
    },
    getGalacticPc(target = null) {
      return resolveEntry(target, true)?.api.getGalacticPc() ?? null;
    },
    setObserverPc(...args) {
      const entry = resolveEntry(null, true);
      if (!entry) {
        return null;
      }
      return entry.api.setObserverPc(...args);
    },
    setGalacticPc(...args) {
      const entry = resolveEntry(null, true);
      if (!entry) {
        return null;
      }
      return entry.api.setGalacticPc(...args);
    },
    flyToPc(...args) {
      const entry = resolveEntry(null, true);
      if (!entry) {
        return null;
      }
      return entry.api.flyToPc(...args);
    },
    flyToGalacticPc(...args) {
      const entry = resolveEntry(null, true);
      if (!entry) {
        return null;
      }
      return entry.api.flyToGalacticPc(...args);
    },
    lookAtPc(...args) {
      const entry = resolveEntry(null, true);
      if (!entry) {
        return null;
      }
      return entry.api.lookAtPc(...args);
    },
    lookAtGalacticPc(...args) {
      const entry = resolveEntry(null, true);
      if (!entry) {
        return null;
      }
      return entry.api.lookAtGalacticPc(...args);
    },
    cancelAutomation(target = null) {
      const entry = resolveEntry(target, true);
      if (!entry) {
        return false;
      }
      return entry.api.cancelAutomation();
    },
    snapshot(target = null) {
      return resolveEntry(target, true)?.api.getSnapshotState() ?? null;
    },
    registerViewer(viewer, options = {}) {
      return installDemoViewerDebugConsole(viewer, options);
    },
  };
}

const globalDebugApi = createGlobalDebugApi();

function ensureGlobalBindings() {
  globalThis.skykitDebug = globalDebugApi;
  globalThis.__skykitDebug = globalDebugApi;
  return globalDebugApi;
}

export function installDemoViewerDebugConsole(viewer, options = {}) {
  if (!viewer || typeof viewer !== 'object') {
    throw new TypeError('installDemoViewerDebugConsole requires a viewer handle');
  }

  ensureGlobalBindings();

  const existing = resolveEntry(viewer);
  if (existing) {
    if (options.makeActive !== false) {
      registryState.activeId = existing.id;
    }
    return existing.api;
  }

  const navigationController = findNavigationController(viewer);
  const id = typeof options.id === 'string' && options.id.trim()
    ? options.id.trim()
    : viewer.runtime?.id ?? `viewer-${registryState.nextAutoId++}`;
  const label = typeof options.label === 'string' && options.label.trim()
    ? options.label.trim()
    : id;
  const entry = {
    id,
    label,
    viewer,
    navigationController,
    api: null,
  };
  entry.api = createEntryApi(entry);
  registryState.entries.push(entry);

  if (options.makeActive !== false || registryState.activeId == null) {
    registryState.activeId = entry.id;
  }

  if (typeof viewer.dispose === 'function' && viewer[WRAPPED_DISPOSE] !== true) {
    const originalDispose = viewer.dispose.bind(viewer);
    Object.defineProperty(viewer, WRAPPED_DISPOSE, {
      value: true,
      configurable: true,
    });
    viewer.dispose = async (...args) => {
      try {
        return await originalDispose(...args);
      } finally {
        unregisterEntry(viewer);
      }
    };
  }

  return entry.api;
}

export function __resetDemoViewerDebugConsoleForTests() {
  registryState = createRegistryState();
  delete globalThis.skykitDebug;
  delete globalThis.__skykitDebug;
}
