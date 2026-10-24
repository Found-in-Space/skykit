import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createStarCellData } from '@found-in-space/star-trees';
import { createSlider } from '@found-in-space/touch-os';
import { createThreeUIEnvironment } from '@found-in-space/touch-os/hosts/three';
import { createThreeStarField } from '../index.js';
import { createThreeStarFieldTarget } from '../interaction.js';

function cell() {
  return createStarCellData({ node: { level: 0, gridX: 0, gridY: 0, gridZ: 0, mortonCode: '0', centerX: 0, centerY: 0, centerZ: -5, halfSize: 1 },
    datasetId: 'interaction-fixture', attributes: ['position', 'magAbs', 'teffLog8', 'objectRef', 'pickMeta'],
    decoded: { count: 1, positionsPc: new Float32Array([0, 0, -5]), magAbs: new Float32Array([1]), teffLog8: new Uint8Array([128]) } });
}
function canvas(metrics) {
  const context = new Proxy({ measureText: text => ({ width: text.length * 8 }) }, { get: (object, key) => object[key] ?? (() => {}) });
  return { width: metrics.width, height: metrics.height, getContext: () => context };
}
function source(x = 0, y = 0) { return { id: 'right', pointerType: 'controller', tracked: true, space: 'world-metres', ray: { origin: { x, y, z: 2 }, direction: { x: 0, y: 0, z: -1 } } }; }
function edge(phase, timestamp, input) { return { phase, timestamp, source: input }; }

test('real field remains eligible behind a captured slider, without selection leaking through release', () => {
  const scene = new THREE.Scene();
  const field = createThreeStarField({ materialProfile: new THREE.PointsMaterial() }); field.setCells([cell()]); scene.add(field.object3d);
  let selected; const adapter = createThreeStarFieldTarget({ id: 'stars', field, pickOptions: { toleranceDeg: 2 }, onSelect: result => { selected = result; } });
  const env = createThreeUIEnvironment({ parent: scene }); env.registerTarget(adapter);
  let applied = 50;
  const panel = env.mountPanel({ id: 'panel', surface: { width: 200, height: 100 },
    content: () => createSlider('scale', { label: 'Scale', value: applied, min: 0, max: 100, field: 'scale' }),
    placement: { panelWidth: 1, panelHeight: 0.5, createCanvas: canvas },
    bind(output) { if (output.type === 'change-request' && output.phase === 'update') applied = output.value; } });
  env.update({ timestamp: 0 });
  const thumb = panel.runtime.render().commands.find(c => c.role === 'slider-thumb');
  const ray = source(thumb.cx / 200 - 0.5, 0.25 - thumb.cy / 100 * 0.5);
  assert.ok(field.pick(ray.ray, { toleranceDeg: 2 }), 'A real star must be eligible behind the slider');
  env.update({ timestamp: 1, sources: [ray], edges: [edge('begin', 1, ray)] });
  const outside = source(1, ray.ray.origin.y);
  env.update({ timestamp: 2, sources: [outside] });
  env.update({ timestamp: 3, sources: [outside], edges: [edge('complete', 3, outside)] });
  assert.equal(applied, 100); assert.equal(selected, undefined);
  panel.hide();
  const unblocked = source(); const expected = field.pick(unblocked.ray, { toleranceDeg: 2 });
  env.update({ timestamp: 4, sources: [unblocked], edges: [edge('begin', 4, unblocked)] });
  env.update({ timestamp: 5, sources: [unblocked], edges: [edge('complete', 5, unblocked)] });
  assert.deepEqual(selected, expected); assert.ok(selected.objectRef); assert.equal(selected.cell, expected.cell);
  assert.equal(field.object3d.children.length, 1); env.dispose(); field.dispose();
});

test('adapter delegates tolerance and scoring, returning world distance after translated/scaled placement', () => {
  const field = createThreeStarField({ materialProfile: new THREE.PointsMaterial() }); field.setCells([cell()]);
  field.object3d.position.set(3, 1, 0); field.object3d.scale.setScalar(2);
  let actualOptions;
  const pick = field.pick; field.pick = (ray, options) => { actualOptions = options; return pick(ray, options); };
  const options = { toleranceDeg: 0.01, minClickRadiusDeg: 0.005 };
  const adapter = createThreeStarFieldTarget({ id: 'stars', field, pickOptions: () => options, onSelect() {} });
  const ray = source(3, 1); const hit = adapter.query(ray);
  assert.ok(hit); assert.equal(actualOptions, options); assert.equal(hit.distance, 12);
  assert.deepEqual({ ...hit.point }, { x: 3, y: 1, z: -10 }); assert.equal(hit.metadata.score, 0);
  ray.ray.origin.x += 0.5; assert.equal(adapter.query(ray), null); field.dispose();
});

test('scene occlusion blocks the real aggregate picker without changing its selection result after reveal', () => {
  const scene = new THREE.Scene();
  const field = createThreeStarField({ materialProfile: new THREE.PointsMaterial() }); field.setCells([cell()]); scene.add(field.object3d);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial()); wall.position.z = -1; scene.add(wall);
  const selections = [];
  const env = createThreeUIEnvironment({ parent: scene });
  env.registerTarget(createThreeStarFieldTarget({ id: 'stars', field, onSelect: result => selections.push(result) }));
  const ray = source(); assert.ok(field.pick(ray.ray), 'The underlying real picker must remain eligible');
  for (const [timestamp, phase] of [[1, 'begin'], [2, 'complete']]) env.update({ timestamp, sources: [ray], edges: [edge(phase, timestamp, ray)] });
  assert.equal(selections.length, 0);
  wall.visible = false;
  for (const [timestamp, phase] of [[3, 'begin'], [4, 'complete']]) env.update({ timestamp, sources: [ray], edges: [edge(phase, timestamp, ray)] });
  assert.deepEqual(selections, [field.pick(ray.ray)]);
  env.dispose(); field.dispose(); wall.geometry.dispose(); wall.material.dispose();
});
