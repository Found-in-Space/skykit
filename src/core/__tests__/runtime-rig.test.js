import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createDesktopRig, createXrRig } from '../runtime-rig.js';

test('createDesktopRig creates stable roots for content, camera, and attachments', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createDesktopRig(camera);

  assert.equal(rig.type, 'desktop');
  assert.equal(rig.navigationRoot.name, 'navigationRoot');
  assert.equal(rig.cameraMount.name, 'cameraMount');
  assert.equal(rig.attachmentRoot.name, 'attachmentRoot');
  assert.equal(rig.contentRoot.name, 'contentRoot');
  assert.equal(rig.mount, rig.contentRoot);
  assert.equal(camera.parent, rig.cameraMount);
  assert.ok(rig.navigationRoot.children.includes(rig.cameraMount));
  assert.ok(rig.navigationRoot.children.includes(rig.attachmentRoot));
});

test('createDesktopRig keeps contentRoot and navigationRoot as independent trees', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createDesktopRig(camera);

  assert.equal(rig.contentRoot.parent, null, 'contentRoot has no parent before scene');
  assert.equal(rig.navigationRoot.parent, null, 'navigationRoot has no parent before scene');
});

test('createXrRig builds spaceship hierarchy with deck -> xrOrigin -> camera', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createXrRig(camera);

  assert.equal(rig.type, 'xr');
  assert.equal(rig.navigationRoot.name, 'spaceship');
  assert.equal(rig.deck.name, 'deck');
  assert.equal(rig.cameraMount.name, 'xrOrigin');
  assert.equal(rig.contentRoot.name, 'universe');
  assert.equal(rig.mount, rig.contentRoot);

  assert.equal(camera.parent, rig.cameraMount, 'camera is child of xrOrigin');
  assert.equal(rig.cameraMount.parent, rig.deck, 'xrOrigin is child of deck');
  assert.equal(rig.deck.parent, rig.navigationRoot, 'deck is child of spaceship');
});

test('createXrRig keeps universe and spaceship as independent trees (siblings)', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createXrRig(camera);

  assert.equal(rig.contentRoot.parent, null, 'universe has no parent before scene');
  assert.equal(rig.navigationRoot.parent, null, 'spaceship has no parent before scene');
});

test('createXrRig both roots are added to the scene as siblings', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createXrRig(camera);
  const scene = new THREE.Scene();

  scene.add(rig.navigationRoot);
  scene.add(rig.contentRoot);

  assert.equal(rig.navigationRoot.parent, scene);
  assert.equal(rig.contentRoot.parent, scene);
  assert.ok(scene.children.includes(rig.navigationRoot));
  assert.ok(scene.children.includes(rig.contentRoot));
});

test('createXrRig deck shifts observer DOWN and BACK so Sun appears at eye level', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createXrRig(camera);

  assert.ok(Math.abs(rig.deck.position.y - (-1.6)) < 1e-5, 'deck y = -eyeLevel (observer goes DOWN)');
  assert.ok(Math.abs(rig.deck.position.z - 0.5) < 1e-5, 'deck z = +forwardOffset (observer goes BACK)');
  assert.equal(rig.deck.position.x, 0, 'deck x = 0');
});

test('createXrRig universe stays at origin', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createXrRig(camera);

  assert.equal(rig.contentRoot.position.x, 0);
  assert.equal(rig.contentRoot.position.y, 0);
  assert.equal(rig.contentRoot.position.z, 0);
});

test('createXrRig scales universe by starFieldScale / SCALE', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createXrRig(camera, { starFieldScale: 1.0 });

  assert.equal(rig.contentRoot.scale.x, 1000, '1.0 / 0.001 = 1000');
  assert.equal(rig.contentRoot.scale.y, 1000);
  assert.equal(rig.contentRoot.scale.z, 1000);
});

test('createXrRig setStarFieldScale updates universe scale', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createXrRig(camera, { starFieldScale: 1.0 });

  rig.setStarFieldScale(2.0);
  assert.equal(rig.contentRoot.scale.x, 2000, '2.0 / 0.001 = 2000');
});

test('createXrRig accepts custom eye level and forward offset', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createXrRig(camera, { eyeLevel: 2.0, forwardOffset: 1.0 });

  assert.equal(rig.sunEyeLevel, 2.0);
  assert.equal(rig.sunForwardOffset, 1.0);
  assert.ok(Math.abs(rig.deck.position.y - (-2.0)) < 1e-5, 'deck y = -2.0');
  assert.ok(Math.abs(rig.deck.position.z - 1.0) < 1e-5, 'deck z = +1.0');
});

test('createXrRig attachmentRoot is child of deck', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createXrRig(camera);

  assert.ok(rig.attachmentRoot);
  assert.equal(rig.attachmentRoot.parent, rig.deck, 'attachmentRoot is child of deck');
});
