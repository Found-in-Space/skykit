import { chapterControlState, sequenceControlState, togglePlayback, replaySequence } from './control-state.js';

/** @param {{ root: HTMLElement, journey: import('./index.d.ts').GuidedJourneyController, definition: { readonly chapters: readonly { readonly id: string, readonly title?: string }[] } }} options */
export function mountJourneyControls({ root, journey, definition }) {
  const document = root.ownerDocument;
  const panel = document.createElement('section');
  panel.className = 'journey-controls';
  panel.setAttribute('aria-label', 'Journey controls');
  const chapters = document.createElement('nav');
  chapters.setAttribute('aria-label', 'Chapters');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const actions = document.createElement('div');
  /** @type {Array<() => void>} */
  const disposables = [];
  /** @param {HTMLElement} parent @param {string} title @param {() => void} activate */
  function button(parent, title, activate) {
    const element = document.createElement('button');
    element.type = 'button'; element.textContent = title;
    element.addEventListener('click', activate);
    disposables.push(() => element.removeEventListener('click', activate));
    parent.append(element);
    return element;
  }
  const chapterButtons = definition.chapters.map(chapter => ({ id: chapter.id,
    button: button(chapters, chapter.title ?? chapter.id, () => { journey.goTo(chapter.id, { source: 'button' }); }),
  }));
  const previous = button(actions, 'Previous', () => { journey.previous({ source: 'button' }); });
  const next = button(actions, 'Next', () => { journey.next({ source: 'button' }); });
  button(actions, 'Explore freely', () => journey.cancel());
  const retry = button(actions, 'Retry chapter', () => {
    const id = journey.getSnapshot().requestedChapterId;
    if (id) journey.goTo(id, { source: 'retry' });
  });
  /** @param {import('./index.d.ts').JourneySnapshot} state */
  function update(state) {
    const presentation = chapterControlState(definition, state);
    for (const entry of chapterButtons) {
      entry.button.dataset.requested = String(entry.id === state.requestedChapterId);
      entry.button.dataset.arrived = String(entry.id === state.arrivedChapterId);
      entry.button.disabled = state.disposed;
      if (entry.id === state.enteredChapterId) entry.button.setAttribute('aria-current', 'step');
      else entry.button.removeAttribute('aria-current');
    }
    previous.disabled = presentation.previousDisabled; next.disabled = presentation.nextDisabled;
    retry.hidden = !presentation.retryVisible; retry.disabled = state.disposed;
    status.textContent = presentation.status;
    panel.dataset.status = state.status;
  }
  panel.append(chapters, actions, status); root.append(panel);
  const unsubscribe = journey.subscribe(update); update(journey.getSnapshot());
  return { destroy() { unsubscribe(); for (const dispose of disposables.splice(0)) dispose(); panel.remove(); } };
}

/** @template Value @param {{ root: HTMLElement, player: import('./sequence.d.ts').JourneySequencePlayer<Value> }} options */
export function mountSequenceControls({ root, player }) {
  const document = root.ownerDocument, panel = document.createElement('section');
  panel.className = 'sequence-controls'; panel.setAttribute('aria-label', 'Sequence controls');
  const play = document.createElement('button'), replay = document.createElement('button');
  const join = document.createElement('button'), cancel = document.createElement('button');
  for (const button of [play, replay, join, cancel]) button.type = 'button';
  replay.textContent = 'Replay'; join.textContent = 'Rejoin view'; cancel.textContent = 'Explore freely';
  play.onclick = () => togglePlayback(player);
  replay.onclick = () => replaySequence(player);
  join.onclick = () => { player.join(); }; cancel.onclick = () => player.cancel();
  const seekLabel = document.createElement('label'), seek = document.createElement('input');
  seekLabel.textContent = 'Time '; seek.type = 'range'; seek.min = '0'; seek.step = 'any'; seekLabel.append(seek);
  seek.oninput = () => { player.seek(Number(seek.value)); };
  const rateLabel = document.createElement('label'); rateLabel.textContent = 'Playback rate ';
  const rates = player.getSnapshot().capabilities.rates;
  const rate = rates === 'any' ? document.createElement('input') : document.createElement('select');
  if (rate instanceof document.defaultView.HTMLInputElement) { rate.type = 'number'; rate.step = 'any'; }
  else if (rates !== 'any') for (const value of rates) {
    const option = document.createElement('option'); option.value = String(value); option.textContent = `${value}×`; rate.append(option);
  }
  rate.onchange = () => {
    try { player.setRate(Number(rate.value)); rate.setCustomValidity(''); }
    catch (error) { rate.setCustomValidity(error instanceof Error ? error.message : String(error)); rate.reportValidity(); }
  };
  rateLabel.append(rate);
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  panel.append(play, replay, join, cancel, seekLabel, rateLabel, status); root.append(panel);
  /** @param {import('./sequence.d.ts').SequenceSnapshot<Value>} state */
  function update(state) {
    const presentation = sequenceControlState(state);
    play.textContent = presentation.playLabel;
    seek.max = String(state.frame.durationSecs); seek.value = String(state.frame.timeSecs);
    rate.value = String(state.rate);
    seek.disabled = presentation.seekDisabled; replay.disabled = seek.disabled;
    play.disabled = join.disabled = cancel.disabled = rate.disabled = state.disposed;
    status.textContent = presentation.status;
  }
  const unsubscribe = player.subscribe(update); update(player.getSnapshot());
  return { destroy() { unsubscribe(); play.onclick = replay.onclick = join.onclick = cancel.onclick = null;
    seek.oninput = rate.onchange = null; panel.remove(); } };
}
