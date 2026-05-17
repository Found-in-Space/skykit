import { createJourneyVideoStorage } from '@found-in-space/journey-video';
import { createJourneyVideoEditor } from '@found-in-space/journey-video/editor';

const SAMPLE_JOURNEY = {
  format: 'fis-journey-v1',
  id: 'pleiades-drift',
  title: 'Pleiades Drift',
  durationSecs: 18,
  targetDistancePc: 80,
  locationWaypoints: [
    { id: 'home', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
    { id: 'approach', timeSecs: 7, positionPc: { x: -30, y: 18, z: -88 } },
    { id: 'cluster', timeSecs: 18, positionPc: { x: -42, y: 20, z: -125 } },
  ],
  cameraLookWaypoints: [
    { id: 'look-home', timeSecs: 0, kind: 'target', targetPc: { x: -42, y: 20, z: -125 } },
    { id: 'look-cluster', timeSecs: 18, kind: 'target', targetPc: { x: -42, y: 20, z: -125 } },
  ],
  guides: [
    {
      id: 'pleiades-guide',
      label: 'Pleiades guide volume',
      shape: 'sphere',
      positionPc: { x: -42, y: 20, z: -125 },
      radiusPc: 18,
      color: '#72d7ff',
      opacity: 0.24,
    },
  ],
  cues: [
    { id: 'intro', startSecs: 0, endSecs: 5, text: 'Start near the Sun.' },
    { id: 'arrival', startSecs: 12, endSecs: 18, text: 'Arrive at the authored guide volume.' },
  ],
};

const host = document.querySelector('[data-editor]');
const storage = createJourneyVideoStorage(window.localStorage, 'fis-journey-video-editor-example');
const saved = storage.load();

const editor = createJourneyVideoEditor({
  host,
  document: saved ?? undefined,
  journey: saved ? undefined : SAMPLE_JOURNEY,
  storage,
  preview: {
    skykit: true,
    renderScale: 0.02,
    coordinateUnitsPerParsec: 0.02,
    limitingMagnitude: 6.5,
  },
  onChange(document) {
    storage.save(document);
  },
  onError(error) {
    console.error(error);
  },
});

window.journeyVideoEditor = editor;
window.addEventListener('beforeunload', () => {
  void editor.dispose();
});
