import type {
  SkykitBrowser,
  SkykitBrowserConstellationsFacade,
  SkykitBrowserConstellationsOptions,
} from './browser.js';

export declare function installSkykitConstellationsBrowserCapability(
  context: {
    browser: SkykitBrowser;
    host?: unknown;
    options?: SkykitBrowserConstellationsOptions;
  }
): Promise<SkykitBrowserConstellationsFacade>;
