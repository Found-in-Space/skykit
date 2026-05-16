# @found-in-space/xr

Alpha package for immersive Found in Space experiences.

This package owns WebXR-safe rig roots, body/controller pose extraction,
declarative controls, motion models, generic rays, pick routing, scale profile
consumption, and XR depth/session helpers. It does not render stars, load data,
create touch panels, or compose a full SkyKit viewer.

```js
import * as THREE from 'three';
import {
  createXrNavigationAutomation,
  createXrBodyTracker,
  createXrControlBindings,
  createXrRig,
  createDirectXrMotionModel,
} from '@found-in-space/xr';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const rig = createXrRig({ camera });

scene.add(rig.originContentRoot);
scene.add(rig.observerContentRoot);
scene.add(rig.navigationRoot);

const controls = createXrControlBindings({
  axes: {
    move: { hand: 'right', stick: 'primary' },
    attitude: { hand: 'left', stick: 'primary' },
  },
  buttons: {
    rollModifier: { hand: 'left', button: 'grip' },
  },
});

const motion = createDirectXrMotionModel();
const bodyTracker = createXrBodyTracker();

function frame({ xrFrame, referenceSpace, inputSources, deltaSeconds }) {
  controls.update(inputSources);
  const body = bodyTracker.update({
    frame: xrFrame,
    referenceSpace,
    inputSources,
    rig,
  });
  const nextPose = motion.update({
    pose: rig.getNavigationPose(),
    body,
    controls,
    deltaSeconds,
    scale: rig.getScaleProfile(),
  });
  rig.setNavigationPose(nextPose);
}
```

Navigation automation is also plain-data and can be layered on top of the rig:

```js
const navigation = createXrNavigationAutomation();

navigation.flyPolyline([
  { x: 0, y: 0, z: 0 },
  { x: 8, y: 0, z: -24 },
], {
  durationSecs: 4,
  arrivalAction: {
    type: 'orbit',
    center: { x: 8, y: 0, z: -32 },
    radius: 8,
    angularSpeed: 0.08,
  },
});

function animationFrame(deltaSeconds) {
  const nextPose = navigation.update({
    pose: rig.getNavigationPose(),
    deltaSeconds,
    scale: rig.getScaleProfile(),
  });
  rig.setNavigationPose(nextPose);
}
```

For visual surfaces use `touch-os`. For stars use `@found-in-space/three-star-field`.
For application composition use alpha `@found-in-space/skykit`.
