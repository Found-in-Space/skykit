import * as THREE from 'three';
import {
  createDefaultStarFieldMaterialProfile,
  createTunedStarFieldMaterialProfile,
  createVrStarFieldMaterialProfile,
} from '../layers/star-field-materials.js';
import { SCALE } from '../services/octree/scene-scale.js';

const DISTANCE_PC = 10;
const DISTANCE_WORLD = DISTANCE_PC * SCALE;

const COLS = 6;
const X_SPACING_PC = 1.8;
const Y_SPACING_PC = 2.4;

const MAG_FAINTEST = 7;

const NOTES = {
  7: 'eye limit',
  6: 'faint',
  5: '',
  4: '',
  3: '',
  2: 'Polaris',
  1: 'Spica',
  0: 'Vega',
  '-1': 'Sirius',
  '-2': '',
  '-3': '',
  '-4': 'Venus',
  '-5': '',
  '-6': '',
  '-7': '',
  '-8': '',
  '-9': '',
  '-10': '',
  '-12': 'full Moon',
  '-15': '',
  '-20': '',
};

// Encode ~5800 K as the log8 byte: log_25(5800/2000) ≈ 0.996 → clamped sentinel
const SOLAR_TEFF_LOG8 = 255;

function buildStarGeometry(magBrightest) {
  const mags = [];
  for (let m = MAG_FAINTEST; m >= magBrightest; m--) {
    mags.push(m);
  }

  const count = mags.length;
  const rows = Math.ceil(count / COLS);
  const positions = new Float32Array(count * 3);
  const magAbs = new Float32Array(count);
  const teffLog8 = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const colsInRow = Math.min(COLS, count - row * COLS);

    const xPc = (col - (colsInRow - 1) / 2) * X_SPACING_PC;
    const yPc = ((rows - 1) / 2 - row) * Y_SPACING_PC;

    positions[i * 3] = xPc * SCALE;
    positions[i * 3 + 1] = yPc * SCALE;
    positions[i * 3 + 2] = -DISTANCE_WORLD;

    // At 10 pc, distance modulus = 0 so m_app = magAbs
    magAbs[i] = mags[i];
    teffLog8[i] = SOLAR_TEFF_LOG8;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('magAbs', new THREE.BufferAttribute(magAbs, 1));
  geometry.setAttribute('teff_log8', new THREE.Uint8BufferAttribute(teffLog8, 1, true));

  return { geometry, mags, count, rows };
}

function createMaterialProfile(profile, opts) {
  if (profile === 'vr') {
    return createVrStarFieldMaterialProfile(opts);
  }
  if (profile === 'default') {
    return createDefaultStarFieldMaterialProfile(opts);
  }
  if (profile === 'tuned') {
    return createTunedStarFieldMaterialProfile(opts);
  }
  return createDefaultStarFieldMaterialProfile(opts);
}

// --- DOM refs ---

const mount = document.getElementById('renderer-mount');
const labelsContainer = document.getElementById('mag-labels');
const infoBlock = document.querySelector('[data-info]');

const ctrlExposure = document.getElementById('ctrl-exposure');
const ctrlMagLimit = document.getElementById('ctrl-mag-limit');
const ctrlSizeMin = document.getElementById('ctrl-size-min');
const ctrlSizeMax = document.getElementById('ctrl-size-max');
const ctrlFadeRange = document.getElementById('ctrl-fade-range');
const ctrlMagBrightest = document.getElementById('ctrl-mag-brightest');
const profileButtons = document.querySelectorAll('[data-profile]');

function readout(name, value) {
  const el = document.querySelector(`[data-readout="${name}"]`);
  if (el) el.textContent = value;
}

// Exposure slider is log-scale: slider value = ln(exposure)
function getExposure() {
  return Math.exp(Number(ctrlExposure.value));
}

function getMagLimit() {
  return Number(ctrlMagLimit.value);
}

function getSizeMin() {
  return Number(ctrlSizeMin.value);
}

function getSizeMax() {
  return Number(ctrlSizeMax.value);
}

function getFadeRange() {
  return Number(ctrlFadeRange.value);
}

function getMagBrightest() {
  return Number(ctrlMagBrightest.value);
}

