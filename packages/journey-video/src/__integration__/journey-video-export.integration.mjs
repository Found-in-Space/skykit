import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runJourneyVideoExport } from '../export-node.js';

test('journey video export renders a two-frame package fixture', async () => {
  const result = await runJourneyVideoExport({
    profile: {
      mode: 'preview',
      layout: 'landscape-1080p',
      fps: 1,
      frameCount: 2,
      retainFrames: true,
    },
    journeyPath: fileURLToPath(new URL('../../examples/radio-bubble/radio-bubble-journey.json', import.meta.url)),
    outputDir: 'video-output/journey-video-integration',
  });

  assert.equal(result.metadata.frameCount, 2);
  assert.match(result.videoPath, /journey-video-landscape-1080p-preview\.mp4$/u);
  assert.equal(Array.isArray(result.metadata.overlayBlocks), true);
});
