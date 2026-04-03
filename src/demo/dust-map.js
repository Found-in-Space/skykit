import * as THREE from 'three';
import { loadDustMapNg } from '../dust/load-dust-map-ng.js';
import { DEFAULT_DUST_MAP_NG_URL } from '../found-in-space-dataset.js';
import { SCALE } from '../services/octree/scene-scale.js';

// Fallback step (pc) when an axis collapses to one sample — publication X/Y grid is 100 pc
const FALLBACK_DX = 100;
const FALLBACK_DY = 100;
const FALLBACK_DZ = 375;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const mount = document.querySelector('[data-viewer-root]');
const statusSpan = document.querySelector('[data-status]');
const cellCountSpan = document.querySelector('[data-cell-count]');
const visibleCountSpan = document.querySelector('[data-visible-count]');
const densityRangeSpan = document.querySelector('[data-density-range]');
const extentXSpan = document.querySelector('[data-extent-x]');
const extentYSpan = document.querySelector('[data-extent-y]');
const extentZSpan = document.querySelector('[data-extent-z]');
const opacityInput = document.querySelector('[data-opacity]');
const opacityValue = document.querySelector('[data-opacity-value]');
const densityFloorInput = document.querySelector('[data-density-floor]');
const densityFloorValue = document.querySelector('[data-density-floor-value]');

/** Galactic (X,Y,Z) pc → THREE world (matches instance placement). */
function galacticBoundsToThreeSphere(map) {
  const { minX, maxX, minY, maxY, minZ, maxZ } = map;
  const cx = 0.5 * (minX + maxX) * SCALE;
  const cy = 0.5 * (minZ + maxZ) * SCALE;
  const cz = 0.5 * (minY + maxY) * SCALE;
  const rx = 0.5 * (maxX - minX) * SCALE;
  const ry = 0.5 * (maxZ - minZ) * SCALE;
  const rz = 0.5 * (maxY - minY) * SCALE;
  const boundR = Math.sqrt(rx * rx + ry * ry + rz * rz);
  return { center: new THREE.Vector3(cx, cy, cz), boundR };
}

/** Orbit distance so vertical FOV fits the bounding sphere around the volume. */
function orbitRadiusForBounds(boundR, verticalFovDeg, margin = 1.22) {
  if (boundR <= 1e-9) return 2;
  const fovRad = THREE.MathUtils.degToRad(verticalFovDeg);
  return (boundR / Math.tan(fovRad / 2)) * margin;
}

// ── Build volumetric mesh (InstancedMesh of boxes) ──────────────────────────

function voxelIndex(ix, iy, iz, nx, ny) {
  return iz * ny * nx + iy * nx + ix;
}

function decodeDensity(byte, maxDensity) {
  return (byte / 255) * maxDensity;
}

function axisStep(min, max, n, fallback) {
  return n > 1 ? (max - min) / (n - 1) : fallback;
}

function buildDustMesh(map, opacity, densityFloor) {
  const {
    u8,
    nx,
    ny,
    nz,
    maxDensity: scaleMaxDensity,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    cellCount,
  } = map;

  const stepX = axisStep(minX, maxX, nx, FALLBACK_DX);
  const stepY = axisStep(minY, maxY, ny, FALLBACK_DY);
  const stepZ = axisStep(minZ, maxZ, nz, FALLBACK_DZ);

  const minPos = [minX, minY, minZ];
  const maxPos = [maxX, maxY, maxZ];

  let minDensity = Infinity;
  let maxDensityObserved = -Infinity;
  let visibleCount = 0;
  for (let i = 0; i < cellCount; i++) {
    const density = decodeDensity(u8[i], scaleMaxDensity);
    if (density < minDensity) minDensity = density;
    if (density > maxDensityObserved) maxDensityObserved = density;
    if (density >= densityFloor) visibleCount++;
  }
  if (minDensity === Infinity) minDensity = 0;
  if (maxDensityObserved === -Infinity) maxDensityObserved = 0;

  const densityRange = maxDensityObserved - minDensity || 1;

  const geo = new THREE.BoxGeometry(stepX * SCALE, stepZ * SCALE, stepY * SCALE);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: false,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, visibleCount);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let idx = 0;

  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const density = decodeDensity(u8[voxelIndex(ix, iy, iz, nx, ny)], scaleMaxDensity);
        if (density < densityFloor) continue;

        const galX = minX + ix * stepX;
        const galY = minY + iy * stepY;
        const galZ = minZ + iz * stepZ;

        dummy.position.set(
          galX * SCALE,
          galZ * SCALE, // GalZ → THREE Y (up)
          galY * SCALE, // GalY → THREE Z (depth)
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);

        const t = (density - minDensity) / densityRange;
        color.setHSL(0.58 + t * 0.08, 0.7, 0.3 + t * 0.5);
        mesh.setColorAt(idx, color);

        idx++;
      }
    }
  }

  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;

  return {
    mesh,
    stats: {
      cellCount,
      visibleCount,
      minDensity,
      maxDensity: maxDensityObserved,
      minPos,
      maxPos,
    },
  };
}

