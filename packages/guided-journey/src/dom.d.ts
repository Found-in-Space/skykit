import type { GuidedJourneyController } from './index.js';
/** Optional DOM adapter. Never imported by the headless package entry. Does not start the journey. */
export declare function mountJourneyControls(options: {
  root: HTMLElement;
  journey: GuidedJourneyController;
  definition: { readonly chapters: readonly { readonly id: string; readonly title?: string }[] };
}): { destroy(): void };
/** Explicit play/pause, seek, rate, rejoin and free-exploration controls. */
export declare function mountSequenceControls<Value>(options: {
  root: HTMLElement;
  player: import('./sequence.js').JourneySequencePlayer<Value>;
}): { destroy(): void };
