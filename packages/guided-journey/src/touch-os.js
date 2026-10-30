import { createButton, createColumn, createSlider, createSurfaceShell, createTextLabel } from '@found-in-space/touch-os';
import { chapterControlState, sequenceControlState, togglePlayback, replaySequence } from './control-state.js';

/** @param {Parameters<import('./touch-os.d.ts').createJourneyTouchControls>[0]} options
 * @returns {import('./touch-os.d.ts').JourneyTouchControls} */
export function createJourneyTouchControls({ id, journey, definition }) {
  return {
    render() {
      const state = journey.getSnapshot(), presentation = chapterControlState(definition, state);
      return createSurfaceShell(id, {
        header: createColumn(`${id}:heading`, { children: [
          createTextLabel(`${id}:title`, { text: definition.title ?? 'Journey' }),
          createTextLabel(`${id}:status`, { text: presentation.status }),
        ] }),
        children: definition.chapters.map((chapter, index) => createButton(`${id}:chapter:${index}`, {
          label: `${chapter.id === state.arrivedChapterId ? '✓ ' : chapter.id === state.requestedChapterId ? '→ ' : ''}${chapter.title ?? chapter.id}`,
          actionId: `${id}:chapter`, payload: { chapterId: chapter.id }, disabled: state.disposed,
        })),
        footer: createColumn(`${id}:actions`, { children: [
          createButton(`${id}:previous`, { label: 'Previous', actionId: `${id}:previous`, disabled: presentation.previousDisabled }),
          createButton(`${id}:next`, { label: 'Next', actionId: `${id}:next`, disabled: presentation.nextDisabled }),
          ...(presentation.retryVisible ? [createButton(`${id}:retry`, { label: 'Retry chapter', actionId: `${id}:retry`, disabled: state.disposed })] : []),
          createButton(`${id}:cancel`, { label: 'Explore freely', actionId: `${id}:cancel`, disabled: state.disposed }),
        ] }),
      });
    },
    handleOutput(output) {
      if (output.type !== 'action' || journey.getSnapshot().disposed) return false;
      switch (output.actionId) {
        case `${id}:chapter`:
          if (typeof output.payload?.chapterId !== 'string') return false;
          journey.goTo(output.payload.chapterId, { source: 'touch' }); break;
        case `${id}:previous`: journey.previous({ source: 'touch' }); break;
        case `${id}:next`: journey.next({ source: 'touch' }); break;
        case `${id}:cancel`: journey.cancel(); break;
        case `${id}:retry`: {
          const chapterId = journey.getSnapshot().requestedChapterId;
          if (chapterId) journey.goTo(chapterId, { source: 'retry' });
          break;
        }
        default: return false;
      }
      return true;
    },
  };
}

/** @template Value @param {Parameters<typeof import('./touch-os.d.ts').createSequenceTouchControls<Value>>[0]} options
 * @returns {import('./touch-os.d.ts').JourneyTouchControls} */
export function createSequenceTouchControls({ id, player, title = 'Sequence', rates = [-2, -1, 0.5, 1, 2], seekStepSecs = 0.1 }) {
  if (!Number.isFinite(seekStepSecs) || seekStepSecs <= 0) throw new RangeError('Seek step must be positive finite seconds.');
  if (rates.length === 0 || rates.some(rate => !Number.isFinite(rate) || rate === 0)) throw new RangeError('Rate choices must be finite and nonzero.');
  function rateChoices() {
    const state = player.getSnapshot();
    return [...new Set(state.capabilities.rates === 'any' ? [...rates, state.rate] : state.capabilities.rates)];
  }
  return {
    render() {
      const state = player.getSnapshot(), presentation = sequenceControlState(state);
      return createSurfaceShell(id, {
        header: createColumn(`${id}:heading`, { children: [
          createTextLabel(`${id}:title`, { text: title }),
          createTextLabel(`${id}:status`, { text: state.status === 'failed' ? presentation.status : `${presentation.ownership} · ${state.status}` }),
          createTextLabel(`${id}:elapsed`, { text: presentation.time }),
        ] }),
        children: [
          state.frame.durationSecs === 0 ? createTextLabel(`${id}:time`, { text: 'Time 0 seconds' })
            : createSlider(`${id}:time`, { label: 'Time', field: `${id}:time`, min: 0, max: state.frame.durationSecs,
              step: seekStepSecs, value: state.frame.timeSecs, valueText: `${state.frame.timeSecs.toFixed(1)} seconds`, disabled: presentation.seekDisabled }),
          createButton(`${id}:rate`, { label: `Playback rate ${state.rate}×`, actionId: `${id}:rate`, disabled: state.disposed || rateChoices().length < 2 }),
          createButton(`${id}:join`, { label: 'Rejoin view', actionId: `${id}:join`, disabled: state.disposed }),
          createButton(`${id}:replay`, { label: 'Replay', actionId: `${id}:replay`, disabled: presentation.seekDisabled }),
        ],
        footer: createColumn(`${id}:actions`, { children: [
          createButton(`${id}:play`, { label: presentation.playLabel, actionId: `${id}:play`, disabled: state.disposed }),
          createButton(`${id}:cancel`, { label: 'Explore freely', actionId: `${id}:cancel`, disabled: state.disposed }),
        ] }),
      });
    },
    handleOutput(output) {
      const state = player.getSnapshot();
      if (state.disposed) return false;
      if (output.type === 'change-request' && output.field === `${id}:time` &&
        (output.phase === undefined || output.phase === 'update') && typeof output.value === 'number' && state.capabilities.seek) {
        player.seek(output.value); return true;
      }
      if (output.type !== 'action') return false;
      switch (output.actionId) {
        case `${id}:play`: togglePlayback(player); break;
        case `${id}:replay`: if (!state.capabilities.seek) return false; replaySequence(player); break;
        case `${id}:join`: player.join(); break;
        case `${id}:cancel`: player.cancel(); break;
        case `${id}:rate`: { const choices = rateChoices(); player.setRate(choices[(choices.indexOf(state.rate) + 1) % choices.length]); break; }
        default: return false;
      }
      return true;
    },
  };
}
