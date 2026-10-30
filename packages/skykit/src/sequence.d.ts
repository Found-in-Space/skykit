import type { SpatialPose } from '@found-in-space/spatial';
import type { SequenceParticipant } from '@found-in-space/guided-journey/sequence';
import type { SkykitJourneyServices } from './journey.js';

/** Pose uses SKYKIT_ICRS_SPACE: catalog ICRS axes and parsecs. Other values remain app-owned. */
export interface SkykitSequenceValue { readonly pose: SpatialPose }
/** Borrows the viewer's frame loop; call dispose after disposing the player. */
export declare function createSkykitSequenceParticipant(options: SkykitJourneyServices & {
  id?: string;
  durationSecs?: number;
}): SequenceParticipant<SkykitSequenceValue> & { dispose(): void };
