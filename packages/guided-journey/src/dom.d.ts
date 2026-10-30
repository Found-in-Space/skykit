import type { GuidedJourneyController } from './index.js';
/** Optional DOM adapter. Never imported by the headless package entry. Does not start the journey. */
export declare function mountJourneyControls(options: {
  root: HTMLElement;
  journey: GuidedJourneyController;
  definition: { readonly chapters: readonly { readonly id: string; readonly title?: string }[] };
}): { destroy(): void };
