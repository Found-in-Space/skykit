import type {
  SkykitBrowser,
  SkykitBrowserCoordinateFramesFacade,
  SkykitBrowserCoordinateFramesOptions,
} from './browser.js';

export declare function installSkykitCoordinateFramesBrowserCapability(
  context: {
    browser: SkykitBrowser;
    host?: unknown;
    options?: SkykitBrowserCoordinateFramesOptions;
  }
): Promise<SkykitBrowserCoordinateFramesFacade>;
