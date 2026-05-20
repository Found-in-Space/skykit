import * as THREE from 'three';

import { createAnchoredImageGroup } from '@found-in-space/anchored-image/three';
import {
  SKYKIT_ACTIONS,
  createKeyboardNavigationPlugin,
  createObject3dPlugin,
  createSkyGrabPlugin,
  createSkykitDefaultKeyboardNavigationBindings,
  createSkykitAnimationLoop,
  createSkykitDebugBridge,
  createSkykitViewer,
  createStreamingStarsPlugin,
  installSkykitDebugGlobal,
} from '@found-in-space/skykit';
import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import {
  combineStarTreeStrategies,
  createObserverShellStrategy,
  createSphereVolumeStrategy,
} from '@found-in-space/star-trees';
import { createThreeStarField } from '@found-in-space/three-star-field';

const UNITS_PER_PARSEC = 0.001;
const HYADES_CENTER_PC = Object.freeze({ x: 17.574, y: 42.316, z: 13.963 });
const HYADES_RADIUS_PC = 8;
const SKY_GUIDE_RADIUS = 0.12;
const WESTERN_SKYCULTURE_MANIFEST_URL =
  'https://unpkg.com/@found-in-space/stellarium-skycultures-western@0.1.0/dist/manifest.json';

main().catch((error) => {
  document.querySelector('[data-error]').textContent = error.stack ?? String(error);
});

async function main() {
  const host = document.querySelector('[data-viewer]');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 1000);
  const initialView = createInitialViewState();
  const provider = createStarOctreeProviderService({ url: OCTREE_DEFAULT });
  const starField = createThreeStarField({ limitingMagnitude: 7.5, exposure: 2400 });
  const hyadesPosition = toRenderPosition(HYADES_CENTER_PC);
  const debug = createSkykitDebugBridge();
  const constellationArt = await createSkycultureConstellationLayer(debug);
  const navigationSphere = createNavigationSphere(SKY_GUIDE_RADIUS * 1.12);
  const bubble = createHyadesBubble(HYADES_RADIUS_PC * UNITS_PER_PARSEC);

  bubble.name = 'app-owned-hyades-marker';
  bubble.position.copy(hyadesPosition);

  const viewer = await createSkykitViewer({
    host,
    renderer,
    camera,
    view: initialView,
    plugins: [
      createStreamingStarsPlugin({
        provider,
        renderer: starField,
        session: {
          strategy: combineStarTreeStrategies([
            createObserverShellStrategy(),
            createSphereVolumeStrategy({
              centerPc: HYADES_CENTER_PC,
              radiusPc: HYADES_RADIUS_PC,
            }),
          ]),
        },
      }),
      createObject3dPlugin({
        id: 'skyculture-constellation-art',
        object3d: constellationArt,
        anchorMode: 'observer-centric',
      }),
      createObject3dPlugin({
        id: 'navigation-sphere',
        object3d: navigationSphere,
        anchorMode: 'observer-centric',
      }),
      createObject3dPlugin({ id: 'hyades-marker', object3d: bubble, anchorMode: 'world-space' }),
      (context) => context.addDisposable(() => {
        constellationArt.userData.anchoredImage?.dispose?.();
      }),
      createKeyboardNavigationPlugin({
        speedPcPerSec: 2,
        bindings: createSkykitDefaultKeyboardNavigationBindings({
          KeyZ: SKYKIT_ACTIONS.ship.rollAnticlockwise,
          KeyC: SKYKIT_ACTIONS.ship.rollClockwise,
          KeyR: SKYKIT_ACTIONS.viewer.reset,
        }),
      }),
      createSkyGrabPlugin({
        target: host,
        sensitivityRadiansPerPixel: 0.00075,
      }),
      (context) => context.addPart({
        id: 'hyades-marker-animation',
        update(frame) {
          bubble.scale.setScalar(1 + Math.sin(frame.elapsedSeconds * 1.4) * 0.04);
        },
        getSnapshot() {
          return {
            centerPc: HYADES_CENTER_PC,
            radiusPc: HYADES_RADIUS_PC,
            scale: bubble.scale.x,
          };
        },
      }),
    ],
  });

  const loop = createSkykitAnimationLoop(viewer);
  window.addEventListener('resize', resize);
  bindLayerToggles({
    constellations: constellationArt,
    navigationSphere,
    hyades: bubble,
  });
  resize();
  loop.start();
  debug.registerViewer(viewer);
  installSkykitDebugGlobal(debug);

  function resize() {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    viewer.resize({ width, height, devicePixelRatio: window.devicePixelRatio || 1 });
  }

  window.addEventListener('beforeunload', () => {
    loop.dispose();
    void viewer.dispose();
    void provider.dispose?.();
    debug.unregisterViewer(viewer.id);
  });
}

function createInitialViewState() {
  return {
    observerPc: { x: 0, y: 0, z: 0 },
    coordinateUnitsPerParsec: UNITS_PER_PARSEC,
    limitingMagnitude: 7.5,
    orientationIcrs: lookAtFromOriginWithNorthUp(HYADES_CENTER_PC),
  };
}

function bindLayerToggles(layers) {
  for (const input of document.querySelectorAll('[data-layer-toggle]')) {
    const layer = layers[input.dataset.layerToggle];
    if (!layer) continue;
    layer.visible = input.checked;
    input.addEventListener('change', () => {
      layer.visible = input.checked;
    });
  }
}

