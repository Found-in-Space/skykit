import assert from 'node:assert/strict';
import test from 'node:test';
import { createTouchDisplay } from '../touch-display.js';

function createFakeCanvasContext() {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    clearRect() {},
    fill() {},
    stroke() {},
    beginPath() {},
    arc() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    fillText() {},
    measureText() { return { width: 40 }; },
  };
}

function installFakeDocument() {
  const savedDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') {
        throw new Error(`Unsupported element: ${tag}`);
      }
      return {
        width: 0,
        height: 0,
        getContext() {
          return createFakeCanvasContext();
        },
      };
    },
  };
  return () => {
    globalThis.document = savedDocument;
  };
}

function hitFromPx(x, y, width = 400, height = 560) {
  return {
    u: x / width,
    v: 1 - (y / height),
  };
}

test('touch display dispatches button actions', () => {
  const restoreDocument = installFakeDocument();

  try {
    const calls = [];
    const display = createTouchDisplay({
      items: [
        { id: 'selection', label: 'Selection', type: 'button' },
      ],
      onAction(id, value) {
        calls.push({ id, value });
      },
    });

    display.draw();
    display.handlePointer(hitFromPx(200, 100), true);
    display.handlePointer(hitFromPx(200, 100), false);

    assert.deepEqual(calls, [
      { id: 'selection', value: undefined },
    ]);
  } finally {
    restoreDocument();
  }
});

test('touch display delegates dragging to range controls', () => {
  const restoreDocument = installFakeDocument();

  try {
    const calls = [];
    const display = createTouchDisplay({
      items: [
        {
          id: 'world-scale',
          label: 'World Scale',
          type: 'range',
          value: 0,
          min: 0,
          max: 10,
          step: 1,
        },
      ],
      onAction(id, value) {
        calls.push({ id, value });
      },
    });

    display.draw();
    display.handlePointer(hitFromPx(36, 124), true);
    display.handlePointer(hitFromPx(364, 124), true);
    display.handlePointer(hitFromPx(364, 124), false);

    assert.equal(display.getItem('world-scale')?.value, 10);
    assert.deepEqual(calls, [
      { id: 'world-scale', value: 10 },
    ]);
  } finally {
    restoreDocument();
  }
});

test('touch display supports display sub-controls for actions and dismiss', () => {
  const restoreDocument = installFakeDocument();

  try {
    const calls = [];
    const display = createTouchDisplay({
      items: [
        {
          id: 'star-info',
          label: 'Selected Target',
          type: 'display',
          lines: ['Sirius', 'Distance: 2.6 pc'],
          dismissible: true,
          actionId: 'go-selected',
          actionLabel: 'Go to Selected',
        },
      ],
      onAction(id) {
        calls.push(id);
      },
    });

    display.draw();
    const rect = display.getRectForItem('star-info');
    const dismissX = rect.x + rect.w - 24;
    const dismissY = rect.y + 24;
    const actionX = rect.x + rect.w / 2;
    const actionY = rect.y + rect.h - 28;

    display.handlePointer(hitFromPx(dismissX, dismissY), true);
    display.handlePointer(hitFromPx(dismissX, dismissY), false);
    display.handlePointer(hitFromPx(actionX, actionY), true);
    display.handlePointer(hitFromPx(actionX, actionY), false);

    assert.deepEqual(calls, ['star-info', 'go-selected']);
  } finally {
    restoreDocument();
  }
});
