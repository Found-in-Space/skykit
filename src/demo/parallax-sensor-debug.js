import { createDeviceTiltTracker } from '../index.js';

const statusValue = document.querySelector('[data-debug-status]');
const phaseValue = document.querySelector('[data-debug-phase]');
const orientationTypeValue = document.querySelector('[data-debug-orientation-type]');
const padDot = document.querySelector('[data-debug-pad-dot]');
const enableButton = document.querySelector('[data-action="enable-debug-motion"]');
const recenterButton = document.querySelector('[data-action="recenter-debug-motion"]');

const valueElements = new Map(
  Array.from(document.querySelectorAll('[data-debug-value]')).map((element) => [
    element.getAttribute('data-debug-value'),
    element,
  ]),
);

const barElements = new Map(
  Array.from(document.querySelectorAll('[data-debug-bar]')).map((element) => [
    element.getAttribute('data-debug-bar'),
    element,
  ]),
);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setStatus(message) {
  if (statusValue) {
    statusValue.textContent = message;
  }
}

function setValue(name, value) {
  const element = valueElements.get(name);
  if (!element) {
    return;
  }

  element.textContent = value;
}

function setGauge(name, value, min, max, saturated = false) {
  const element = barElements.get(name);
  if (!element) {
    return;
  }

  const clampedValue = clamp(value, min, max);
  const percentage = ((clampedValue - min) / (max - min)) * 100;
  element.style.left = `${percentage}%`;
  element.dataset.saturated = saturated ? 'true' : 'false';
}

function updatePad(x, y) {
  if (!padDot) {
    return;
  }

  const left = ((clamp(x, -1, 1) + 1) / 2) * 100;
  const top = ((clamp(y, -1, 1) + 1) / 2) * 100;
  padDot.style.left = `${left}%`;
  padDot.style.top = `${top}%`;
}

function formatVector(vector) {
  return `${vector.x.toFixed(4)}, ${vector.y.toFixed(4)}, ${vector.z.toFixed(4)}`;
}

const tiltTracker = createDeviceTiltTracker({
  swapAxes: false,
  invertY: false,
  onUpdate(state) {
    setValue('raw-alpha', state.raw.alpha.toFixed(2));
    setValue('raw-beta', state.raw.beta.toFixed(2));
    setValue('raw-gamma', state.raw.gamma.toFixed(2));
    setValue('screen-angle-deg', `${state.screen.angleDeg.toFixed(1)} deg`);
    setValue(
      'screen-compensated-angle-deg',
      `${(state.screen.compensatedAngleDeg ?? state.screen.angleDeg).toFixed(1)} deg`,
    );
    setValue('landscape-native', state.screen.landscapeNative ? 'yes' : 'no');
    setValue('projected-x', state.projected.x.toFixed(4));
    setValue('projected-y', state.projected.y.toFixed(4));
    setValue('clamped-x', state.clamped.x.toFixed(4));
    setValue('clamped-y', state.clamped.y.toFixed(4));
    setValue('normalized-x', state.normalized.x.toFixed(4));
    setValue('normalized-y', state.normalized.y.toFixed(4));
    setValue('baseline-right', formatVector(state.baseline.right));
    setValue('baseline-up', formatVector(state.baseline.up));
    setValue('current-normal', formatVector(state.current.normal));
    setValue('saturated-x', state.saturated.x ? 'yes' : 'no');
    setValue('saturated-y', state.saturated.y ? 'yes' : 'no');

    setGauge('raw-beta', state.raw.beta, -180, 180);
    setGauge('raw-gamma', state.raw.gamma, -90, 90);
    setGauge('projected-x', state.projected.x, -3, 3, state.saturated.x);
    setGauge('projected-y', state.projected.y, -3, 3, state.saturated.y);
    setGauge('normalized-x', state.normalized.x, -1, 1);
    setGauge('normalized-y', state.normalized.y, -1, 1);
    updatePad(state.normalized.x, state.normalized.y);

    if (phaseValue) {
      phaseValue.textContent = state.phase;
    }

    if (orientationTypeValue) {
      orientationTypeValue.textContent = state.screen.type ?? 'unknown';
    }

    if (state.phase === 'calibrated') {
      setStatus('Calibrated for the current device pose and screen orientation.');
      return;
    }

    setStatus('Live device-orientation data is updating.');
  },
});

enableButton?.addEventListener('click', async () => {
  const result = await tiltTracker.enable();
  if (!result.ok) {
    if (result.reason === 'unsupported') {
      setStatus('This browser does not expose DeviceOrientationEvent.');
      return;
    }

    setStatus('Motion permission was not granted.');
    return;
  }

  setStatus(
    result.recentered
      ? 'Recenter requested. Hold the device still for the next reading.'
      : 'Motion enabled. Hold the device in a neutral pose for calibration.',
  );
});

recenterButton?.addEventListener('click', () => {
  tiltTracker.recenter();
  setStatus('Recenter requested. Hold the device still for the next reading.');
});

window.addEventListener('beforeunload', () => {
  tiltTracker.dispose();
});
