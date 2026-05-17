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
  buildJourneyVideoFfmpegArgs,
  buildJourneyVideoFfmpegFilter,
  computeJourneyVideoOverlayOpacity,
  createJourneyVideoOverlayBlocks,
  createJourneyVideoRenderMetadata,
  normalizeJourneyVideoLayout,
  normalizeJourneyVideoRenderProfile,
} from '../export.js';
import { normalizeJourneyVideoCliOptions } from '../export-node.js';
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

test('video export helpers normalize layout and render profile defaults', () => {
  const layout = normalizeJourneyVideoLayout('vertical-1080x1920');
  assert.equal(layout.width, 1080);
  assert.equal(layout.height, 1920);
  assert.equal(layout.text.titleFontSize, 52);

  const profile = normalizeJourneyVideoRenderProfile({
    mode: 'final',
    layout: 'square-1080',
    fps: 6,
    seconds: 2,
    crf: 17,
    retainFrames: true,
  });
  assert.equal(profile.mode, 'final');
  assert.equal(profile.layout.id, 'square-1080');
  assert.equal(profile.frameCount, 12);
  assert.equal(profile.browser, 'webkit');
  assert.equal(profile.retainFrames, true);
});

test('video export helpers extract cue overlay blocks and opacity fades', () => {
  const blocks = createJourneyVideoOverlayBlocks({
    ...SAMPLE_JOURNEY,
    cues: [
      {
        id: 'cue-a',
        startSecs: 1,
        endSecs: 5,
        fadeInSecs: 1,
        fadeOutSecs: 2,
        eyebrow: 'Scale',
        title: 'Light has a speed.',
        body: 'A transparent block is rendered once, then composited later.',
      },
    ],
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].id, 'cue-a');
  assert.equal(blocks[0].eyebrow, 'Scale');
  assert.equal(computeJourneyVideoOverlayOpacity(blocks[0], 0.5), 0);
  assert.equal(computeJourneyVideoOverlayOpacity(blocks[0], 2), 1);
  assert.equal(computeJourneyVideoOverlayOpacity(blocks[0], 4.5), 0.25);
});

test('video export helpers build ffmpeg overlay filters and args', () => {
  const overlayBlocks = [
    {
      id: 'cue-a',
      startSecs: 1,
      endSecs: 4,
      fadeInSecs: 0.5,
      fadeOutSecs: 0.75,
      eyebrow: '',
      title: 'Cue',
      body: '',
      assetPath: '/tmp/cue-a.png',
    },
  ];
  const filter = buildJourneyVideoFfmpegFilter(overlayBlocks);
  assert.match(filter, /fade=t=in/u);
  assert.match(filter, /overlay=0:0/u);
  assert.match(filter, /\[v\]/u);

  const args = buildJourneyVideoFfmpegArgs({
    profile: { mode: 'preview', fps: 12, layout: 'landscape-1080p', crf: 20 },
    skyFramePattern: '/tmp/frame-%06d.png',
    overlayBlocks,
    outputPath: '/tmp/out.mp4',
  });
  assert.deepEqual(args.slice(0, 5), ['-y', '-framerate', '12', '-i', '/tmp/frame-%06d.png']);
  assert.equal(args.includes('-filter_complex'), true);
  assert.equal(args.at(-1), '/tmp/out.mp4');
});

test('video export metadata and CLI options are deterministic', () => {
  const metadata = createJourneyVideoRenderMetadata({
    journey: { id: 'demo' },
    frameCount: 2,
  });
  assert.equal(metadata.format, 'fis-journey-video-render-v1');
  assert.equal(metadata.journey.id, 'demo');
  assert.equal(metadata.frameCount, 2);

  const options = normalizeJourneyVideoCliOptions([
    '--mode=preview',
    '--layout=landscape-1080p',
    '--frames=2',
    '--fps=1',
    '--journey=examples/radio-bubble/radio-bubble-journey.json',
    '--output-dir=video-output/test',
    '--discard-frames',
  ]);
  assert.equal(options.profile.frameCount, 2);
  assert.equal(options.profile.fps, 1);
  assert.equal(options.profile.retainFrames, false);
  assert.match(options.journeyPath, /examples\/radio-bubble\/radio-bubble-journey\.json$/u);
});
