import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createSkykitInteractionInput, createSkykitInteractionPlugin } from '../interaction.js';

test('interaction input uses connection identity for grip placement and restores borrowed mounts', () => {
  const previous = new THREE.Group(), origin = new THREE.Group(); origin.position.x = 5;
  const controllers = [new THREE.Group(), new THREE.Group()], grips = [new THREE.Group(), new THREE.Group()];
  previous.add(...controllers, ...grips); grips[1].position.x = 2;
  const left = { handedness: 'left' }, right = { handedness: 'right' };
  const session = Object.assign(new EventTarget(), { inputSources: [right, left], visibilityState: 'visible' });
  const xr = Object.assign(new THREE.EventDispatcher(), { getSession: () => session, getReferenceSpace: () => ({}),
    getController: i => controllers[i], getControllerGrip: i => grips[i] });
  const input = createSkykitInteractionInput({ renderer: { xr }, origin });
  controllers[1].dispatchEvent({ type: 'connected', data: left }); controllers[0].dispatchEvent({ type: 'connected', data: right });
  assert.equal(input.getGripPose('left').position.x, 7);
  session.inputSources.reverse(); assert.equal(input.getGripPose('left').position.x, 7);
  controllers[1].dispatchEvent({ type: 'disconnected' }); assert.equal(input.getGripPose('left'), undefined);
  input.dispose(); input.dispose();
  for (const object of [...controllers, ...grips]) assert.equal(object.parent, previous);
});

test('one borrowed environment is scheduled after placement using the input clock', () => {
  let part, received;
  const environment = { update: frame => { received = frame; } };
  const plugin = createSkykitInteractionPlugin({ environment, now: () => 123, frame: () => ({ anchorPose: undefined }) });
  plugin.setup({ addPart: value => { part = value; } });
  assert.equal(part.priority, 200);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); part.update({ scene, camera });
  assert.equal(received.timestamp, 123); assert.equal(received.scene, scene); assert.equal(received.camera, camera);
});
