import type {
  SkykitBrowser,
  SkykitBrowserJourneyFacade,
} from './browser.js';

export declare function installSkykitJourneyBrowserCapability(
  context: { browser: SkykitBrowser }
): Promise<SkykitBrowserJourneyFacade>;