// ── Orbit controller ─────────────────────────────────────────────────────────

function createOrbitController(canvas, camera, options = {}) {
  let azimuth = options.azimuth ?? -2.83;
  let elevation = options.elevation ?? -0.30;
  let radius = options.radius ?? 0.8;
  const radiusMin = options.radiusMin ?? 0.01;
  const radiusMax = options.radiusMax ?? 10;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const target = options.target?.clone() ?? new THREE.Vector3(0, 0, 0);

  function update() {
    camera.position.set(
      target.x + radius * Math.cos(elevation) * Math.sin(azimuth),
      target.y + radius * Math.sin(elevation),
      target.z + radius * Math.cos(elevation) * Math.cos(azimuth),
    );
    camera.lookAt(target);
  }

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    azimuth -= (e.clientX - lastX) * 0.005;
    elevation = Math.max(-Math.PI * 0.49, Math.min(Math.PI * 0.49,
      elevation + (e.clientY - lastY) * 0.005));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const stopDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointerleave', stopDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    radius = Math.max(radiusMin, Math.min(radiusMax, radius * (1 + e.deltaY * 0.001)));
  }, { passive: false });

  update();
  return { update };
}

// ── Main ─────────────────────────────────────────────────────────────────────

const opacityFromInput = Number(opacityInput?.value);
let activeOpacity = Number.isFinite(opacityFromInput) ? opacityFromInput : 0.06;
const densityFloorFromInput = Number(densityFloorInput?.value);
let activeDensityFloor = Number.isFinite(densityFloorFromInput) ? densityFloorFromInput : 0.01;
let dustMap = null;

function updateStats(stats) {
  if (cellCountSpan) cellCountSpan.textContent = stats.cellCount.toLocaleString();
  if (visibleCountSpan) visibleCountSpan.textContent = stats.visibleCount.toLocaleString();
  if (densityRangeSpan) {
    densityRangeSpan.textContent =
      `${stats.minDensity.toFixed(3)} – ${stats.maxDensity.toFixed(3)}`;
  }
  if (extentXSpan) extentXSpan.textContent =
    `${stats.minPos[0].toFixed(0)} … ${stats.maxPos[0].toFixed(0)}`;
  if (extentYSpan) extentYSpan.textContent =
    `${stats.minPos[1].toFixed(0)} … ${stats.maxPos[1].toFixed(0)}`;
  if (extentZSpan) extentZSpan.textContent =
    `${stats.minPos[2].toFixed(0)} … ${stats.maxPos[2].toFixed(0)}`;
}

async function main() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x02040b);
  mount.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 1e6);
  const scene = new THREE.Scene();

  function resize() {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  if (statusSpan) statusSpan.textContent = 'fetching dust_map_ng.bin…';
  dustMap = await loadDustMapNg(DEFAULT_DUST_MAP_NG_URL);

  const { center: orbitTarget, boundR } = galacticBoundsToThreeSphere(dustMap);
  const fitRadius = orbitRadiusForBounds(boundR, camera.fov);
  camera.near = Math.max(1e-6, fitRadius * 1e-5);
  camera.far = Math.max(1e4, fitRadius * 8 + boundR * 4);
  camera.updateProjectionMatrix();

  const orbit = createOrbitController(renderer.domElement, camera, {
    target: orbitTarget,
    radius: fitRadius,
    radiusMin: Math.max(1e-6, fitRadius * 0.02),
    radiusMax: Math.max(fitRadius * 6, 50),
  });

  let currentMesh = null;

  function rebuildMesh() {
    if (currentMesh) {
      scene.remove(currentMesh);
      currentMesh.geometry.dispose();
      currentMesh.material.dispose();
    }
    const { mesh, stats } = buildDustMesh(dustMap, activeOpacity, activeDensityFloor);
    currentMesh = mesh;
    scene.add(mesh);
    updateStats(stats);
  }

  rebuildMesh();
  if (statusSpan) statusSpan.textContent = 'ready';

  opacityInput?.addEventListener('input', () => {
    activeOpacity = Number(opacityInput.value);
    if (opacityValue) opacityValue.textContent = activeOpacity.toFixed(2);
    if (currentMesh) currentMesh.material.opacity = activeOpacity;
  });

  densityFloorInput?.addEventListener('input', () => {
    activeDensityFloor = Number(densityFloorInput.value);
    if (densityFloorValue) densityFloorValue.textContent = activeDensityFloor.toFixed(2);
    rebuildMesh();
  });

  renderer.setAnimationLoop(() => {
    orbit.update();
    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  if (statusSpan) statusSpan.textContent = 'error';
  console.error('[dust-map] failed', err);
});
