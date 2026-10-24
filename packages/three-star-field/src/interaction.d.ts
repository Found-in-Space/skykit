import type { InteractionDelivery, InteractionTarget } from '@found-in-space/touch-os/interaction';
import type { ThreeStarField, ThreeStarFieldPickOptions, ThreeStarFieldPickResult } from './index.js';
export interface ThreeStarFieldInteractionOptions {
  id: string;
  field: ThreeStarField;
  priority?: number;
  pickOptions?: ThreeStarFieldPickOptions | (() => ThreeStarFieldPickOptions);
  onSelect(result: ThreeStarFieldPickResult, event: InteractionDelivery): void;
}
export function createThreeStarFieldTarget(options: ThreeStarFieldInteractionOptions): InteractionTarget;
