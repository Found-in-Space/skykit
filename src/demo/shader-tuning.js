import * as THREE from 'three';
import {
  createDefaultStarFieldMaterialProfile,
  createTunedStarFieldMaterialProfile,
  createVrStarFieldMaterialProfile,
} from '../layers/star-field-materials.js';
import { SCALE } from '../services/octree/scene-scale.js';
import { computeVisualRadiusPx } from '../services/star-picker.js';

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
const ctrlFadeRange = document.getElementById('ctrl-fade-range');
const ctrlBaseSize = document.getElementById('ctrl-base-size');
const ctrlSizeScale = document.getElementById('ctrl-size-scale');
const ctrlSizePower = document.getElementById('ctrl-size-power');
const ctrlGlowScale = document.getElementById('ctrl-glow-scale');
const ctrlGlowPower = document.getElementById('ctrl-glow-power');
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

function getFadeRange() {
  return Number(ctrlFadeRange.value);
}

function getBaseSize() {
  return Number(ctrlBaseSize.value);
}

function getSizeScale() {
  return Number(ctrlSizeScale.value);
}

function getSizePower() {
  return Number(ctrlSizePower.value);
}

function getGlowScale() {
  return Number(ctrlGlowScale.value);
}

function getGlowPower() {
  return Number(ctrlGlowPower.value);
}

function getMagBrightest() {
  return Number(ctrlMagBrightest.value);
}

function getProfileSizeMax() {
  return activeProfile === 'vr' ? 64 : 384;
}

function formatExposureReadout(value) {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(3);
}

function apparentFluxFromMagnitude(mApp) {
  return Math.pow(10, -0.4 * mApp);
}

function computeMagnitudeFade(mApp, magLimit, fadeRange) {
  if (!(fadeRange > 0)) {
    return mApp <= magLimit ? 1 : 0;
  }
  const t = THREE.MathUtils.clamp((mApp - (magLimit - fadeRange)) / fadeRange, 0, 1);
  return 1 - t * t * (3 - 2 * t);
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
    magFadeRange: getFadeRange(),
    baseSize: getBaseSize(),
    sizeScale: getSizeScale(),
    sizePower: getSizePower(),
    glowScale: getGlowScale(),
    glowPower: getGlowPower(),
    sizeMin: getBaseSize(),
    sizeMax: getProfileSizeMax(),
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

  const apply = (uniforms) => {
    if (!uniforms) return;
    if (uniforms.uExposure) uniforms.uExposure.value = getExposure();
    if (uniforms.uMagLimit) uniforms.uMagLimit.value = getMagLimit();
    if (uniforms.uMagFadeRange) uniforms.uMagFadeRange.value = getFadeRange();
    if (uniforms.uBaseSize) uniforms.uBaseSize.value = getBaseSize();
    if (uniforms.uSizeScale) uniforms.uSizeScale.value = getSizeScale();
    if (uniforms.uSizePower) uniforms.uSizePower.value = getSizePower();
    if (uniforms.uGlowScale) uniforms.uGlowScale.value = getGlowScale();
    if (uniforms.uGlowPower) uniforms.uGlowPower.value = getGlowPower();
    if (uniforms.uSizeMin) uniforms.uSizeMin.value = getBaseSize();
    if (uniforms.uSizeMax) uniforms.uSizeMax.value = getProfileSizeMax();
    if (uniforms.uCameraPosition) uniforms.uCameraPosition.value.set(0, 0, 0);
  };

  apply(materialProfile.material.uniforms);
  apply(materialProfile.haloMaterial?.uniforms);
}

function updateReadouts() {
  readout('exposure', formatExposureReadout(getExposure()));
  readout('mag-limit', getMagLimit().toFixed(1));
  readout('fade-range', getFadeRange().toFixed(1));
  readout('base-size', getBaseSize().toFixed(2));
  readout('size-scale', getSizeScale().toFixed(2));
  readout('size-power', getSizePower().toFixed(2));
  readout('glow-scale', getGlowScale().toFixed(2));
  readout('glow-power', getGlowPower().toFixed(2));
  readout('mag-brightest', getMagBrightest().toFixed(0));
}

function updateInfo() {
  if (!starData || !infoBlock) return;

  const exposure = getExposure();
  const limit = getMagLimit();
  const fadeRange = getFadeRange();
  const baseSize = getBaseSize();
  const sizeScale = getSizeScale();
  const sizePower = getSizePower();
  const glowScale = getGlowScale();
  const glowPower = getGlowPower();
  const sizeMax = getProfileSizeMax();

  const header = 'm       flux       fade   radius  glow';

  const lines = starData.mags.map((m) => {
    const flux = Math.pow(10, -0.4 * m);
    const fade = computeMagnitudeFade(m, limit, fadeRange);
    const radius = computeVisualRadiusPx(m, {
      magLimit: limit,
      magFadeRange: fadeRange,
      exposure,
      baseSize,
      sizeScale,
      sizePower,
      sizeMax,
    });
    const displayFlux = apparentFluxFromMagnitude(m) * exposure;
    const glowSignal = Math.max(Math.pow(1 + Math.max(displayFlux, 0), glowPower) - 1, 0);
    const glowAlpha = fade * (1 - Math.exp(-0.9 * glowScale * glowSignal));
    return `m=${String(m).padStart(4)}  flux=${flux.toExponential(1).padStart(9)}  fade=${fade.toFixed(2)}  r=${radius.toFixed(1).padStart(5)}px  glow=${(glowAlpha * 100).toFixed(0).padStart(3)}%`;
  });

  infoBlock.textContent = header + '\n' + lines.join('\n');
}

// --- Controls wiring ---

ctrlExposure.addEventListener('input', () => { updateReadouts(); syncUniforms(); updateInfo(); });
ctrlMagLimit.addEventListener('input', () => { updateReadouts(); syncUniforms(); updateInfo(); });
ctrlFadeRange.addEventListener('input', () => { updateReadouts(); syncUniforms(); updateInfo(); });
ctrlBaseSize.addEventListener('input', () => { updateReadouts(); syncUniforms(); updateInfo(); });
ctrlSizeScale.addEventListener('input', () => { updateReadouts(); syncUniforms(); updateInfo(); });
ctrlSizePower.addEventListener('input', () => { updateReadouts(); syncUniforms(); updateInfo(); });
ctrlGlowScale.addEventListener('input', () => { updateReadouts(); syncUniforms(); updateInfo(); });
ctrlGlowPower.addEventListener('input', () => { updateReadouts(); syncUniforms(); updateInfo(); });
ctrlMagBrightest.addEventListener('input', () => { updateReadouts(); rebuild(); updateInfo(); });

profileButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    profileButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeProfile = btn.dataset.profile;

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
        starFieldMagFadeRange: getFadeRange(),
        starFieldBaseSize: getBaseSize(),
        starFieldSizeScale: getSizeScale(),
        starFieldSizePower: getSizePower(),
        starFieldGlowScale: getGlowScale(),
        starFieldGlowPower: getGlowPower(),
        starFieldSizeMax: getProfileSizeMax(),
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
