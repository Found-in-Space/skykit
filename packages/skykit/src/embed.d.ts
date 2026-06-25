export { createSkykitBrowser } from './browser.js';
export {
  installSkykitBrowserGlobal,
  registerBrowserAddon,
  registerBrowserInstance,
} from './browser-addons.js';

export declare function startSkykitBrowserEmbeds(options?: {
  document?: Document;
  selector?: string;
  createBrowser?: typeof import('./browser.js').createSkykitBrowser;
  globalService?: import('./browser.js').SkykitBrowserGlobal | null;
}): void;
