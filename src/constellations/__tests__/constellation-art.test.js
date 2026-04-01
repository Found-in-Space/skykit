import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createConstellationArtGroup,
  loadConstellationArtManifest,
} from '../constellation-art.js';

const SAMPLE_MANIFEST = {
  id: 'western',
  constellations: [
    {
      id: 'CON western Ori',
      iau: 'Ori',
      image: {
        file: 'illustrations/orion.webp',
        size: [512, 512],
        anchors: [
          { pos: [40, 80], hip: 1, direction: [1, 0, 0] },
          { pos: [220, 70], hip: 2, direction: [0, 1, 0] },
          { pos: [200, 340], hip: 3, direction: [0, 0, 1] },
        ],
      },
    },
  ],
};

function createFakeTextureLoader(requests) {
  return {
    load(url, onLoad) {
      requests.push(url);
      onLoad({
        dispose() {},
      });
    },
  };
}

test('loadConstellationArtManifest fetches a manifest from manifestUrl', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    async json() {
      return {
        id: 'fetched-manifest',
        url,
        constellations: [],
      };
    },
  });

  try {
    const manifest = await loadConstellationArtManifest({
      manifestUrl: 'https://example.com/package/dist/manifest.json',
    });

    assert.equal(manifest.id, 'fetched-manifest');
    assert.equal(manifest.url, 'https://example.com/package/dist/manifest.json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createConstellationArtGroup resolves relative image files against manifestUrl', async () => {
  const requests = [];
  const group = await createConstellationArtGroup({
    manifest: SAMPLE_MANIFEST,
    manifestUrl: 'https://cdn.example.com/package/dist/manifest.json',
    textureLoader: createFakeTextureLoader(requests),
  });

  try {
    assert.equal(group.children.length, 1);
    assert.deepEqual(requests, [
      'https://cdn.example.com/package/dist/illustrations/orion.webp',
    ]);
  } finally {
    group.userData.constellationArt.dispose();
  }
});

test('createConstellationArtGroup prefers explicit image URLs such as data URLs', async () => {
  const requests = [];
  const group = await createConstellationArtGroup({
    manifest: {
      id: 'inline-art',
      constellations: [
        {
          id: 'inline-ori',
          iau: 'Ori',
          image: {
            url: 'data:image/webp;base64,AAA=',
            size: [256, 256],
            anchors: [
              { pos: [20, 20], direction: [1, 0, 0] },
              { pos: [220, 20], direction: [0, 1, 0] },
              { pos: [120, 220], direction: [0, 0, 1] },
            ],
          },
        },
      ],
    },
    textureLoader: createFakeTextureLoader(requests),
  });

  try {
    assert.equal(group.children.length, 1);
    assert.deepEqual(requests, ['data:image/webp;base64,AAA=']);
    assert.equal(group.children[0].userData.iau, 'Ori');
  } finally {
    group.userData.constellationArt.dispose();
  }
});
