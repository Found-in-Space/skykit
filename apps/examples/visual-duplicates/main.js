import { createVisibleDuplicateLinksExtension } from './visible-duplicate-links.js';
import { createVisualDuplicateMaterialProfile } from './visual-duplicate-material-profile.js';
import '../shared.css';
import '../xr-free-roam/xr-free-roam.css';
import './style.css';

const DATASET_ID = '74d8e0ae-6fcc-4c54-934f-42f5f2b8c550';
const ORION_CENTER_PC = { x: 62.775, y: 602.667, z: -12.713 };

globalThis.__SKYKIT_XR_FREE_ROAM_CONFIG__ = {
  octreeUrl: '/data/stars-v2.octree',
  datasetId: DATASET_ID,
  metaSidecarUrl: null,
  initialObserverPc: { x: 0, y: 0, z: 0 },
  initialTargetPc: ORION_CENTER_PC,
  preflightBackgroundOrbit: false,
  starSourceOptions: {
    demandDebounceMs: 350,
  },
  starFieldOptions: {
    vertexAttributes: [{
      name: 'visual_duplicate_role',
      type: 'uint8',
    }],
  },
  createStarFieldMaterialProfile: createVisualDuplicateMaterialProfile,
  extend(context) {
    return createVisibleDuplicateLinksExtension({
      context,
      sidecarUrl: '/data/stars-v2.visual-duplicates.octree',
      onState: updateDuplicateStatus,
    });
  },
};

void import('../xr-free-roam/xr-free-roam.js').catch((error) => {
  updateDuplicateStatus({
    state: 'failed',
    message: error instanceof Error ? error.message : String(error),
  });
  console.error(error);
});

function updateDuplicateStatus(status) {
  const item = document.querySelector('[data-preflight-check="duplicates"]');
  const output = document.querySelector('[data-duplicate-link-status]');
  const state = status.state === 'ready'
    ? 'ready'
    : status.state === 'failed'
      ? 'failed'
      : 'pending';
  if (item) {
    item.dataset.state = state;
    item.setAttribute('aria-busy', state === 'pending' ? 'true' : 'false');
  }
  const message = status.message || (state === 'pending' ? 'Loading' : state);
  if (output) output.textContent = message;
}
