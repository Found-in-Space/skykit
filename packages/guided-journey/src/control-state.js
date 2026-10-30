/** @param {{ readonly chapters: readonly {readonly id: string, readonly title?: string}[] }} definition
 * @param {import('./index.d.ts').JourneySnapshot} state */
export function chapterControlState(definition, state) {
  const index = definition.chapters.findIndex(chapter => chapter.id === state.requestedChapterId);
  const title = definition.chapters[index]?.title ?? state.requestedChapterId ?? '';
  const error = state.error instanceof Error ? state.error.message : String(state.error ?? '');
  return { previousDisabled: state.disposed || index <= 0,
    nextDisabled: state.disposed || index >= definition.chapters.length - 1,
    retryVisible: state.status === 'failed',
    status: state.status === 'failed' ? `Could not open ${title}: ${error}`
      : state.status === 'cancelled' ? 'Free exploration. Choose a chapter to rejoin.'
        : state.status === 'preparing' ? `Preparing ${title}…`
          : state.status === 'transitioning' ? `Travelling to ${title}…`
            : state.status === 'active' ? title : 'Choose a chapter.' };
}

/** @param {import('./sequence.d.ts').SequenceSnapshot<unknown>} state */
export function sequenceControlState(state) {
  const ownership = state.ownership === 'attached' ? 'View joined'
    : state.ownership === 'joining' ? 'Moving into the sequence' : 'Free exploration';
  const time = `${state.frame.timeSecs.toFixed(1)} / ${state.frame.durationSecs.toFixed(1)} seconds`;
  return { ownership, time, playLabel: state.status === 'playing' ? 'Pause' : 'Play',
    seekDisabled: !state.capabilities.seek || state.disposed,
    status: state.status === 'failed' ? `Sequence failed: ${state.error instanceof Error ? state.error.message : state.error}`
      : `${ownership} · ${time} · ${state.status}` };
}

/** @param {import('./sequence.d.ts').JourneySequencePlayer<unknown>} player */
export function togglePlayback(player) {
  if (player.getSnapshot().status === 'playing') player.pause(); else player.play();
}

/** @param {import('./sequence.d.ts').JourneySequencePlayer<unknown>} player */
export function replaySequence(player) {
  const state = player.getSnapshot();
  player.seek(state.rate > 0 ? 0 : state.frame.durationSecs);
  player.play();
}
