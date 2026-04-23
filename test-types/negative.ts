import { createDataset, createJourneyGraph } from '@found-in-space/skykit';

const dataset = createDataset();

// @ts-expect-error unknown built-in dataset command
dataset.dispatch({ type: 'dataset/unknown' });

dataset.subscribe((event) => {
  if (event.type === 'loading/started') {
    // @ts-expect-error loading started events do not expose dataset metadata
    event.dataset;
  }
});

// @ts-expect-error selection hooks must preserve selection values
dataset.registerHook('selection:resolve', () => 'bad');

createJourneyGraph({
  scenes: {
    intro: {},
  },
  transitions: [
    // @ts-expect-error transitions must specify both endpoints
    { id: 'broken-transition' },
  ],
});
