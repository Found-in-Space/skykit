import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';

import {
  applySkykitXrDepthRange,
  computeSkykitXrDepthRange,
  createSkykitXrBodyPlugin,
  createSkykitXrBodyTracker,
  createSkykitXrControlBindings,
  createSkykitXrNavigationPlugin,
  createSkykitXrObserverRig,
  createSkykitXrPickRouter,
  createSkykitXrRaySource,
  createSkykitXrRayVisualPlugin,
  createSkykitXrRig,
  createSkykitXrSessionPlugin,
  createSkykitXrStarPickingPlugin,
  enterSkykitXrSession,
  exitSkykitXrSession,
  isSkykitXrModeSupported,
} from '../xr.js';
import { createSkykitActionRegistry } from '../index.js';

test('xr free-roam demo uses restored alpha XR regressions defaults', () => {
  const source = readFileSync(new URL('../../../../apps/examples/xr-free-roam/xr-free-roam.js', import.meta.url), 'utf8');
  const exampleHtml = readFileSync(new URL('../../../../apps/examples/xr-free-roam/index.html', import.meta.url), 'utf8');
  const rootDemoHtml = readFileSync(new URL('../../../../demos/xr-free-roam.html', import.meta.url), 'utf8');

  assert.match(source, /createDefaultThreeStarFieldMaterialProfile/);
  assert.doesNotMatch(source, /createVrThreeStarFieldMaterialProfile/);
  assert.match(source, /createSkykitXrRayVisualPlugin/);
  assert.match(source, /createSkykitXrBodyPlugin/);
  assert.match(source, /createSurfaceShell/);
  assert.match(source, /createMetaSidecarProviderService/);
  assert.match(source, /deriveMetaSidecarUrlFromRenderUrl/);
  assert.match(source, /metaSidecarEntryDisplayFields/);
  assert.match(source, /datasetId:\s*DATASET_ID_c56103/);
  assert.match(source, /attributes:\s*\[\s*'objectRef'\s*,\s*'pickMeta'\s*\]/);
  assert.match(source, /selectSun:\s*'xr-demo:selected\.sun'/);
  assert.match(source, /primaryActionId:\s*XR_DEMO_ACTIONS\.goSelected/);
  assert.match(source, /primaryActionLabel:\s*'Fly to'/);
  assert.match(source, /homeControl:\s*'button'/);
  assert.match(source, /pointerType:\s*'ray'/);
  assert.match(source, /return xrRig\.leftHandRoot/);
  assert.match(source, /latestPanelFrame = rootContext\?\.frame \?\? latestPanelFrame/);
  assert.doesNotMatch(source, /dragThreshold/);
  assert.doesNotMatch(source, /driver:\s*'pose-anchored'/);
  assert.doesNotMatch(source, /anchorPose/);
  assert.doesNotMatch(source, /latestPanelFrame = frame/);
  assert.doesNotMatch(source, /createChoiceGroup/);
  assert.doesNotMatch(source, /createSlider/);
  assert.doesNotMatch(source, /createToggle/);
  assert.doesNotMatch(source, /createStack/);
  assert.doesNotMatch(source, /waypointPrefix/);
  assert.doesNotMatch(source, /panelState\.page/);

  assert.match(source, /refreshStarStatus/);
  assert.match(source, /setPreflightCheckState/);
  assert.match(source, /resolveEnterButtonLabel/);
  assert.match(source, /PREFLIGHT_BACKGROUND_ORBIT_RADIUS_PC\s*=\s*2/);
  assert.match(source, /PREFLIGHT_BACKGROUND_ORBIT_SPEED_RAD_PER_SEC/);
  assert.match(source, /observerPc:\s*PREFLIGHT_BACKGROUND_OBSERVER_PC/);
  assert.match(source, /targetPc:\s*SOL_PC/);
  assert.match(source, /startPreflightBackgroundOrbit/);
  assert.match(source, /SKYKIT_ACTIONS\.navigation\.orbit/);
  assert.match(source, /center:\s*SOL_PC/);
  assert.match(source, /radius:\s*PREFLIGHT_BACKGROUND_ORBIT_RADIUS_PC/);
  assert.match(source, /SKYKIT_ACTIONS\.navigation\.lockAt/);
  assert.match(source, /stopPreflightBackgroundOrbit/);
  assert.match(source, /SKYKIT_ACTIONS\.navigation\.cancelMovement/);
  assert.match(source, /Enter VR/);
  assert.match(source, /slider\('Limit', 'limitingMagnitude'/);
  assert.match(source, /slider\('Exposure', 'exposureLog10'/);
  assert.match(source, /slider\('Scale', 'worldScaleLog10'/);
  assert.match(source, /toggle\('Nearby glow', 'nearFloor'/);
  assert.match(source, /toggle\('Constellation art', 'constellationArt'/);
  assert.match(source, /XR_CONSTELLATION_ART_RADIUS_WORLD_UNITS\s*=\s*8000/);
  assert.match(source, /createHeadGazeAnchoredImageController/);
  assert.match(source, /setViewDirectionIcrs\?\.\(resolveHeadGazeDirectionIcrs\(body, xrRig, camera\)\)/);
  assert.match(source, /body\?\.head\?\.orientation/);
  assert.match(source, /getNavigationPose\?\.\(\)\.orientation/);
  assert.match(source, /strategy:\s*'nearest'/);
  assert.match(source, /maxAngleDeg:\s*XR_CONSTELLATION_ART_MAX_ANGLE_DEG/);
  assert.match(source, /anchorMode:\s*'observer-centric'/);
  assert.match(source, /radius:\s*XR_CONSTELLATION_ART_RADIUS_WORLD_UNITS/);
  assert.match(source, /XR_CONSTELLATION_ART_RADIUS_WORLD_UNITS \/ worldScale/);
  assert.doesNotMatch(source, /strategy:\s*'within-angle'/);
  for (const html of [exampleHtml, rootDemoHtml]) {
    assert.match(html, /data-preflight-check="skykit"/);
    assert.match(html, /data-preflight-check="stars"/);
    assert.match(html, /data-preflight-check="xr"/);
    assert.match(html, /SkyKit available/);
    assert.match(html, /Stars loading/);
    assert.match(html, /XR environment available/);
    assert.match(html, /Found in Space - SkyKit/);
    assert.match(html, /VR Free Roam/);
    assert.match(html, /src="%BASE_URL%robbie\.svg"/);
    assert.match(html, /Pre Flight Checklist/);
    assert.match(html, /data-xr-requirements/);
    assert.match(html, /Running checklist/);
    assert.doesNotMatch(html, /data-xr-settings/);
    assert.doesNotMatch(html, /data-setting/);
    assert.doesNotMatch(html, /Enter VR/);
  }
});

test('skykit/xr rig builds multi-root hierarchy', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createSkykitXrRig({
    camera,
    navigationPose: {
      position: { x: 1, y: 2, z: 3 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    scaleBandIds: ['galaxy'],
  });
  assert.equal(rig.headRoot.children.includes(camera), true);
  assert.notEqual(rig.originContentRoot, rig.observerContentRoot);
  assert.notEqual(rig.originContentRoot, rig.navigationRoot);
  assert.ok(rig.getScaleBandedContentRoot('galaxy'));
  rig.syncObserverContentRoot();
  assert.deepEqual(rig.observerContentRoot.position.toArray(), [1, 2, 3]);
  rig.dispose();
  rig.dispose();
});

test('skykit/xr control bindings read axes and button edges', () => {
  const source = {
    handedness: 'right',
    gamepad: {
      axes: [0.5, -0.75],
      buttons: [{ pressed: true, touched: true, value: 1 }],
    },
  };
  const controls = createSkykitXrControlBindings({
    axes: { move: { hand: 'right', axes: [0, 1] } },
    buttons: { select: { hand: 'right', button: 'trigger' } },
  });
  controls.update({ inputSources: [source] });
  assert.equal(controls.getAxis('move').x, 0.5);
  assert.equal(controls.getButton('select').pressed, true);
  assert.equal(controls.getButton('select').pressedEdge, true);
  controls.update({ inputSources: [source] });
  assert.equal(controls.getButton('select').pressedEdge, false);
  controls.dispose();
});

test('skykit/xr body, rays, and pick router compose generic route results', () => {
  const rig = createSkykitXrRig();
  const body = createSkykitXrBodyTracker().update({
    rig,
    shipPose: {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
  });
  const raySource = createSkykitXrRaySource({ kind: 'ship-forward', length: 12 });
  const ray = raySource.getRay({ rig, body });
  assert.ok(ray);
  assert.equal(ray.direction.z, -1);

  const router = createSkykitXrPickRouter({
    raySource,
    targets: [() => ({ distance: 3, object: 'target' })],
  });
  const route = router.route({ rig, body });
  assert.equal(route.type, 'hit');
  assert.equal(route.hit.object, 'target');
});

test('skykit/xr body plugin drives tracked hand roots before dependent parts', () => {
  const rig = createSkykitXrRig();
  const leftGripSpace = {};
  const referenceSpace = {};
  const bodyUpdates = [];
  let part = null;
  const plugin = createSkykitXrBodyPlugin({
    rig,
    onBody(body) {
      bodyUpdates.push(body);
    },
  });
  plugin.setup(createPluginContext({
    addPart(nextPart) {
      part = nextPart;
    },
  }));

  part.update(createXrFrame({
    referenceSpace,
    inputSources: [{
      handedness: 'left',
      gripSpace: leftGripSpace,
      gamepad: {
        buttons: [{ pressed: false, touched: false, value: 0 }],
        axes: [0, 0],
      },
    }],
    xrFrame: {
      getPose(space, ref) {
        assert.equal(ref, referenceSpace);
        if (space !== leftGripSpace) return null;
        return {
          transform: {
            position: { x: 0.1, y: 0.2, z: 0.3 },
            orientation: { x: 0, y: 0, z: 0, w: 1 },
          },
        };
      },
    },
  }));

  assert.deepEqual(rig.leftHandRoot.position.toArray(), [0.1, 0.2, 0.3]);
  assert.equal(rig.leftHandRoot.visible, true);
  assert.equal(rig.rightHandRoot.visible, false);
  assert.equal(plugin.getBody().leftHand?.buttons, 1);
  assert.equal(bodyUpdates.length, 1);
});

test('skykit/xr depth helpers compute and apply render state', () => {
  const range = computeSkykitXrDepthRange({
    visibleBounds: { min: { x: -1, y: -1, z: -20 }, max: { x: 1, y: 1, z: -10 } },
    scale: { navigationUnits: 'pc', metersPerNavigationUnit: 10 },
    observerCentricSpheres: [{ radiusNavigationUnits: 30 }],
  });
  assert.ok(range.depthFar >= 100);

  let state = null;
  const result = applySkykitXrDepthRange({
    updateRenderState(next) {
      state = next;
    },
  }, range);
  assert.equal(result.applied, true);
  assert.deepEqual(state, { depthNear: range.depthNear, depthFar: range.depthFar });
});

test('skykit/xr depth helpers include distant visible star bounds', () => {
  const range = computeSkykitXrDepthRange({
    observer: { x: 0, y: 0, z: 0 },
    visibleBounds: {
      min: { x: 62, y: 602, z: -13 },
      max: { x: 64, y: 604, z: -11 },
    },
    observerCentricSpheres: [{ radiusNavigationUnits: 16 }],
    scale: {
      navigationUnits: 'pc',
      metersPerNavigationUnit: 1,
      worldUnitsPerNavigationUnit: 1,
    },
    policy: {
      near: 0.03,
      minFar: 100,
      maxFar: 2000000,
      marginFactor: 1.2,
    },
  });

  assert.ok(range.far > 720);
  assert.ok(range.telemetry.farthestVisibleBoundsDistance > 600);
  assert.equal(range.telemetry.farthestObserverCentricSphereDistance, 16);
});

test('skykit/xr session helpers use injected navigator', async () => {
  let ended = false;
  const session = {
    async requestReferenceSpace(type) {
      return { type };
    },
    async end() {
      ended = true;
    },
    addEventListener() {},
  };
  const navigator = {
    xr: {
      async isSessionSupported(mode) {
        return mode === 'immersive-vr';
      },
      async requestSession(_mode, init) {
        this.lastInit = init;
        return session;
      },
    },
  };
  assert.equal(await isSkykitXrModeSupported('immersive-vr', { navigator }), true);
  const handle = await enterSkykitXrSession({ navigator, mode: 'immersive-vr' });
  assert.equal(handle.presenting, true);
  assert.deepEqual(navigator.xr.lastInit.optionalFeatures, ['local-floor']);
  await exitSkykitXrSession(handle);
  assert.equal(ended, true);
});

test('skykit/xr observer rig bridges viewer state to an XR rig without camera reparenting', () => {
  const rig = createSkykitXrRig();
  const observer = createSkykitXrObserverRig({ rig, coordinateUnitsPerParsec: 0.5 });

  observer.setObserverPc({ x: 2, y: 3, z: 4 });
  observer.update?.({
    deltaSeconds: 0.5,
    view: { coordinateUnitsPerParsec: 2 },
  });

  assert.deepEqual(observer.getObserverPc(), { x: 2, y: 3, z: 4 });
  assert.deepEqual(observer.getRenderObserverPosition(), { x: 4, y: 6, z: 8 });
  assert.equal(rig.getScaleProfile().worldUnitsPerNavigationUnit, 2);
});

test('skykit/xr session plugin registers enter/exit actions and syncs snapshot state', async () => {
  let activeSession = null;
  let requestedReferenceSpaceCount = 0;
  const session = {
    async requestReferenceSpace(type) {
      requestedReferenceSpaceCount += 1;
      return { type };
    },
    async end() {
      this.ended = true;
      activeSession = null;
      renderer.xr.isPresenting = false;
    },
    addEventListener() {},
  };
  let rendererReferenceSpaceType = null;
  const renderer = {
    xr: {
      enabled: false,
      isPresenting: false,
      getSession() {
        return activeSession;
      },
      setReferenceSpaceType(type) {
        rendererReferenceSpaceType = type;
      },
      async setSession(nextSession) {
        activeSession = nextSession;
        this.isPresenting = Boolean(nextSession);
      },
    },
  };
  const navigator = {
    xr: {
      async isSessionSupported() {
        return true;
      },
      async requestSession(_mode, init) {
        this.lastInit = init;
        return session;
      },
    },
  };
  const actions = createSkykitActionRegistry();
  let part = null;
  const events = [];
  const plugin = createSkykitXrSessionPlugin({ renderer, navigator });
  plugin.setup(createPluginContext({
    actions,
    addPart(nextPart) {
      part = nextPart;
    },
    emit(event) {
      events.push(event.type);
    },
  }));

  await actions.invoke('skykit:xr.enter');
  assert.equal(renderer.xr.enabled, true);
  assert.equal(rendererReferenceSpaceType, 'local-floor');
  assert.deepEqual(navigator.xr.lastInit.optionalFeatures, ['local-floor']);
  assert.equal(requestedReferenceSpaceCount, 0);
  assert.equal(activeSession, session);
  assert.equal(plugin.getSnapshot().presenting, true);
  assert.equal(plugin.getSnapshot().enterStage, 'presenting');

  const frame = createXrFrame({ renderer });
  part.update(frame);
  assert.equal(frame.xr.presenting, true);
  assert.equal(frame.xr.session, session);

  await actions.invoke('skykit:xr.exit');
  assert.equal(activeSession, null);
  assert.equal(session.ended, true);
  assert.deepEqual(events, ['xr/session-start', 'xr/session-end']);
});

test('skykit/xr navigation plugin updates viewer state from controller axes', () => {
  const actions = createSkykitActionRegistry();
  let part = null;
  const patches = [];
  const plugin = createSkykitXrNavigationPlugin({ moveSpeedPcPerSec: 10 });
  plugin.setup(createPluginContext({
    actions,
    addPart(nextPart) {
      part = nextPart;
    },
  }));

  part.update(createXrFrame({
    actions,
    inputSources: [{
      handedness: 'right',
      gamepad: {
        axes: [0, -1],
        buttons: [],
      },
    }],
    requestViewState(patch) {
      patches.push(patch);
    },
  }));

  assert.equal(patches.length, 1);
  assert.equal(patches[0].observerPc.z, -0.16);
  assert.deepEqual(actions.getControlValue('skykit:ship.control.move'), { x: 0, y: 0, z: -10 });
});

test('skykit/xr ray visual shows the controller ray and shortens at blockers', () => {
  let part = null;
  let disposedRaySource = false;
  const plugin = createSkykitXrRayVisualPlugin({
    raySource: {
      getRay() {
        return {
          id: 'ray',
          kind: 'target-ray',
          handedness: 'right',
          origin: { x: 1, y: 2, z: 3 },
          direction: { x: 0, y: 0, z: -1 },
          length: 10,
        };
      },
      getSnapshot() {
        return { id: 'ray-source' };
      },
      dispose() {
        disposedRaySource = true;
      },
    },
    blockers: [{
      blockRay() {
        return { blocked: true, distance: 3, hit: { componentId: 'panel' } };
      },
    }],
  });
  const context = createPluginContext({
    addPart(nextPart) {
      part = nextPart;
    },
  });
  plugin.setup(context);
  part.attach(context);

  part.update(createXrFrame());

  assert.equal(part.object3d.visible, true);
  assert.equal(plugin.getSnapshot().blocked, true);
  assert.equal(plugin.getSnapshot().lastLength, 3);
  assert.deepEqual(
    Array.from(part.object3d.children[0].geometry.getAttribute('position').array),
    [1, 2, 3, 1, 2, 0],
  );

  part.update({ ...createXrFrame(), xr: { presenting: false } });
  assert.equal(part.object3d.visible, false);
  part.dispose();
  assert.equal(disposedRaySource, true);
});

test('skykit/xr star picking fires only on trigger edge and registers attribute-only demand', () => {
  const actions = createSkykitActionRegistry();
  let part = null;
  const demands = [];
  const emitted = [];
  const picks = [];
  const renderer = {
    pick(ray, options) {
      picks.push({ ray, options });
      return {
        cellKey: 'cell-a',
        objectIndex: 1,
        position: { x: 1, y: 2, z: 3 },
        magAbs: 4,
      };
    },
  };
  const plugin = createSkykitXrStarPickingPlugin({
    renderer,
    source: {
      addDemand(demand) {
        demands.push(demand);
        return () => {};
      },
    },
    raySource: {
      getRay() {
        return {
          id: 'ray',
          kind: 'target-ray',
          handedness: 'right',
          origin: { x: 0, y: 0, z: 0 },
          direction: { x: 0, y: 0, z: -1 },
          length: 10,
        };
      },
    },
    onPick(event) {
      emitted.push(event);
    },
  });
  plugin.setup(createPluginContext({
    actions,
    addPart(nextPart) {
      part = nextPart;
    },
    emit(event) {
      emitted.push(event);
    },
  }));

  const frame = createXrFrame({
    actions,
    emit(event) {
      emitted.push(event);
    },
    inputSources: [{
      handedness: 'right',
      gamepad: {
        axes: [],
        buttons: [{ pressed: true, touched: true, value: 1 }],
      },
    }],
  });
  part.update(frame);
  part.update(frame);

  assert.equal(picks.length, 1);
  assert.deepEqual(demands[0], {
    id: 'skykit-xr-star-picking:attributes',
    attributes: ['position', 'teffLog8', 'magAbs'],
  });
  assert.equal(emitted.filter((event) => event.type === 'stars/xr-pick').length, 2);
});

test('skykit/xr star picking respects panel blockers before renderer picks', () => {
  let part = null;
  let pickCount = 0;
  const emitted = [];
  const plugin = createSkykitXrStarPickingPlugin({
    renderer: {
      pick() {
        pickCount += 1;
        return null;
      },
    },
    raySource: {
      getRay() {
        return {
          id: 'ray',
          kind: 'target-ray',
          handedness: 'right',
          origin: { x: 0, y: 0, z: 0 },
          direction: { x: 0, y: 0, z: -1 },
          length: 10,
        };
      },
    },
    blockers: [{
      blockRay() {
        return { blocked: true, hit: { componentId: 'panel' } };
      },
    }],
  });
  plugin.setup(createPluginContext({
    addPart(nextPart) {
      part = nextPart;
    },
    emit(event) {
      emitted.push(event);
    },
  }));

  part.update(createXrFrame({
    emit(event) {
      emitted.push(event);
    },
    inputSources: [{
      handedness: 'right',
      gamepad: {
        axes: [],
        buttons: [{ pressed: true, touched: true, value: 1 }],
      },
    }],
  }));

  assert.equal(pickCount, 0);
  assert.equal(emitted[0].type, 'stars/xr-pick-blocked');
});

function createPluginContext(overrides = {}) {
  const actions = overrides.actions ?? createSkykitActionRegistry();
  return {
    mode: 'three',
    viewer: { id: 'test-viewer', actions },
    actions,
    scene: new THREE.Scene(),
    renderer: overrides.renderer ?? {},
    camera: new THREE.PerspectiveCamera(),
    roots: {},
    contentRoot: new THREE.Group(),
    navigationRoot: new THREE.Group(),
    observerRig: {},
    addPart: overrides.addPart ?? (() => () => {}),
    addDisposable() {
      return () => {};
    },
    getViewState() {
      return {
        revision: 0,
        observerPc: { x: 0, y: 0, z: 0 },
        renderObserverPosition: { x: 0, y: 0, z: 0 },
        limitingMagnitude: 6,
        coordinateUnitsPerParsec: 1,
      };
    },
    requestViewState() {},
    on() {
      return () => {};
    },
    emit: overrides.emit ?? (() => {}),
    useStore(_key, factory) {
      return factory();
    },
    useResource(_key, factory) {
      return factory();
    },
    scheduleTask() {
      return () => {};
    },
  };
}

function createXrFrame(overrides = {}) {
  const actions = overrides.actions ?? createSkykitActionRegistry();
  const renderer = overrides.renderer ?? {};
  return {
    viewer: {
      id: 'test-viewer',
      actions,
      requestViewState: overrides.requestViewState ?? (() => {}),
      emit: overrides.emit ?? (() => {}),
    },
    deltaSeconds: 0.016,
    elapsedSeconds: 1,
    view: {
      revision: 0,
      observerPc: { x: 0, y: 0, z: 0 },
      renderObserverPosition: { x: 0, y: 0, z: 0 },
      orientationIcrs: { x: 0, y: 0, z: 0, w: 1 },
      limitingMagnitude: 6,
      coordinateUnitsPerParsec: 1,
      verticalFovDeg: 60,
    },
    renderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    roots: {},
    observerRig: {},
    xr: {
      presenting: true,
      frame: overrides.xrFrame ?? {},
      session: {
        inputSources: overrides.inputSources ?? [],
      },
      referenceSpace: overrides.referenceSpace ?? {},
    },
  };
}