// --- Scene setup ---

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x02040b);
mount.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, 1, 0.00001, 100);
camera.position.set(0, 0, 0);
camera.lookAt(0, 0, -1);

const scene = new THREE.Scene();

let activeProfile = 'default';
let materialProfile = null;
let points = null;
let haloPoints = null;
let starData = null;

function rebuild() {
  if (points) {
    scene.remove(points);
    points.geometry.dispose();
  }
  if (haloPoints) {
    scene.remove(haloPoints);
  }
  if (materialProfile) {
    materialProfile.dispose();
  }

  starData = buildStarGeometry(getMagBrightest());

  materialProfile = createMaterialProfile(activeProfile, {
    exposure: getExposure(),
    magLimit: getMagLimit(),
    sizeMin: getSizeMin(),
    sizeMax: getSizeMax(),
    magFadeRange: getFadeRange(),
    scale: SCALE,
  });

  points = new THREE.Points(starData.geometry, materialProfile.material);
  points.frustumCulled = false;
  scene.add(points);

  if (materialProfile.haloMaterial) {
    haloPoints = new THREE.Points(starData.geometry, materialProfile.haloMaterial);
    haloPoints.frustumCulled = false;
    scene.add(haloPoints);
  } else {
    haloPoints = null;
  }

  updateLabels();
}

// --- Labels ---

function updateLabels() {
  labelsContainer.innerHTML = '';
  if (!starData) return;

  const { mags, count, rows } = starData;
  const w = mount.clientWidth;
  const h = mount.clientHeight;
  if (w === 0 || h === 0) return;

  for (let i = 0; i < count; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const colsInRow = Math.min(COLS, count - row * COLS);

    const xPc = (col - (colsInRow - 1) / 2) * X_SPACING_PC;
    const yPc = ((rows - 1) / 2 - row) * Y_SPACING_PC;

    const worldPos = new THREE.Vector3(xPc * SCALE, yPc * SCALE, -DISTANCE_WORLD);
    const ndc = worldPos.clone().project(camera);

    const screenX = (ndc.x * 0.5 + 0.5) * w;
    const screenY = (-ndc.y * 0.5 + 0.5) * h;

    if (screenX < -40 || screenX > w + 40) continue;

    const label = document.createElement('div');
    label.className = 'mag-label';
    label.style.left = `${screenX}px`;
    label.style.top = `${screenY + 28}px`;

    const mag = mags[i];
    const note = NOTES[String(mag)] ?? '';

    label.innerHTML =
      `<span class="mag-value">${mag}</span>` +
      (note ? `<span class="mag-note">${note}</span>` : '');

    labelsContainer.appendChild(label);
  }
}

// --- Uniform updates ---

function syncUniforms() {
  if (!materialProfile) return;

  const u = materialProfile.material.uniforms;
  u.uExposure.value = getExposure();
  u.uMagLimit.value = getMagLimit();
  if (u.uSizeMin) u.uSizeMin.value = getSizeMin();
  if (u.uSizeMax) u.uSizeMax.value = getSizeMax();
  u.uMagFadeRange.value = getFadeRange();
  u.uCameraPosition.value.set(0, 0, 0);

  if (materialProfile.haloMaterial) {
    const h = materialProfile.haloMaterial.uniforms;
    h.uExposure.value = getExposure();
    h.uMagLimit.value = getMagLimit();
    h.uMagFadeRange.value = getFadeRange();
    h.uCameraPosition.value.set(0, 0, 0);
  }
}

function updateReadouts() {
  const exp = getExposure();
  readout('exposure', exp >= 1 ? exp.toFixed(0) : exp.toFixed(3));
  readout('mag-limit', getMagLimit().toFixed(1));
  readout('size-min', getSizeMin().toFixed(1));
  readout('size-max', getSizeMax().toFixed(0));
  readout('fade-range', getFadeRange().toFixed(1));
  readout('mag-brightest', getMagBrightest().toFixed(0));
}

