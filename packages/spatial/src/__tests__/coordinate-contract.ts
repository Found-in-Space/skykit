import {
  type SpatialCoordinateSpace, type SpatialPose, type SpatialPathSpec,
  type SpatialAimSpec, type SpatialTransform,
  normalizeSpatialPose, buildSpatialPolylineRoute, buildSpatialAimTrack,
  buildSpatialRouteEndpoint,
  evaluateSpatialAim, evaluateSpatialPath, transformSpatialPose,
  createDirectSpatialMotionModel, createSpatialNavigationAutomation,
} from '../index.js';

const space: SpatialCoordinateSpace = { frameId: 'contract:inertial', metersPerUnit: 1 };
const pose: SpatialPose = normalizeSpatialPose({ space });
buildSpatialRouteEndpoint(pose.position, { space });
const aim: SpatialAimSpec = { space, kind: 'target', target: { x: 10, y: 0, z: 0 } };
const path: SpatialPathSpec = { space,
  positionKeys: [{ id: 'a', timeSecs: 0, position: pose.position }],
  aimKeys: [{ id: 'aim', timeSecs: 0, aim: { kind: 'direction', forward: { x: 1, y: 0, z: 0 } } }],
};
evaluateSpatialPath(path, 0);
evaluateSpatialAim({ space, position: pose.position, aim });
buildSpatialAimTrack(path.aimKeys, { space });
const route = buildSpatialPolylineRoute({ space, points: [pose.position],
  travel: { kind: 'polyline', timing: { kind: 'constantSpeed', speedUnitsPerSec: 2 } } });
const navigation = createSpatialNavigationAutomation(space);
navigation.flyRoute(route);
navigation.lookAt({ kind: 'direction', forward: { x: 1, y: 0, z: 0 } });
navigation.update({ pose, deltaSecs: 0.5 });
createDirectSpatialMotionModel({ space }).update({ pose, deltaSecs: 0.5 });
const transform: SpatialTransform = { from: space, to: space };
transformSpatialPose(transform, pose);

// @ts-expect-error A canonical pose declares its coordinate space.
const missingSpace: SpatialPose = { position: pose.position, orientation: pose.orientation };
// @ts-expect-error A generic pose does not use star-view field names.
const starView: SpatialPose = { space, observerPc: pose.position, orientationIcrs: pose.orientation };
// @ts-expect-error Motion construction requires a physical coordinate context.
createDirectSpatialMotionModel({ moveSpeedUnitsPerSec: 2 });
// @ts-expect-error Physical conversion is not presentation scale.
createDirectSpatialMotionModel({ space }).update({ pose, deltaSecs: 1, scale: { metersPerUnit: 2 } });
void missingSpace;
void starView;
