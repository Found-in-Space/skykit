import type { DisplayNode, RuntimeOutput } from '@found-in-space/touch-os';
import type { GuidedJourneyController } from './index.js';
import type { JourneySequencePlayer } from './sequence.js';

/** Borrowed controller; no clock, input adapter, scene placement or disposal ownership. */
export interface JourneyTouchControls {
  render(): DisplayNode;
  /** Handle only this panel's semantic outputs. Slider cancellation retains the last applied time. */
  handleOutput(output: RuntimeOutput): boolean;
}
export declare function createJourneyTouchControls(options: {
  id: string;
  journey: GuidedJourneyController;
  definition: { readonly title?: string; readonly chapters: readonly { readonly id: string; readonly title?: string }[] };
}): JourneyTouchControls;
export declare function createSequenceTouchControls<Value>(options: {
  id: string;
  player: JourneySequencePlayer<Value>;
  title?: string;
  /** UI choices for an unrestricted player. A restricted player's declared rates take precedence. */
  rates?: readonly number[];
  /** Slider precision only; the player still accepts any supported finite seek time. Defaults to 0.1 seconds. */
  seekStepSecs?: number;
}): JourneyTouchControls;