function updateInfo() {
  if (!starData || !infoBlock) return;

  const exposure = getExposure();
  const limit = getMagLimit();
  const sMin = getSizeMin();
  const sMax = getSizeMax();
  const linScale = 12.0;
  const haloThreshold = 10.0;

  const usingTunedMath = activeProfile !== 'vr';
  const header = usingTunedMath
    ? 'm       flux       rawR   radius  lum    halo'
    : 'm       flux       I(clamp)  size(magD)';

  const lines = starData.mags.map((m) => {
    const flux = Math.pow(10, -0.4 * m);
    const relFlux = usingTunedMath
      ? Math.pow(10, 0.4 * (limit - m))
      : flux;
    const energy = relFlux * exposure;

    if (usingTunedMath) {
      const rawRadius = Math.sqrt(energy) * linScale;
      let luminance, radius;
      if (rawRadius < sMin) {
        luminance = Math.pow(rawRadius, 3) / Math.pow(sMin, 3);
        radius = luminance < 0.03 ? 0 : sMin;
        if (luminance < 0.03) luminance = 0;
      } else {
        luminance = 1.0;
        const maxLin = 8.0;
        radius = rawRadius > maxLin
          ? maxLin + Math.sqrt(1 + rawRadius - maxLin) - 1
          : rawRadius;
      }
      radius = Math.min(radius, sMax);
      const excess = rawRadius - haloThreshold;
      const haloAlpha = Math.max(0, Math.min(excess / 30, 1));
      const haloFlag = haloAlpha > 0.001 ? `${(haloAlpha * 100).toFixed(0)}%` : '  -';
      return `m=${String(m).padStart(4)}  flux=${flux.toExponential(1).padStart(9)}  rawR=${rawRadius.toFixed(1).padStart(6)}  r=${radius.toFixed(1).padStart(5)}px  L=${luminance.toFixed(3)}  halo=${haloFlag}`;
    }

    const intensity = Math.min(Math.max(energy, 0.02), 1.0);
    const magDiff = limit - m;
    const size = Math.min(Math.max(sMin + Math.pow(Math.max(magDiff, 0), 1.15) * 1.4, sMin), sMax);
    const clamped = intensity >= 1.0 ? ' CLAMPED' : '';
    return `m=${String(m).padStart(4)}  flux=${flux.toExponential(1).padStart(9)}  I=${intensity.toFixed(3)}${clamped}  size=${size.toFixed(1)}px`;
  });

  infoBlock.textContent = header + '\n' + lines.join('\n');
}

// --- Controls wiring ---

ctrlExposure.addEventListener('input', () => { updateReadouts(); syncUniforms(); updateInfo(); });
ctrlMagLimit.addEventListener('input', () => { updateReadouts(); syncUniforms(); updateInfo(); });
ctrlSizeMin.addEventListener('input', () => { updateReadouts(); syncUniforms(); updateInfo(); });
ctrlSizeMax.addEventListener('input', () => { updateReadouts(); syncUniforms(); updateInfo(); });
ctrlFadeRange.addEventListener('input', () => { updateReadouts(); syncUniforms(); updateInfo(); });
ctrlMagBrightest.addEventListener('input', () => { updateReadouts(); rebuild(); updateInfo(); });

const PROFILE_SIZE_MAX = { default: 256, tuned: 256, vr: 64 };
const PROFILE_SIZE_MIN = { default: 2.0, tuned: 2.0, vr: 1.0 };

profileButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    profileButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeProfile = btn.dataset.profile;

    const defaultMax = PROFILE_SIZE_MAX[activeProfile] ?? 20;
    const defaultMin = PROFILE_SIZE_MIN[activeProfile] ?? 1.0;
    ctrlSizeMax.value = String(defaultMax);
    ctrlSizeMin.value = String(defaultMin);

    updateReadouts();
    rebuild();
    updateInfo();
  });
});

// --- Resize ---

function resize() {
  const w = mount.clientWidth;
  const h = mount.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateLabels();
}

window.addEventListener('resize', resize);

// --- Render loop ---

let elapsedSeconds = 0;
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  elapsedSeconds += (now - lastTime) / 1000;
  lastTime = now;

  if (materialProfile) {
    materialProfile.updateUniforms({
      cameraWorldPosition: camera.position,
      frame: { elapsedSeconds },
      state: {
        starFieldScale: SCALE,
        starFieldExposure: getExposure(),
        mDesired: getMagLimit(),
        starFieldExtinctionScale: 1.0,
      },
    });
  }

  renderer.render(scene, camera);
}

// --- Init ---

updateReadouts();
resize();
rebuild();
updateInfo();
animate();
