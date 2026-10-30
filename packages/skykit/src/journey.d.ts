import type { JourneyContext, JourneyDriver, Cleanup } from '@found-in-space/guided-journey';
import type { SkykitViewer, SkykitViewState, SkykitNavigationPlugin, SkykitNavigationTransition } from './index.js';
export { createSkykitSequenceParticipant, type SkykitSequenceValue } from './sequence.js';

export interface SkykitJourneyScene {
  view?: Omit<Partial<SkykitViewState>, 'observerPc' | 'orientationIcrs' | 'lookAt' | 'targetPc'>;
  camera: SkykitNavigationTransition & { kind?: 'pose' };
}
export interface SkykitJourneyServices {
  viewer: SkykitViewer;
  navigation: SkykitNavigationPlugin;
}
/** Borrows the viewer and installed navigation controller; owns no render loop. */
export declare function createSkykitJourneyDriver(options: SkykitJourneyServices & {
  prepare?: (scene: SkykitJourneyScene, context: JourneyContext<SkykitJourneyScene, SkykitJourneyServices>) => void | Cleanup | Promise<void | Cleanup>;
}): JourneyDriver<SkykitJourneyScene, SkykitJourneyServices> & { dispose(): void };