function createHyadesBubble(radius) {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(radius, 48, 24);
  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0x73d5ff,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    }),
  );
  const wire = new THREE.Mesh(
    geometry.clone(),
    new THREE.MeshBasicMaterial({
      color: 0xa8edff,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
  );
  group.add(fill, wire);
  return group;
}

async function createSkycultureConstellationLayer(debug) {
  const group = await createAnchoredImageGroup({
    id: 'observer-centric-skyculture-art',
    manifestUrl: WESTERN_SKYCULTURE_MANIFEST_URL,
    groupFilter: ['Ori', 'Tau'],
    radius: SKY_GUIDE_RADIUS,
    opacity: 0.24,
    cutoff: 0.05,
    subdivisions: 5,
    skipTextureErrors: true,
    onTextureError({ image, error }) {
      debug.recordDiagnostic({
        level: 'warn',
        type: 'custom-object-layer/skyculture-texture-error',
        message: `Failed to load skyculture texture ${image.id}.`,
        data: { imageId: image.id },
        error,
      });
    },
  });
  group.name = 'observer-centric-skyculture-art';
  return group;
}

function createNavigationSphere(radius) {
  const group = new THREE.Group();
  group.name = 'observer-centric-navigation-sphere';
  const gridMaterial = new THREE.LineBasicMaterial({
    color: 0x5f8fff,
    transparent: true,
    opacity: 0.28,
    depthTest: false,
    depthWrite: false,
  });
  const equatorMaterial = new THREE.LineBasicMaterial({
    color: 0x9bdfff,
    transparent: true,
    opacity: 0.62,
    depthTest: false,
    depthWrite: false,
  });
  const eclipticMaterial = new THREE.LineBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.82,
    depthTest: false,
    depthWrite: false,
  });

  for (let raDeg = 0; raDeg < 180; raDeg += 45) {
    group.add(createLineLoop(createRaGreatCircle(raDeg, radius), gridMaterial));
  }
  group.add(createLineLoop(createDecCircle(0, radius), equatorMaterial));
  group.add(createLineLoop(createEclipticCircle(radius), eclipticMaterial));

  for (let raDeg = 0; raDeg < 360; raDeg += 45) {
    const position = directionFromRaDec(raDeg, 0).multiplyScalar(radius * 1.04);
    group.add(createTextSprite(`${raDeg}\u00b0`, position, { color: '#91aaff', scale: 0.008 }));
  }
  group.add(createTextSprite('N', new THREE.Vector3(0, 0, radius * 1.06), {
    color: '#ffffff',
    scale: 0.012,
  }));
  group.add(createTextSprite('S', new THREE.Vector3(0, 0, -radius * 1.06), {
    color: '#ffffff',
    scale: 0.012,
  }));

  return group;
}

function createDecCircle(decDeg, radius) {
  const points = [];
  for (let step = 0; step < 192; step += 1) {
    points.push(directionFromRaDec((step / 192) * 360, decDeg).multiplyScalar(radius));
  }
  return points;
}

function createRaGreatCircle(raDeg, radius) {
  const points = [];
  const north = new THREE.Vector3(0, 0, 1);
  const equator = directionFromRaDec(raDeg, 0);
  for (let step = 0; step < 128; step += 1) {
    const angle = (step / 128) * Math.PI * 2;
    points.push(equator.clone()
      .multiplyScalar(Math.cos(angle))
      .add(north.clone().multiplyScalar(Math.sin(angle)))
      .multiplyScalar(radius));
  }
  return points;
}

function createEclipticCircle(radius) {
  const points = [];
  const obliquityRad = THREE.MathUtils.degToRad(23.43928);
  for (let step = 0; step < 192; step += 1) {
    const longitude = (step / 192) * Math.PI * 2;
    points.push(new THREE.Vector3(
      Math.cos(longitude),
      Math.sin(longitude) * Math.cos(obliquityRad),
      Math.sin(longitude) * Math.sin(obliquityRad),
    ).multiplyScalar(radius));
  }
  return points;
}

function createLineLoop(points, material) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.LineLoop(geometry, material);
  line.frustumCulled = false;
  return line;
}

function createTextSprite(text, position, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '600 42px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = options.color ?? '#ffffff';
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }));
  const scale = options.scale ?? 0.01;
  sprite.position.copy(position);
  sprite.scale.set(scale * (canvas.width / canvas.height), scale, 1);
  return sprite;
}

function toRenderPosition(pointPc) {
  return new THREE.Vector3(
    pointPc.x * UNITS_PER_PARSEC,
    pointPc.y * UNITS_PER_PARSEC,
    pointPc.z * UNITS_PER_PARSEC,
  );
}

function lookAtFromOriginWithNorthUp(targetPc) {
  const forward = new THREE.Vector3(targetPc.x, targetPc.y, targetPc.z).normalize();
  const north = new THREE.Vector3(0, 0, 1);
  let up = north.clone().sub(forward.clone().multiplyScalar(north.dot(forward)));
  if (up.lengthSq() < 1e-8) {
    up = new THREE.Vector3(0, 1, 0);
  }
  up.normalize();

  const backward = forward.clone().negate();
  const right = up.clone().cross(backward).normalize();
  up = backward.clone().cross(right).normalize();

  const matrix = new THREE.Matrix4().makeBasis(right, up, backward);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
  return {
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w,
  };
}

function directionFromRaDec(raDeg, decDeg) {
  const ra = THREE.MathUtils.degToRad(raDeg);
  const dec = THREE.MathUtils.degToRad(decDeg);
  const cosDec = Math.cos(dec);
  return new THREE.Vector3(
    cosDec * Math.cos(ra),
    cosDec * Math.sin(ra),
    Math.sin(dec),
  );
}
