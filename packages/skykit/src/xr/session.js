/**
 * @param {string} [mode]
 * @param {{ navigator?: unknown }} [options]
 * @returns {Promise<boolean>}
 */
export async function isSkykitXrModeSupported(mode = 'immersive-vr', options = {}) {
  const xr = resolveSkykitXr(options.navigator);
  if (!xr || typeof xr.isSessionSupported !== 'function') {
    return false;
  }
  try {
    return await xr.isSessionSupported(mode);
  } catch {
    return false;
  }
}

/**
 * @param {import('../xr.d.ts').EnterSkykitXrSessionOptions} [options]
 * @returns {Promise<import('../xr.d.ts').SkykitXrSessionHandle>}
 */
export async function enterSkykitXrSession(options = {}) {
  const mode = options.mode ?? 'immersive-vr';
  const referenceSpaceType = options.referenceSpaceType ?? 'local-floor';
  const xr = resolveSkykitXr(options.navigator);
  if (!xr || typeof xr.requestSession !== 'function') {
    throw new Error('WebXR is not available.');
  }
  /** @type {{ requestReferenceSpace?: (type: string) => Promise<unknown>; end?: () => Promise<void> | void } | null} */
  let session = null;
  try {
    session = /** @type {{ requestReferenceSpace?: (type: string) => Promise<unknown>; end?: () => Promise<void> | void }} */ (
      await xr.requestSession(mode, createSessionInit(options.sessionInit, referenceSpaceType))
    );
    const referenceSpace = options.requestReferenceSpace === false
      ? null
      : typeof session.requestReferenceSpace === 'function'
        ? await session.requestReferenceSpace(referenceSpaceType)
        : null;
    const handle = createSessionHandle({
      mode,
      referenceSpaceType,
      session,
      referenceSpace,
    });
    options.onSessionStarted?.(handle);
    return handle;
  } catch (error) {
    if (session && typeof session.end === 'function') {
      try {
        await session.end();
      } catch {
        // Preserve the original session-enter error.
      }
    }
    throw error;
  }
}

/**
 * @param {unknown} sessionOrHandle
 * @returns {Promise<void>}
 */
export async function exitSkykitXrSession(sessionOrHandle) {
  if (
    sessionOrHandle
    && typeof sessionOrHandle === 'object'
    && typeof /** @type {{ exit?: unknown }} */ (sessionOrHandle).exit === 'function'
    && /** @type {{ session?: unknown }} */ (sessionOrHandle).session
  ) {
    await /** @type {{ exit: () => Promise<void> | void }} */ (sessionOrHandle).exit();
    return;
  }
  const session = /** @type {{ session?: unknown }} */ (sessionOrHandle)?.session ?? sessionOrHandle;
  if (session && typeof /** @type {{ end?: unknown }} */ (session).end === 'function') {
    await /** @type {{ end: () => Promise<void> | void }} */ (session).end();
  }
}

/**
 * @param {{ mode: string; referenceSpaceType: string; session: unknown; referenceSpace: unknown }} options
 * @returns {import('../xr.d.ts').SkykitXrSessionHandle}
 */
function createSessionHandle(options) {
  let ended = false;
  /** @type {'native' | 'explicit' | null} */
  let endReason = null;
  let exitRequested = false;
  /** @type {Promise<void> | null} */
  let exitPromise = null;
  /** @type {Set<(reason: 'native' | 'explicit') => void>} */
  const endListeners = new Set();
  const session = options.session;
  const handle = {
    mode: options.mode,
    referenceSpaceType: options.referenceSpaceType,
    session,
    referenceSpace: options.referenceSpace,
    get presenting() {
      return !ended;
    },
    async exit() {
      if (ended) return;
      if (!exitPromise) {
        exitRequested = true;
        exitPromise = (async () => {
          await exitSkykitXrSession(session);
          finish('explicit');
        })();
      }
      await exitPromise;
    },
    /** @param {(reason: 'native' | 'explicit') => void} listener */
    onEnd(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('SkykitXrSessionHandle.onEnd() requires a listener.');
      }
      if (ended) {
        listener(endReason ?? 'native');
        return () => {};
      }
      endListeners.add(listener);
      return () => {
        endListeners.delete(listener);
      };
    },
    getSnapshot() {
      return {
        mode: options.mode,
        referenceSpaceType: options.referenceSpaceType,
        presenting: !ended,
        hasReferenceSpace: options.referenceSpace != null,
        endReason,
      };
    },
  };
  if (session && typeof /** @type {{ addEventListener?: unknown }} */ (session).addEventListener === 'function') {
    /** @type {{ addEventListener: (type: string, listener: () => void, options?: unknown) => void }} */ (session)
      .addEventListener('end', () => {
        finish(exitRequested ? 'explicit' : 'native');
      }, { once: true });
  }
  return handle;

  /** @param {'native' | 'explicit'} reason */
  function finish(reason) {
    if (ended) return;
    ended = true;
    endReason = reason;
    const listeners = Array.from(endListeners);
    endListeners.clear();
    for (const listener of listeners) {
      listener(reason);
    }
  }
}

/**
 * @param {unknown} navigatorLike
 */
function resolveSkykitXr(navigatorLike) {
  const nav = navigatorLike ?? globalThis.navigator;
  return /** @type {{ xr?: { isSessionSupported?: (mode: string) => Promise<boolean>; requestSession?: (mode: string, init?: unknown) => Promise<unknown> } }} */ (nav)?.xr ?? null;
}

/**
 * @param {unknown} sessionInit
 * @param {string} referenceSpaceType
 */
function createSessionInit(sessionInit, referenceSpaceType) {
  const base = sessionInit && typeof sessionInit === 'object'
    ? /** @type {Record<string, unknown>} */ (sessionInit)
    : {};
  const requiredFeatures = normalizeFeatureList(base.requiredFeatures);
  const optionalFeatures = normalizeFeatureList(base.optionalFeatures);
  if (
    referenceSpaceType &&
    !requiredFeatures.includes(referenceSpaceType) &&
    !optionalFeatures.includes(referenceSpaceType)
  ) {
    optionalFeatures.push(referenceSpaceType);
  }
  return {
    ...base,
    ...(requiredFeatures.length > 0 ? { requiredFeatures } : {}),
    ...(optionalFeatures.length > 0 ? { optionalFeatures } : {}),
  };
}

/** @param {unknown} value */
function normalizeFeatureList(value) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((entry) => typeof entry === 'string' && entry.trim())))
    : [];
}
