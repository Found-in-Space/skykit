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
    const index = definition.chapters.findIndex(chapter => chapter.id === state.requestedChapterId);
    for (const entry of chapterButtons) {
      entry.button.dataset.requested = String(entry.id === state.requestedChapterId);
      entry.button.dataset.arrived = String(entry.id === state.arrivedChapterId);
      if (entry.id === state.enteredChapterId) entry.button.setAttribute('aria-current', 'step');
      else entry.button.removeAttribute('aria-current');
    }
    previous.disabled = index <= 0; next.disabled = index >= definition.chapters.length - 1;
    retry.hidden = state.status !== 'failed';
    const title = definition.chapters[index]?.title ?? state.requestedChapterId ?? '';
    const error = state.error instanceof Error ? state.error.message : String(state.error ?? '');
    status.textContent = state.status === 'failed' ? `Could not open ${title}: ${error}`
      : state.status === 'cancelled' ? 'Free exploration. Choose a chapter to rejoin.'
        : state.status === 'preparing' ? `Preparing ${title}…`
          : state.status === 'transitioning' ? `Travelling to ${title}…`
            : state.status === 'active' ? title : 'Choose a chapter.';
    panel.dataset.status = state.status;
  }
  panel.append(chapters, actions, status); root.append(panel);
  const unsubscribe = journey.subscribe(update); update(journey.getSnapshot());
  return { destroy() { unsubscribe(); for (const dispose of disposables.splice(0)) dispose(); panel.remove(); } };
}
