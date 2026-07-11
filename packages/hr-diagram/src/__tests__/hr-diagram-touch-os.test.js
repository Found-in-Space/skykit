import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEmbeddedSurface,
  createEmbeddedSurfaceService,
  createNode,
  createRuntime,
} from '@found-in-space/touch-os';

import { createHrDiagramEmbeddedSurfaceNode } from '../touch-os.js';

const SOURCE_ID = 'hr:test-surface';

test('HR node delegates to the public embedded-surface component and forwards its policy', () => {
  const node = createHrDiagramEmbeddedSurfaceNode({
    componentId: 'hr-node',
    sourceId: SOURCE_ID,
    title: 'Hertzsprung–Russell diagram',
    fallbackLabel: 'HR unavailable',
    preserveAspectRatio: true,
  });
  const publicNode = createEmbeddedSurface('public-node', { sourceId: 'public-source' });

  assert.equal(node.component, publicNode.component);
  assert.deepEqual(node.props, {
    sourceId: SOURCE_ID,
    title: 'Hertzsprung–Russell diagram',
    fallbackLabel: 'HR unavailable',
    preserveAspectRatio: true,
    interactive: false,
    acceptsForwardedInput: false,
    desiredSourceType: 'three-texture',
    compositionMode: 'composite',
  });
});

test('HR embedded surface preserves 1024x640 geometry across viewport shapes with title and padding', () => {
  const cases = [
    { name: 'portrait', size: [240, 400], expected: [12, 142.5, 216, 135] },
    { name: 'landscape', size: [400, 240], expected: [43.2, 32, 313.6, 196] },
    { name: 'square', size: [300, 300], expected: [12, 73.75, 276, 172.5] },
    { name: 'wide', size: [800, 200], expected: [275.2, 32, 249.6, 156] },
    { name: 'tall', size: [200, 800], expected: [12, 355, 176, 110] },
  ];

  for (const { name, size: [width, height], expected } of cases) {
    const { runtime, surfaces } = createFixture({ width, height, title: 'HR diagram' });
    const texture = { id: `${name}-texture` };
    surfaces.publish(SOURCE_ID, {
      available: true,
      handle: { kind: 'three-texture', texture },
      sourceWidth: 1024,
      sourceHeight: 640,
      sourceType: 'three-texture',
    });

    const snapshot = runtime.render();
    const surface = findCommand(snapshot.commands, 'embedded-surface-viewport');
    const title = findCommand(snapshot.commands, 'embedded-surface-title');

    assert.equal(surface.type, 'surface', `${name}: surface command`);
    assertRectClose(surface.rect, expected, name);
    assert.equal(surface.rect.width / surface.rect.height, 1.6, `${name}: aspect ratio`);
    assert.equal(surface.compositionMode, 'composite', `${name}: composite mode`);
    assert.equal(title.type, 'text', `${name}: title command`);
    assert.equal(title.text, 'HR diagram', `${name}: title text`);
    assert.deepEqual(title.rect, { x: 12, y: 4, width: width - 24, height: 18 });

    runtime.dispose();
  }
});

test('HR embedded surface may stretch to the padded content below its title', () => {
  const { runtime, surfaces } = createFixture({
    width: 240,
    height: 400,
    title: 'HR diagram',
    preserveAspectRatio: false,
  });
  surfaces.publish(SOURCE_ID, {
    available: true,
    handle: { kind: 'three-texture', texture: { id: 'stretch-texture' } },
    sourceWidth: 1024,
    sourceHeight: 640,
    sourceType: 'three-texture',
  });

  const surface = findCommand(runtime.render().commands, 'embedded-surface-viewport');
  assert.deepEqual(surface.rect, { x: 12, y: 32, width: 216, height: 356 });

  runtime.dispose();
});

