import assert from 'node:assert/strict';
import test from 'node:test';

import { createJourneyVideoEditor } from '../editor.js';
import {
  JOURNEY_VIDEO_PACKAGE_STATUS,
  createJourneyVideoEditorDocument,
  exportJourneyVideoEditorDocument,
  importJourneyVideoEditorDocument,
  normalizeJourneyVideoEditorState,
} from '../index.js';
import {
  createJourneyEditorProjectionData,
  createJourneyProjectionTransform,
  hitJourneyEditorMarker,
  projectJourneyEditorPoint,
} from '../editor/projection.js';

const SAMPLE_JOURNEY = {
  format: 'fis-journey-v1',
  id: 'editor-test',
  title: 'Editor Test',
  durationSecs: 10,
  locationWaypoints: [
    { id: 'loc-a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
    { id: 'loc-b', timeSecs: 10, positionPc: { x: 10, y: 0, z: 0 } },
  ],
  cameraLookWaypoints: [
    { id: 'cam-a', timeSecs: 0, kind: 'target', targetPc: { x: 0, y: 0, z: -10 } },
    { id: 'cam-b', timeSecs: 10, kind: 'target', targetPc: { x: 10, y: 0, z: -10 } },
  ],
  guides: [
    {
      id: 'guide-a',
      label: 'Guide A',
      positionPc: { x: 5, y: 0, z: -2 },
      shape: 'sphere',
      radiusPc: 2,
    },
  ],
};

test('journey-video package exposes alpha editor status', () => {
  assert.equal(JOURNEY_VIDEO_PACKAGE_STATUS, 'alpha-editor');
});

test('editor state normalization preserves safe tile, zoom, selection, and draft defaults', () => {
  const state = normalizeJourneyVideoEditorState({
    tileModes: ['yz', 'skykit', 'bad-mode'],
    zoom: 200,
    selectedWidget: { type: 'guide', id: 'guide-a' },
    selectedLocationRange: { anchorId: 'loc-a', focusId: 'loc-b' },
    timeSecs: 3.25,
    playing: true,
  });

  assert.deepEqual(state.tileModes, ['yz', 'skykit', 'perspective', 'skykit']);
  assert.equal(state.zoom, 50);
  assert.deepEqual(state.selectedWidget, { type: 'guide', id: 'guide-a' });
  assert.deepEqual(state.selectedLocationRange, { anchorId: 'loc-a', focusId: 'loc-b' });
  assert.equal(state.timeSecs, 3.25);
  assert.equal(state.playing, true);
});

test('editor documents import and export fis journey data without website fields', () => {
  const document = createJourneyVideoEditorDocument({
    journey: SAMPLE_JOURNEY,
    editorState: { tileModes: ['xy', 'xz', 'yz', 'perspective'], zoom: 2 },
    metadata: { source: 'test' },
  });
  const exported = exportJourneyVideoEditorDocument(document);
  const imported = importJourneyVideoEditorDocument(exported);

  assert.equal(imported.format, 'fis-journey-video-editor-v1');
  assert.equal(imported.journey.format, 'fis-journey-v1');
  assert.equal(imported.journey.id, 'editor-test');
  assert.equal(imported.editorState.zoom, 2);
  assert.equal(imported.metadata.source, 'test');

  const rawJourney = importJourneyVideoEditorDocument(JSON.stringify(SAMPLE_JOURNEY));
  assert.equal(rawJourney.journey.id, 'editor-test');
});

test('projection helpers map journey widgets into stable tile coordinates and hit tests', () => {
  const data = createJourneyEditorProjectionData(SAMPLE_JOURNEY, { sampleStepSecs: 5 });
  const transform = createJourneyProjectionTransform({
    mode: 'xz',
    bounds: data.bounds,
    width: 400,
    height: 300,
    zoom: 1,
  });
  const projected = projectJourneyEditorPoint({ x: 5, y: 0, z: -2 }, transform);
  const hit = hitJourneyEditorMarker([
    { type: 'guide', id: 'guide-a', x: projected.x, y: projected.y, radius: 8 },
  ], projected.x + 2, projected.y + 1);

  assert.equal(data.samples.length, 3);
  assert.equal(transform.mode, 'xz');
  assert.ok(Number.isFinite(projected.x));
  assert.equal(hit?.id, 'guide-a');
});

test('headless editor handle updates snapshots, evaluates frames, and disposes cleanly', async () => {
  const changes = [];
  const editor = createJourneyVideoEditor({
    journey: SAMPLE_JOURNEY,
    editorState: { tileModes: ['xy', 'xz', 'yz', 'perspective'], zoom: 1 },
    onChange(document) {
      changes.push(document);
    },
  });

  editor.setTime(4.97);
  assert.equal(editor.getSnapshot().timeSecs, 4.95);
  assert.ok(editor.evaluateAt(5).observerPc.x > 4);
  editor.setTileMode(1, 'skykit');
  editor.setZoom(3);
  editor.selectWidget('guide', 'guide-a');

  const snapshot = editor.getSnapshot();
  assert.equal(snapshot.tileModes[1], 'skykit');
  assert.equal(snapshot.selectedWidget?.id, 'guide-a');
  assert.equal(changes.length, 4);

  editor.setJourney({ ...SAMPLE_JOURNEY, id: 'next-journey', durationSecs: 6 });
  assert.equal(editor.getJourney().id, 'next-journey');
  assert.equal(changes.length, 5);

  await editor.dispose();
  assert.equal(editor.getSnapshot().disposed, true);
  assert.throws(() => editor.setTime(1), /disposed/u);
});
