import type {
  SkykitBrowser,
  SkykitBrowserCoordinateGridsFacade,
  SkykitBrowserCoordinateGridsOptions,
} from './browser.js';

export declare function installSkykitCoordinateGridsBrowserCapability(
  context: {
    browser: SkykitBrowser;
    host?: unknown;
    options?: SkykitBrowserCoordinateGridsOptions;
  }
): Promise<SkykitBrowserCoordinateGridsFacade>;