test('HR embedded surface renders its fallback and title when the source is unavailable', () => {
  const { runtime } = createFixture({
    width: 320,
    height: 220,
    title: 'HR diagram',
    fallbackLabel: 'No stellar sample',
  });
  const commands = runtime.render().commands;
  const fallback = findCommand(commands, 'embedded-surface-placeholder-label');

  assert.equal(findCommand(commands, 'embedded-surface-title').text, 'HR diagram');
  assert.equal(fallback.type, 'text');
  assert.equal(fallback.text, 'No stellar sample');
  assert.deepEqual(fallback.rect, { x: 12, y: 32, width: 296, height: 176 });

  runtime.dispose();
});

test('HR composite command preserves ancestor clipping', () => {
  const surfaces = createEmbeddedSurfaceService();
  const hrNode = createHrDiagramEmbeddedSurfaceNode({
    componentId: 'hr-node',
    sourceId: SOURCE_ID,
  });
  const clipRect = { x: 20, y: 30, width: 120, height: 90 };
  const root = createNode('clip-root', {
    kind: 'hr-test-clip',
    getChildren() {
      return [hrNode];
    },
    measure(ctx) {
      return {
        width: ctx.constraints.maxWidth,
        height: ctx.constraints.maxHeight,
      };
    },
    layout(ctx) {
      ctx.setChildBounds(hrNode.id, { x: 0, y: 0, width: 200, height: 180 });
      ctx.setClipRect(clipRect);
    },
  }, {});
  const runtime = createRuntime({
    root,
    surface: { width: 200, height: 180 },
    services: { surfaces },
  });
  surfaces.publish(SOURCE_ID, {
    available: true,
    handle: { kind: 'three-texture', texture: { id: 'clipped-texture' } },
    sourceWidth: 1024,
    sourceHeight: 640,
    sourceType: 'three-texture',
  });

  const surface = findCommand(runtime.render().commands, 'embedded-surface-viewport');
  assert.equal(surface.compositionMode, 'composite');
  assert.deepEqual(surface.clipRect, clipRect);

  runtime.dispose();
});

test('HR embedded surface observes source revisions and texture replacement', () => {
  const { runtime, surfaces } = createFixture({ width: 320, height: 220 });
  const firstTexture = { id: 'texture-a' };
  const secondTexture = { id: 'texture-b' };

  surfaces.publish(SOURCE_ID, {
    available: true,
    handle: { kind: 'three-texture', texture: firstTexture },
    sourceWidth: 1024,
    sourceHeight: 640,
    sourceType: 'three-texture',
  });
  const first = findCommand(runtime.render().commands, 'embedded-surface-viewport');

  surfaces.publish(SOURCE_ID, {
    available: true,
    handle: { kind: 'three-texture', texture: secondTexture },
    sourceWidth: 1024,
    sourceHeight: 640,
    sourceType: 'three-texture',
  });
  const second = findCommand(runtime.render().commands, 'embedded-surface-viewport');

  assert.equal(first.handle.texture, firstTexture);
  assert.equal(second.handle.texture, secondTexture);
  assert.equal(second.surfaceRevision, first.surfaceRevision + 1);

  runtime.dispose();
});

function createFixture(options) {
  const surfaces = createEmbeddedSurfaceService();
  const root = createHrDiagramEmbeddedSurfaceNode({
    componentId: 'hr-node',
    sourceId: SOURCE_ID,
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.fallbackLabel === undefined ? {} : { fallbackLabel: options.fallbackLabel }),
    ...(options.preserveAspectRatio === undefined
      ? {}
      : { preserveAspectRatio: options.preserveAspectRatio }),
  });
  const runtime = createRuntime({
    root,
    surface: { width: options.width, height: options.height },
    services: { surfaces },
  });
  return { runtime, surfaces };
}

function findCommand(commands, role) {
  const command = commands.find((candidate) => candidate.role === role);
  assert.ok(command, `Expected a ${role} command.`);
  return command;
}

function assertRectClose(rect, expected, label) {
  const actual = [rect.x, rect.y, rect.width, rect.height];
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) < 1e-9,
      `${label}: rect[${index}] expected ${expected[index]}, received ${actual[index]}`,
    );
  }
}
