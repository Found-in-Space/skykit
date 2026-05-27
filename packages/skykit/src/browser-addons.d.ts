import type {
  SkykitBrowser,
  SkykitBrowserAddon,
  SkykitBrowserGlobal,
} from './browser.js';

export declare function installSkykitBrowserGlobal(target?: typeof globalThis): SkykitBrowserGlobal;
export declare function registerBrowserAddon(
  service: SkykitBrowserGlobal,
  addon: SkykitBrowserAddon
): () => void;
export declare function registerBrowserInstance(
  service: SkykitBrowserGlobal,
  host: unknown,
  browser: SkykitBrowser
): () => void;
