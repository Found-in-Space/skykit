import { normalizeSpatialPose } from '@found-in-space/spatial';
import { SKYKIT_ICRS_SPACE } from './spatial-adapter.js';
import { SKYKIT_ACTIONS } from './actions.js';

let nextParticipant = 0;

/**
 * @param {import('./journey.d.ts').SkykitJourneyServices & { id?: string, durationSecs?: number }} options
 * @returns {import('@found-in-space/guided-journey/sequence').SequenceParticipant<import('./sequence.d.ts').SkykitSequenceValue> & { dispose(): void }}
 */
export function createSkykitSequenceParticipant({ viewer, navigation, id = `sequence:${++nextParticipant}`, durationSecs = 2 }) {
  if (!Number.isFinite(durationSecs) || durationSecs < 0) throw new RangeError('Join duration must be nonnegative seconds.');
  let disposed = false, owned = false, joining = false;
  /** @type {import('@found-in-space/guided-journey/sequence').SequenceContext | null} */
  let owner = null;
  /** @type {import('@found-in-space/guided-journey').JourneyOperation | null} */
  let operation = null;
  /** @type {Array<() => void>} */
  const acknowledgements = [], removers = [];
  const interruptActions = new Set([...Object.values(SKYKIT_ACTIONS.navigation), ...Object.values(SKYKIT_ACTIONS.ship), SKYKIT_ACTIONS.viewer.reset]);
  const acknowledge = () => { for (const resolve of acknowledgements.splice(0)) resolve(); };
  // SkyKit flushes the preceding frame's view patch before any update part.
  const removePart = viewer.addPart({ id, priority: -1, update: acknowledge });
  const removeDispose = viewer.on('viewer/dispose', dispose);

  function release() {
    for (const remove of removers.splice(0)) remove();
    const wasOwned = owned; owned = false; owner = null;
    operation?.cancel(); operation = null; joining = false;
    if (wasOwned && !viewer.getSnapshot().disposed) {
      const live = viewer.getViewState();
      viewer.requestViewState({ observerPc: live.observerPc, orientationIcrs: live.orientationIcrs }, id);
    }
    acknowledge();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; owner?.cancel(); release(); removePart(); removeDispose();
  }
  return {
    join(frame, context) {
      if (disposed) throw new Error('Sequence participant is disposed.');
      const pose = normalizeSpatialPose(frame.value.pose, SKYKIT_ICRS_SPACE);
      owner = context; owned = true; joining = true;
      const next = navigation.transitionTo({ observerPc: pose.position, orientationIcrs: pose.orientation, durationSecs }, { signal: context.signal });
      operation = next;
      void next.finished.then(() => { if (operation === next) joining = false; });
      removers.push(viewer.actions.subscribe(event => {
        if ((event.type === 'action/invoke' || event.type === 'action/press' || event.type === 'action/control')
          && interruptActions.has(event.id)) context.cancel();
      }));
      removers.push(navigation.subscribe(snapshot => {
        const next = /** @type {{ operation?: import('@found-in-space/guided-journey').JourneyOperation | null }} */ (snapshot)?.operation;
        if (next && next !== operation) context.cancel();
      }));
      removers.push(viewer.on('view/request', event => {
        if (!joining && event.reason !== id && event.patch && typeof event.patch === 'object'
          && ['observerPc', 'orientationIcrs', 'lookAt', 'targetPc'].some(key => key in /** @type {object} */ (event.patch))) {
          context.cancel();
          // Release supersedes the sequence's queued patch. Preserve the newer
          // explicit view request that caused this ownership handover.
          viewer.requestViewState(event.patch, event.reason);
        }
      }));
      return next;
    },
    apply(frame, context) {
      if (!context.isCurrent() || disposed) return;
      const pose = normalizeSpatialPose(frame.value.pose, SKYKIT_ICRS_SPACE);
      viewer.requestViewState({ observerPc: pose.position, orientationIcrs: pose.orientation }, id);
      return new Promise(resolve => { acknowledgements.push(resolve); });
    },
    release, dispose,
  };
}
