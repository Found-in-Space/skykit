import {
  createXrNavigationAutomation,
  IDENTITY_QUATERNION,
} from '@found-in-space/xr';

const navigation = createXrNavigationAutomation({ speed: 4 });
let pose = {
  position: { x: 0, y: 0, z: 0 },
  orientation: IDENTITY_QUATERNION,
};

navigation.flyPolyline([
  { x: 0, y: 0, z: 0 },
  { x: 5, y: 0, z: -12 },
], {
  durationSecs: 3,
  arrivalAction: {
    type: 'orbit',
    center: { x: 5, y: 0, z: -18 },
    radius: 6,
    angularSpeed: 0.2,
  },
});

for (let step = 0; step < 240; step += 1) {
  pose = navigation.update({
    pose,
    deltaSeconds: 1 / 60,
    scale: { navigationUnits: 'pc', metersPerNavigationUnit: 3.085677581e16 },
  });
}

console.log(navigation.getSnapshot(), pose);
