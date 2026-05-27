const STATE = Symbol.for('found-in-space.skykit.browserAddons');
const GLOBAL_NAME = 'Skykit';

/**
 * Install or upgrade the small global service used by the noob embed path.
 *
 * @param {typeof globalThis} [target]
 * @returns {import('./browser.d.ts').SkykitBrowserGlobal}
 */
export function installSkykitBrowserGlobal(target = globalThis) {
  const globalTarget = /** @type {typeof globalThis & { Skykit?: Partial<import('./browser.d.ts').SkykitBrowserGlobal> & Record<PropertyKey, unknown> }} */ (target);
  const service = /** @type {Partial<import('./browser.d.ts').SkykitBrowserGlobal> & Record<PropertyKey, unknown>} */ (
    globalTarget[GLOBAL_NAME] && typeof globalTarget[GLOBAL_NAME] === 'object'
      ? globalTarget[GLOBAL_NAME]
      : {}
  );
  const state = getState(service);
  const queuedAddons = Array.isArray(service.browserAddons)
    ? service.browserAddons.splice(0)
    : [];

  service.browserAddons = state.addons;
  service.registerBrowserAddon = (addon) => registerBrowserAddon(service, addon);
  service.whenReady = (targetOrSelector) => whenReady(service, targetOrSelector);
  service.getBrowsers = () => state.records.map((record) => record.browser);
  globalTarget[GLOBAL_NAME] = service;

  for (const addon of queuedAddons) {
    registerBrowserAddon(service, addon);
  }

  return /** @type {import('./browser.d.ts').SkykitBrowserGlobal} */ (service);
}

/**
 * @param {import('./browser.d.ts').SkykitBrowserGlobal} service
 * @param {import('./browser.d.ts').SkykitBrowserAddon} addon
 */
export function registerBrowserAddon(service, addon) {
  if (!addon || typeof addon.install !== 'function') {
    throw new TypeError('SkyKit browser add-ons must provide install(context).');
  }
  const state = getState(service);
  if (state.addons.includes(addon)) return () => {};
  state.addons.push(addon);
  for (const record of state.records) {
    void installAddonOnRecord(record, addon);
  }
  return () => {
    const index = state.addons.indexOf(addon);
    if (index >= 0) state.addons.splice(index, 1);
  };
}

/**
 * @param {import('./browser.d.ts').SkykitBrowserGlobal} service
 * @param {unknown} host
 * @param {import('./browser.d.ts').SkykitBrowser} browser
 * @returns {() => void}
 */
export function registerBrowserInstance(service, host, browser) {
  const state = getState(service);
  const record = {
    host,
    browser,
    installedAddonIds: new Set(),
  };
  state.records.push(record);
  for (const addon of state.addons) {
    void installAddonOnRecord(record, addon);
  }
  resolveWaiters(state, record);
  return () => {
    const index = state.records.indexOf(record);
    if (index >= 0) state.records.splice(index, 1);
  };
}

/**
 * @param {Partial<import('./browser.d.ts').SkykitBrowserGlobal> & Record<PropertyKey, unknown>} service
 * @returns {{
 *   addons: import('./browser.d.ts').SkykitBrowserAddon[];
 *   records: Array<{ host: unknown; browser: import('./browser.d.ts').SkykitBrowser; installedAddonIds: Set<string> }>;
 *   waiters: Array<{ target: unknown; resolve: (browser: import('./browser.d.ts').SkykitBrowser) => void; reject: (error: unknown) => void }>;
 * }}
 */
function getState(service) {
  if (!service[STATE]) {
    Object.defineProperty(service, STATE, {
      configurable: false,
      enumerable: false,
      value: {
        addons: [],
        records: [],
        waiters: [],
      },
    });
  }
  return /** @type {ReturnType<typeof getState>} */ (service[STATE]);
}

/**
 * @param {ReturnType<typeof getState>['records'][number]} record
 * @param {import('./browser.d.ts').SkykitBrowserAddon} addon
 */
async function installAddonOnRecord(record, addon) {
  const addonId = addon.id ?? addon.install;
  const dedupeId = typeof addonId === 'string' ? addonId : String(record.installedAddonIds.size + 1);
  if (record.installedAddonIds.has(dedupeId)) return;
  record.installedAddonIds.add(dedupeId);
  await record.browser.install(addon);
}

/**
 * @param {import('./browser.d.ts').SkykitBrowserGlobal} service
 * @param {unknown} target
 * @returns {Promise<import('./browser.d.ts').SkykitBrowser>}
 */
function whenReady(service, target) {
  const state = getState(service);
  const existing = state.records.find((record) => matchesTarget(record.host, target));
  if (existing) return Promise.resolve(existing.browser);
  return new Promise((resolve, reject) => {
    state.waiters.push({ target, resolve, reject });
  });
}

/**
 * @param {ReturnType<typeof getState>} state
 * @param {ReturnType<typeof getState>['records'][number]} record
 */
function resolveWaiters(state, record) {
  for (const waiter of [...state.waiters]) {
    if (!matchesTarget(record.host, waiter.target)) continue;
    const index = state.waiters.indexOf(waiter);
    if (index >= 0) state.waiters.splice(index, 1);
    waiter.resolve(record.browser);
  }
}

/** @param {unknown} host @param {unknown} target */
function matchesTarget(host, target) {
  if (target == null) return true;
  if (target === host) return true;
  if (typeof target !== 'string') return false;
  const element = /** @type {{ matches?: (selector: string) => boolean }} */ (host);
  if (typeof element.matches === 'function') {
    try {
      if (element.matches(target)) return true;
    } catch {
      return false;
    }
  }
  return false;
}
