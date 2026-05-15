# @found-in-space/xr

Alpha package for immersive Found in Space experiences.

This package owns WebXR-safe rig roots, body/controller pose extraction,
declarative controls, motion models, generic rays, pick routing, scale profile
consumption, and XR depth/session helpers. It does not render stars, load data,
create touch panels, or compose a full SkyKit viewer.

```js
import * as THREE from 'three';
import {
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

function frame({ xrFrame, referenceSpace, inputSources, deltaSeconds }) {
  controls.update(inputSources);
  const nextPose = motion.update({
    pose: rig.getNavigationPose(),
    controls,
    deltaSeconds,
    scale: rig.getScaleProfile(),
  });
  rig.setNavigationPose(nextPose);
  rig.updateBody({ frame: xrFrame, referenceSpace, inputSources });
}
```

For visual surfaces use `touch-os`. For stars use `@found-in-space/three-star-field`.
For application composition use future core `@found-in-space/skykit`.
