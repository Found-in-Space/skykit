export { createSkykitSequenceParticipant } from './sequence.js';

/**
 * @param {import('./journey.d.ts').SkykitJourneyServices & {
 * prepare?: (scene: import('./journey.d.ts').SkykitJourneyScene,
 * context: import('@found-in-space/guided-journey').JourneyContext<import('./journey.d.ts').SkykitJourneyScene, import('./journey.d.ts').SkykitJourneyServices>) => void | import('@found-in-space/guided-journey').Cleanup | Promise<void | import('@found-in-space/guided-journey').Cleanup>
 * }} options
 * @returns {import('@found-in-space/guided-journey').JourneyDriver<import('./journey.d.ts').SkykitJourneyScene, import('./journey.d.ts').SkykitJourneyServices> & { dispose(): void }}
 */
export function createSkykitJourneyDriver({ viewer, navigation, prepare }) {
  return {
    services: { viewer, navigation },
    prepare(scene, context) {
      if (scene.camera.kind && scene.camera.kind !== 'pose') throw new RangeError('This driver expects pose camera intent.');
      for (const key of ['observerPc', 'orientationIcrs', 'lookAt', 'targetPc']) {
        if (scene.view && key in scene.view) throw new TypeError(`Put ${key} in scene.camera, not scene.view.`);
      }
      return prepare?.(scene, context);
    },
    enter(scene, context) {
      context.throwIfAborted();
      if (scene.view) viewer.requestViewState(scene.view, context.source);
    },
    transition(scene, context) {
      context.throwIfAborted();
      return navigation.transitionTo({ ...scene.camera,
        ...(context.transition.durationSecs === undefined ? {} : { durationSecs: context.transition.durationSecs }),
      }, { signal: context.signal });
    },
    cancel: () => navigation.cancel(),
    dispose: () => navigation.cancel(),
  };
}
