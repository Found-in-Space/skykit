export {
  createSkykitXrBrowser,
  type SkykitXrBrowser,
  type SkykitXrBrowserAddonContext,
  type SkykitXrBrowserOptions,
} from './xr-browser.js';
export {
  installSkykitBrowserGlobal,
  registerBrowserAddon,
  registerBrowserInstance,
} from './browser-addons.js';

export declare function startSkykitXrEmbeds(options?: {
  document?: Document;
  selector?: string;
  createBrowser?: typeof import('./xr-browser.js').createSkykitXrBrowser;
  globalService?: import('./browser.js').SkykitBrowserGlobal | null;
}): void;
