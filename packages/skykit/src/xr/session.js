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
  const session = /** @type {{ requestReferenceSpace?: (type: string) => Promise<unknown> }} */ (
    await xr.requestSession(mode, options.sessionInit)
  );
  const referenceSpace = typeof session.requestReferenceSpace === 'function'
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
      await exitSkykitXrSession(session);
      ended = true;
    },
    getSnapshot() {
      return {
        mode: options.mode,
        referenceSpaceType: options.referenceSpaceType,
        presenting: !ended,
        hasReferenceSpace: options.referenceSpace != null,
      };
    },
  };
  if (session && typeof /** @type {{ addEventListener?: unknown }} */ (session).addEventListener === 'function') {
    /** @type {{ addEventListener: (type: string, listener: () => void, options?: unknown) => void }} */ (session)
      .addEventListener('end', () => {
        ended = true;
      }, { once: true });
  }
  return handle;
}

/**
 * @param {unknown} navigatorLike
 */
function resolveSkykitXr(navigatorLike) {
  const nav = navigatorLike ?? globalThis.navigator;
  return /** @type {{ xr?: { isSessionSupported?: (mode: string) => Promise<boolean>; requestSession?: (mode: string, init?: unknown) => Promise<unknown> } }} */ (nav)?.xr ?? null;
}
