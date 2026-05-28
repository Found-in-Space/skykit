import * as THREE from 'three';

import {
  SKYKIT_ACTIONS,
  createAnchoredImageCatalog,
  createAnchoredImageSkyPlugin,
  createKeyboardNavigationPlugin,
  createSkyGrabPlugin,
  createSkykitAnimationLoop,
  createSkykitDebugBridge,
  createSkykitHrDiagramPlugin,
  createSkykitNavigationPlugin,
  createSkykitStarSourcePlugin,
  createSkykitViewer,
  createStreamingStarsPlugin,
  createViewAnchoredImageController,
  installSkykitDebugGlobal,
} from '@found-in-space/skykit';
import {
  createSkykitSurfaceApp,
  createSkykitTabletRoot,
  createTouchOsPanelPlugin,
} from '@found-in-space/skykit/touch-os';
import {
  applySkykitXrDepthRange,
  computeSkykitXrDepthRange,
  createSkykitXrBodyPlugin,
  createSkykitXrControlBindings,
  createSkykitXrNavigationPlugin,
  createSkykitXrObserverRig,
  createSkykitXrRaySource,
  createSkykitXrRayVisualPlugin,
  createSkykitXrRig,
  createSkykitXrSessionPlugin,
  createSkykitXrStarPickingPlugin,
} from '@found-in-space/skykit/xr';
import {
  createActionCard,
  createButton,
  createSurfaceShell,
  defineControlsApp,
  defineTouchApp,
} from '@found-in-space/touch-os';
import { createXrRayPointerSource } from '@found-in-space/touch-os/hosts/three';
import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import {
  createMetaSidecarProviderService,
  deriveMetaSidecarUrlFromRenderUrl,
  metaSidecarEntryDisplayFields,
} from '@found-in-space/meta-sidecar-provider';
import {
  createThreeStarField,
  createDefaultThreeStarFieldMaterialProfile,
} from '@found-in-space/three-star-field';
import { createAnchoredImageManifest as createWesternSkycultureAnchoredImageManifest } from '@found-in-space/stellarium-skycultures-western/anchored-image';

const WESTERN_SKYCULTURE_ASSET_BASE =
  'https://cdn.jsdelivr.net/npm/@found-in-space/stellarium-skycultures-western@0.3.0/dist/';
const DATASET_ID_c56103 = 'c56103e6-ad4c-41f9-be06-048b48ec632b';
const SOL_PC = { x: 0, y: 0, z: 0 };
const ORION_CENTER_PC = { x: 62.775, y: 602.667, z: -12.713 };
const PREFLIGHT_BACKGROUND_ORBIT_RADIUS_PC = 2;
const PREFLIGHT_BACKGROUND_OBSERVER_PC = { x: 0, y: 0, z: PREFLIGHT_BACKGROUND_ORBIT_RADIUS_PC };
const PREFLIGHT_BACKGROUND_ORBIT_SPEED_RAD_PER_SEC = 0.002;
const PREFLIGHT_BACKGROUND_ORBIT_NORMAL = { x: 0, y: 1, z: 0 };
const DEFAULT_WORLD_SCALE = 1;
const DEFAULT_LIMITING_MAGNITUDE = 7.5;
const DEFAULT_EXPOSURE_LOG10 = 5;
const DEFAULT_EXPOSURE = 10 ** DEFAULT_EXPOSURE_LOG10;
// Observer-centric art is not under the scaled star root, so keep it at sky-dome distance.
const XR_CONSTELLATION_ART_RADIUS_WORLD_UNITS = 8000;
const XR_CONSTELLATION_ART_MAX_ANGLE_DEG = 60;
const XR_CONSTELLATION_ART_HYSTERESIS_SECONDS = 0.2;
const XR_PANEL_SURFACE = Object.freeze({ width: 420, height: 560, pixelDensity: 1 });
const XR_PANEL_THEME = Object.freeze({
  backgroundColor: '#07111e',
  surfaceColor: '#101b2a',
  textColor: '#eef8ff',
  mutedTextColor: '#8aa7b4',
  accentColor: '#35d6c8',
  accentTextColor: '#031416',
  borderColor: 'rgba(120, 210, 220, 0.28)',
  focusColor: '#79ffe8',
  overlayColor: 'rgba(4, 12, 23, 0.65)',
  controlHeight: 28,
  spacing: 5,
  padding: 7,
  radius: 6,
  typography: {
    fontFamily: 'ui-sans-serif',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: 500,
  },
});
const XR_DEMO_ACTIONS = Object.freeze({
  goSelected: 'xr-demo:selected.go',
  selectSun: 'xr-demo:selected.sun',
});
const XR_TABLET_APP_IDS = Object.freeze({
  target: 'space.found.skykit.xr-free-roam.target',
  rendering: 'space.found.skykit.xr-free-roam.rendering',
  hrDiagram: 'space.found.skykit.xr-free-roam.hr-diagram',
});
const HR_SURFACE_SIZE = Object.freeze({ width: 1024, height: 640 });
const LOCAL_FORWARD_VECTOR = new THREE.Vector3(0, 0, -1);
const _headGazeDirection = new THREE.Vector3();
const _headGazeQuaternion = new THREE.Quaternion();
const _shipGazeQuaternion = new THREE.Quaternion();

const debug = createSkykitDebugBridge();
installSkykitDebugGlobal(debug);

main().catch((error) => {
  markPreflightStartupFailure(error);
  debug.recordDiagnostic({
    level: 'error',
    type: 'xr-free-roam/startup-error',
    message: 'XR free-roam demo failed to start.',
    error,
  });
});

async function main() {
  const host = document.querySelector('[data-viewer]');
  if (!host) {
    throw new Error('XR free-roam demo requires [data-viewer].');
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setClearColor(0x020712, 1);
  renderer.xr.enabled = true;

  const camera = new THREE.PerspectiveCamera(60, 1, 0.02, 2000000);
  const initialOrientation = orientationLookingAt(PREFLIGHT_BACKGROUND_OBSERVER_PC, SOL_PC);
  const xrRig = createSkykitXrRig({
    navigationPose: {
      position: PREFLIGHT_BACKGROUND_OBSERVER_PC,
      orientation: initialOrientation,
    },
  });
  const shipDeck = createShipDeckSlab();
  shipDeck.visible = false;
  xrRig.deckRoot.add(shipDeck);

  const provider = createStarOctreeProviderService({
    url: OCTREE_DEFAULT,
    datasetId: DATASET_ID_c56103,
  });
  const metaProvider = createMetaSidecarProviderService({
    url: deriveMetaSidecarUrlFromRenderUrl(OCTREE_DEFAULT),
    parentDatasetId: DATASET_ID_c56103,
  });
  const source = createSkykitStarSourcePlugin({ provider });
  const starField = createThreeStarField({
    limitingMagnitude: DEFAULT_LIMITING_MAGNITUDE,
    coordinateUnitsPerParsec: DEFAULT_WORLD_SCALE,
    exposure: DEFAULT_EXPOSURE,
    materialProfile: createDefaultThreeStarFieldMaterialProfile({
      limitingMagnitude: DEFAULT_LIMITING_MAGNITUDE,
      coordinateUnitsPerParsec: DEFAULT_WORLD_SCALE,
      exposure: DEFAULT_EXPOSURE,
    }),
  });
  const selectedTarget = createSelectedStarTarget();
  xrRig.originContentRoot.add(selectedTarget.object3d);
  const rightRaySource = createWorldXrRaySource(
    createSkykitXrRaySource({ kind: 'target-ray', handedness: 'right', length: 2000000 }),
    xrRig.xrOrigin,
  );
  const touchPointerSource = createRightHandTouchPointerSource(rightRaySource);
  const panelState = {
    limitingMagnitude: DEFAULT_LIMITING_MAGNITUDE,
    exposureLog10: DEFAULT_EXPOSURE_LOG10,
    worldScaleLog10: Math.log10(DEFAULT_WORLD_SCALE),
    nearFloor: true,
    constellationArt: true,
    selected: null,
  };
  let panelRevision = 0;
  let cachedPanelRevision = -1;
  let cachedPanelRoot = null;
  let latestPanelFrame = null;
  let leftHandPanelTracked = false;
  let activeXrHandle = null;
  let artController = null;
  let preflightController = null;
  let touchPanel = null;
  let selectionGeneration = 0;
  const hrDiagram = createSkykitHrDiagramPlugin({
    id: 'xr-free-roam-hr-diagram',
    source,
    mode: 'frustum',
    limitingMagnitude: DEFAULT_LIMITING_MAGNITUDE,
    width: HR_SURFACE_SIZE.width,
    height: HR_SURFACE_SIZE.height,
    touchOs: {
      sourceId: 'xr-free-roam-hr-diagram:surface',
      componentId: 'xr-free-roam-hr-diagram:node',
      surfaces: () => touchPanel?.getRuntime()?.getServices().surfaces,
      width: HR_SURFACE_SIZE.width,
      height: HR_SURFACE_SIZE.height,
    },
  });
  const tabletApps = createXrTabletApps({
    hrDiagram,
    renderTargetReadout: createSelectedTargetReadout,
  });

  const artPlugin = await createConstellationArtPlugin().catch((error) => {
    debug.recordDiagnostic({
      level: 'warn',
      type: 'xr-free-roam/constellation-art-error',
      message: 'Constellation art could not be loaded.',
      error,
    });
    return null;
  });

  touchPanel = createTouchOsPanelPlugin({
    id: 'xr-free-roam-touch-panel',
    priority: 20,
    driver: 'scene',
    root: createPanelRoot,
    surfaceMetrics: XR_PANEL_SURFACE,
    runtimeOptions: {
      theme: XR_PANEL_THEME,
      longPressDelay: 360,
    },
    pointerSources: [touchPointerSource],
    parent() {
      return xrRig.leftHandRoot;
    },
    driverOptions: {
      panelWidth: 0.32,
      panelHeight: 0.44,
      transparent: true,
      depthTest: false,
      renderOrder: 50,
      updatePlacement(mesh) {
        if (!leftHandPanelTracked) return false;
        applyLocalTabletPlacement(mesh, {
          offset: { x: 0.04, y: 0.02, z: -0.08 },
          tiltRadians: -0.22,
        });
        return true;
      },
    },
  });

  const viewer = await createSkykitViewer({
    id: 'xr-free-roam-alpha',
    host,
    renderer,
    camera,
    cameraRoot: xrRig.headRoot,
    observerRig: createSkykitXrObserverRig({
      rig: xrRig,
      coordinateUnitsPerParsec: DEFAULT_WORLD_SCALE,
    }),
    roots: {
      originContentRoot: xrRig.originContentRoot,
      observerContentRoot: xrRig.observerContentRoot,
      navigationRoot: xrRig.navigationRoot,
      scaleBandedContentRoots: new Map(Object.entries(xrRig.scaleBandedContentRoots)),
    },
    view: {
      observerPc: PREFLIGHT_BACKGROUND_OBSERVER_PC,
      targetPc: SOL_PC,
      limitingMagnitude: DEFAULT_LIMITING_MAGNITUDE,
      coordinateUnitsPerParsec: DEFAULT_WORLD_SCALE,
      lookAt: { orientationIcrs: initialOrientation },
    },
    plugins: [
      createSkykitXrSessionPlugin({
        renderer,
        referenceSpaceType: 'local-floor',
        onSessionStarted(handle) {
          activeXrHandle = handle;
          shipDeck.visible = true;
          stopPreflightBackgroundOrbit(viewer);
          preflightController?.setSessionStatus('XR session active');
          preflightController?.sync();
          invalidatePanel();
          updateXrDepthRange(handle);
        },
      }),
      createSkykitNavigationPlugin(),
      source,
      createStreamingStarsPlugin({ id: 'xr-stars', source, renderer: starField }),
      hrDiagram,
      ...(artPlugin ? [artPlugin] : []),
      createSkykitXrBodyPlugin({
        rig: xrRig,
        onBody(body) {
          leftHandPanelTracked = Boolean(body.leftHand?.grip ?? body.leftHand?.targetRay);
          artController?.setViewDirectionIcrs?.(resolveHeadGazeDirectionIcrs(body, xrRig, camera));
        },
      }),
      createXrFreeRoamFrameSyncPlugin({
        update() {
          selectedTarget.update(camera);
          updateXrDepthRange(activeXrHandle);
        },
      }),
      createKeyboardNavigationPlugin({ speedPcPerSec: 2, rotationSpeedDegPerSec: 55 }),
      createSkyGrabPlugin({ target: host, sensitivityRadiansPerPixel: 0.0007 }),
      touchPanel,
      createSkykitXrNavigationPlugin({ moveSpeedPcPerSec: 4 }),
      createSkykitXrRayVisualPlugin({
        id: 'xr-free-roam-right-ray',
        raySource: rightRaySource,
        blockers: [touchPanel],
        color: 0x78ffe7,
        opacity: 0.82,
        length: 2000000,
        renderOrder: 60,
      }),
      createSkykitXrStarPickingPlugin({
        renderer: starField,
        source,
        raySource: rightRaySource,
        blockers: [touchPanel],
        attributes: ['objectRef', 'pickMeta'],
        onPick(event) {
          selectPickedStar(event);
        },
      }),
    ],
  });
  const loop = createSkykitAnimationLoop(viewer, { scheduler: 'renderer' });

  debug.registerViewer(viewer, {
    id: 'xr-free-roam-alpha',
    label: 'XR Free Roam Alpha',
  });
  viewer.on('xr/session-end', () => {
    activeXrHandle = null;
    shipDeck.visible = false;
    preflightController?.setSessionStatus('Session ended');
    preflightController?.sync();
    startPreflightBackgroundOrbit(viewer);
    invalidatePanel();
  });

  registerDemoActions(viewer);
  applyRenderState(viewer, starField, source);
  preflightController = createPreflightController({
    viewer,
    panelState,
    starField,
    source,
    applyRenderState,
    invalidatePanel,
    setConstellationArtEnabled,
    stopPreflightBackgroundOrbit: () => stopPreflightBackgroundOrbit(viewer),
    isPresenting: () => activeXrHandle?.presenting === true,
  });
  preflightController.sync();
  void preflightController.refreshXrSupport();
  startPreflightBackgroundOrbit(viewer);
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', () => {
    loop.dispose();
    selectedTarget.dispose();
    void viewer.dispose();
    void provider.dispose?.();
    void metaProvider.dispose?.();
  });
  loop.start();

  function resize() {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    viewer.resize({
      width,
      height,
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    });
  }

  async function createConstellationArtPlugin() {
    const catalog = await createAnchoredImageCatalog({
      manifest: createWesternSkycultureAnchoredImageManifest({
        baseUrl: WESTERN_SKYCULTURE_ASSET_BASE,
      }),
    });
    debug.recordDiagnostic({
      level: 'info',
      type: 'xr-free-roam/constellation-art-catalog',
      message: `Constellation art catalog loaded with ${catalog.list().length} entries.`,
    });
    artController = createHeadGazeAnchoredImageController(createViewAnchoredImageController({
      strategy: 'nearest',
      maxAngleDeg: XR_CONSTELLATION_ART_MAX_ANGLE_DEG,
      hysteresisSeconds: XR_CONSTELLATION_ART_HYSTERESIS_SECONDS,
    }));
    return createAnchoredImageSkyPlugin({
      id: 'xr-constellation-art',
      catalog,
      controller: artController,
      loading: 'lazy',
      anchorMode: 'observer-centric',
      fixedAtInfinity: true,
      radius: XR_CONSTELLATION_ART_RADIUS_WORLD_UNITS,
      opacity: 0.38,
      fadeInSeconds: 0.25,
      fadeOutSeconds: 0.25,
      skipTextureErrors: false,
      onTextureError(event) {
        debug.recordDiagnostic({
          level: 'warn',
          type: 'xr-free-roam/constellation-art-texture-error',
          message: `Constellation art texture failed for ${event.entry.label}.`,
          data: {
            key: event.entry.key,
            imageUrl: event.imageUrl,
          },
          error: event.error,
        });
      },
    });
  }

  function createPanelRoot(rootContext) {
    latestPanelFrame = rootContext?.frame ?? latestPanelFrame;
    if (cachedPanelRoot && cachedPanelRevision === panelRevision) return cachedPanelRoot;
    cachedPanelRevision = panelRevision;
    cachedPanelRoot = createSkykitTabletRoot({
      id: 'xr-free-roam-tablet',
      apps: tabletApps,
      appStates: {
        [XR_TABLET_APP_IDS.target]: panelState,
        [XR_TABLET_APP_IDS.rendering]: panelState,
        [XR_TABLET_APP_IDS.hrDiagram]: panelState,
      },
      homeControl: 'button',
      taskSwitcher: 'cards',
      taskCloseControl: 'button',
      launcherLayout: {
        tileWidth: 82,
        tileHeight: 86,
        gap: 9,
        bodyPadding: 9,
        iconMinSize: 36,
        iconMaxSize: 44,
        labelGap: 5,
      },
      onAppEvent: handleTabletAppEvent,
    });
    return cachedPanelRoot;
  }

  function createSelectedTargetReadout(state = panelState) {
    const selected = state.selected;
    if (!selected) {
      return [
        createActionCard('xr-selected-empty', {
          title: 'Target',
          emptyStateText: 'Pick a star or select Sun',
        }),
      ];
    }
    return [
      createActionCard('xr-selected-details', {
        title: selected.label || 'Selected star',
        lines: createSelectedIdentifierLines(selected),
        primaryActionId: XR_DEMO_ACTIONS.goSelected,
        primaryActionLabel: 'Fly to',
      }),
    ];
  }

  function handleTabletAppEvent(event) {
    if (event.type === 'app-change') {
      if (applyTabletStateChange(event.payload)) {
        applyRenderState(viewer, starField, source);
        preflightController?.sync();
        invalidatePanel();
      }
      return;
    }

    if (event.type !== 'app-action') return;
    if (event.name === XR_DEMO_ACTIONS.goSelected) {
      if (panelState.selected) {
        goToTarget(viewer, panelState.selected.targetPc, 0.65);
      }
    } else if (event.name === XR_DEMO_ACTIONS.selectSun) {
      selectSunTarget();
    }
  }

  function applyTabletStateChange(payload) {
    const field = payload?.field;
    const value = payload?.value;
    if (field === 'limitingMagnitude') {
      panelState.limitingMagnitude = clampNumber(value, 4, 10, panelState.limitingMagnitude);
      return true;
    }
    if (field === 'exposureLog10') {
      panelState.exposureLog10 = clampNumber(value, 3.5, 5.5, panelState.exposureLog10);
      return true;
    }
    if (field === 'worldScaleLog10') {
      panelState.worldScaleLog10 = clampNumber(value, -3, 0, panelState.worldScaleLog10);
      return true;
    }
    if (field === 'nearFloor') {
      panelState.nearFloor = Boolean(value);
      return true;
    }
    if (field === 'constellationArt') {
      setConstellationArtEnabled(Boolean(value));
      return true;
    }
    return false;
  }

  function setConstellationArtEnabled(enabled) {
    panelState.constellationArt = enabled;
    artController?.setSelection?.(enabled ? undefined : () => false);
  }

  function selectPickedStar(event) {
    const targetPc = renderPositionToPc(event.pick.position, viewer.getViewState().coordinateUnitsPerParsec);
    const generation = selectTarget({
      label: 'Selected star',
      position: { ...event.pick.position },
      targetPc,
      identifiers: createEmptyIdentifierFields(),
      identifierStatus: 'loading',
    }, event.pick.position);
    void resolveSelectedStarIdentifiers(event.pick, generation);
  }

  function selectSunTarget() {
    const generation = selectTarget({
      label: 'Sun',
      position: {
        x: SOL_PC.x * viewer.getViewState().coordinateUnitsPerParsec,
        y: SOL_PC.y * viewer.getViewState().coordinateUnitsPerParsec,
        z: SOL_PC.z * viewer.getViewState().coordinateUnitsPerParsec,
      },
      targetPc: { ...SOL_PC },
      identifiers: {
        ...createEmptyIdentifierFields(),
        properName: 'Sol',
        primaryLabel: 'Sun',
      },
      identifierStatus: 'synthetic',
    }, SOL_PC);
    selectionGeneration = generation;
  }

  function selectTarget(selection, renderPosition) {
    selectionGeneration += 1;
    panelState.selected = selection;
    selectedTarget.setPosition(renderPosition);
    invalidatePanel();
    return selectionGeneration;
  }

  async function resolveSelectedStarIdentifiers(pick, generation) {
    const ref = pick.objectRef ?? pick.pickMeta ?? null;
    if (!ref) {
      debug.recordDiagnostic({
        level: 'warn',
        type: 'xr-free-roam/star-pick-missing-sidecar-ref',
        message: 'Selected star did not include sidecar lookup metadata.',
      });
      updateSelectedIdentifiers(generation, null, 'unavailable');
      return;
    }

    try {
      const entry = await metaProvider.getMeta(ref);
      updateSelectedIdentifiers(
        generation,
        metaSidecarEntryDisplayFields(entry),
        entry ? 'ready' : 'unavailable',
      );
    } catch (error) {
      debug.recordDiagnostic({
        level: 'warn',
        type: 'xr-free-roam/star-sidecar-lookup-error',
        message: 'Selected star identifiers could not be loaded from the metadata sidecar.',
        error,
      });
      updateSelectedIdentifiers(generation, null, 'error');
    }
  }

  function updateSelectedIdentifiers(generation, fields, status) {
    if (generation !== selectionGeneration || !panelState.selected) return;
    const identifiers = fields ?? createEmptyIdentifierFields();
    panelState.selected = {
      ...panelState.selected,
      label: identifiers.primaryLabel || 'Selected star',
      identifiers,
      identifierStatus: status,
    };
    invalidatePanel();
  }

  function applyRenderState(activeViewer, activeStarField, activeSource) {
    const worldScale = 10 ** panelState.worldScaleLog10;
    const exposure = 10 ** panelState.exposureLog10;
    activeViewer.requestViewState({
      limitingMagnitude: panelState.limitingMagnitude,
      coordinateUnitsPerParsec: worldScale,
    }, 'xr-free-roam.rendering');
    activeStarField.setView({
      limitingMagnitude: panelState.limitingMagnitude,
      coordinateUnitsPerParsec: worldScale,
      exposure,
      nearMagLimitFloor: panelState.nearFloor ? 25 : panelState.limitingMagnitude,
      nearMagLimitRadiusPc: panelState.nearFloor ? 1 : 0,
      nearSizeFloor: panelState.nearFloor ? 8 : 0,
      nearAlphaFloor: panelState.nearFloor ? 0.35 : 0,
    });
    void activeSource.refreshDemand?.('xr-free-roam.rendering');
    updateXrDepthRange(activeXrHandle);
  }

  function registerDemoActions(activeViewer) {
    activeViewer.actions.registerAction(XR_DEMO_ACTIONS.goSelected, () => {
      if (panelState.selected) {
        goToTarget(activeViewer, panelState.selected.targetPc, 0.65);
      }
    }, { label: 'Go to selected star' });
    activeViewer.actions.registerAction(XR_DEMO_ACTIONS.selectSun, () => {
      selectSunTarget();
    }, { label: 'Select Sun' });
  }

  function goToTarget(activeViewer, targetPc, approachPc) {
    const current = activeViewer.getViewState();
    const observerPc = approachTargetFromObserver(targetPc, current.observerPc, approachPc);
    void activeViewer.actions.invoke(SKYKIT_ACTIONS.navigation.transitionTo, {
      view: {
        observerPc,
        targetPc,
        lookAt: { orientationIcrs: orientationLookingAt(observerPc, targetPc) },
      },
      durationSecs: 2.4,
      movement: 'smoothstep',
      orientation: 'smoothstep',
    }, { source: 'xr-free-roam-demo' });
  }

  function updateXrDepthRange(handle) {
    if (!handle) return;
    const worldScale = 10 ** panelState.worldScaleLog10;
    const view = viewer.getViewState();
    const visibleBounds = starField.getVisibleBounds({ units: 'parsec' });
    const constellationRadiusNavigationUnits = XR_CONSTELLATION_ART_RADIUS_WORLD_UNITS / worldScale;
    const range = computeSkykitXrDepthRange({
      observer: view.observerPc,
      visibleBounds,
      observerCentricSpheres: [
        { radiusNavigationUnits: constellationRadiusNavigationUnits },
      ],
      scale: {
        navigationUnits: 'pc',
        metersPerNavigationUnit: worldScale,
        worldUnitsPerNavigationUnit: worldScale,
      },
      policy: {
        near: 0.03,
        minFar: 100,
        maxFar: 2000000,
        marginFactor: 1.2,
      },
    });
    camera.near = range.near;
    camera.far = range.far;
    camera.updateProjectionMatrix();
    applySkykitXrDepthRange(handle, range);
  }

  function invalidatePanel() {
    panelRevision += 1;
  }

  function getLatestPanelFrame() {
    return latestPanelFrame;
  }

  touchPointerSource.getLatestPanelFrame = getLatestPanelFrame;
}

function createHeadGazeAnchoredImageController(controller) {
  let headViewDirectionIcrs = null;

  return {
    update(input) {
      return controller.update({
        ...input,
        viewDirectionIcrs: headViewDirectionIcrs ?? input.viewDirectionIcrs,
      });
    },
    setSelection(selection) {
      controller.setSelection?.(selection);
    },
    getSelection() {
      return controller.getSelection?.();
    },
    setViewDirectionIcrs(direction) {
      headViewDirectionIcrs = normalizeDirectionLike(direction);
    },
    getSnapshot() {
      return {
        type: 'head-gaze',
        source: headViewDirectionIcrs ? 'head' : 'view',
        headViewDirectionIcrs,
        inner: controller.getSnapshot?.() ?? null,
      };
    },
  };
}

function resolveHeadGazeDirectionIcrs(body, xrRig, camera) {
  const headOrientation = normalizeQuaternionLike(body?.head?.orientation);
  if (headOrientation) {
    _headGazeQuaternion.set(
      headOrientation.x,
      headOrientation.y,
      headOrientation.z,
      headOrientation.w,
    );
    const shipOrientation = normalizeQuaternionLike(xrRig?.getNavigationPose?.().orientation);
    if (shipOrientation) {
      _shipGazeQuaternion.set(
        shipOrientation.x,
        shipOrientation.y,
        shipOrientation.z,
        shipOrientation.w,
      );
      _headGazeQuaternion.premultiply(_shipGazeQuaternion);
    }
    _headGazeDirection.copy(LOCAL_FORWARD_VECTOR).applyQuaternion(_headGazeQuaternion).normalize();
    return vector3ToPlain(_headGazeDirection);
  }

  camera?.updateWorldMatrix?.(true, false);
  const sceneForward = camera?.getWorldDirection?.(_headGazeDirection);
  return sceneForward ? vector3ToPlain(sceneForward.normalize()) : null;
}

function normalizeDirectionLike(direction) {
  if (!direction || typeof direction !== 'object') return null;
  const x = Number(direction.x);
  const y = Number(direction.y);
  const z = Number(direction.z);
  const length = Math.hypot(x, y, z);
  return length > 0
    ? { x: x / length, y: y / length, z: z / length }
    : null;
}

function normalizeQuaternionLike(quaternion) {
  if (!quaternion || typeof quaternion !== 'object') return null;
  const x = Number(quaternion.x);
  const y = Number(quaternion.y);
  const z = Number(quaternion.z);
  const w = Number(quaternion.w);
  const length = Math.hypot(x, y, z, w);
  return length > 0
    ? { x: x / length, y: y / length, z: z / length, w: w / length }
    : null;
}

function vector3ToPlain(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function createXrFreeRoamFrameSyncPlugin(options) {
  return {
    id: 'xr-free-roam-frame-sync',
    setup(context) {
      context.addPart({
        id: 'xr-free-roam-frame-sync',
        priority: 80,
        update(frame) {
          options.update?.(frame);
        },
      });
    },
  };
}

function createXrTabletApps(options) {
  return [
    createTargetTabletApp(options),
    createRenderingTabletApp(),
    createSkykitSurfaceApp({
      id: XR_TABLET_APP_IDS.hrDiagram,
      name: 'HR',
      icon: { kind: 'symbol', value: 'HR' },
      node: () => options.hrDiagram.getNode(),
      preferredWindow: {
        width: 420,
        height: 526,
        minWidth: 360,
        minHeight: 300,
        resizable: false,
      },
      backgroundColor: '#050c16',
      emptyLabel: 'HR diagram unavailable',
    }),
  ];
}

function createTargetTabletApp(options) {
  return defineTouchApp({
    manifest: {
      id: XR_TABLET_APP_IDS.target,
      name: 'Target',
      version: '1.0.0',
      icon: { kind: 'symbol', value: 'TG' },
      preferredWindow: {
        width: 420,
        height: 526,
        minWidth: 320,
        minHeight: 260,
        resizable: false,
      },
    },
    createApp(ctx) {
      return {
        render(state) {
          return createSurfaceShell('xr-target-app', {
            pointerOpaque: true,
            gap: 6,
            padding: 6,
            bodyGap: 5,
            bodyPadding: 0,
            scrollId: 'xr-target-app-scroll',
            backgroundColor: 'rgba(4, 12, 23, 0.86)',
            children: options.renderTargetReadout(state),
            footer: createButton('xr-selected-sun', {
              label: 'Sun',
              actionId: XR_DEMO_ACTIONS.selectSun,
            }),
          });
        },
        handleOutput(output) {
          emitTabletAppOutput(ctx, output);
        },
      };
    },
  });
}

function createRenderingTabletApp() {
  return defineControlsApp({
    id: XR_TABLET_APP_IDS.rendering,
    name: 'Render',
    icon: { kind: 'symbol', value: 'RD' },
    preferredSurface: {
      width: 420,
      height: 526,
      minWidth: 320,
      minHeight: 280,
      resizable: false,
    },
    controls: ({ section, slider, status, toggle }) => [
      section('Stars', [
        slider('Limit', 'limitingMagnitude', {
          min: 4,
          max: 10,
          step: 0.1,
          valueText: (state) => `Mag ${state.limitingMagnitude.toFixed(1)}`,
        }),
        slider('Exposure', 'exposureLog10', {
          min: 3.5,
          max: 5.5,
          step: 0.1,
          valueText: (state) => Math.round(10 ** state.exposureLog10).toLocaleString(),
        }),
        slider('Scale', 'worldScaleLog10', {
          min: -3,
          max: 0,
          step: 0.1,
          valueText: (state) => formatWorldScale(10 ** state.worldScaleLog10),
        }),
      ]),
      section('Context', [
        toggle('Nearby glow', 'nearFloor'),
        toggle('Constellation art', 'constellationArt'),
        status('Target', (state) => state.selected?.label ?? 'None', { tone: 'muted' }),
      ]),
    ],
  });
}

function emitTabletAppOutput(ctx, output) {
  if (output?.type === 'action') {
    ctx.actions.emit({
      type: 'app-action',
      appId: ctx.appId,
      instanceId: ctx.instanceId,
      windowId: ctx.windowId,
      name: output.actionId,
      ...(output.payload === undefined ? {} : { payload: output.payload }),
    });
  }
}

function startPreflightBackgroundOrbit(viewer) {
  void viewer.actions.invoke(SKYKIT_ACTIONS.navigation.orbit, {
    center: SOL_PC,
    radius: PREFLIGHT_BACKGROUND_ORBIT_RADIUS_PC,
    angularSpeedRadPerSec: PREFLIGHT_BACKGROUND_ORBIT_SPEED_RAD_PER_SEC,
    normal: PREFLIGHT_BACKGROUND_ORBIT_NORMAL,
  }, { source: 'xr-free-roam-preflight-background' });
  void viewer.actions.invoke(SKYKIT_ACTIONS.navigation.lockAt, {
    targetPc: SOL_PC,
    recenterSpeed: 0.025,
  }, { source: 'xr-free-roam-preflight-background' });
}

function stopPreflightBackgroundOrbit(viewer) {
  void viewer.actions.invoke(SKYKIT_ACTIONS.navigation.cancelMovement, null, {
    source: 'xr-free-roam-preflight-background',
  });
  void viewer.actions.invoke(SKYKIT_ACTIONS.navigation.unlockAt, null, {
    source: 'xr-free-roam-preflight-background',
  });
}

function createPreflightController(options) {
  const shell = document.querySelector('.xr-free-roam-shell');
  const enterButton = document.querySelector('[data-action="enter-xr"]');
  const xrRequirements = document.querySelector('[data-xr-requirements]');
  const sessionStatus = document.querySelector('[data-session-status]');
  const checkStates = {
    skykit: 'pending',
    stars: 'pending',
    xr: 'pending',
  };

  setCheckState('skykit', 'ready', 'Available');
  refreshStarStatus();
  options.source?.subscribe?.((delta) => {
    refreshStarStatus(delta);
    sync();
  }, { replay: true });

  enterButton?.addEventListener('click', async () => {
    options.stopPreflightBackgroundOrbit?.();
    setSessionStatus('Opening XR session');
    sync();
    const results = await options.viewer.actions.invoke(SKYKIT_ACTIONS.xr.enter, null, {
      source: 'xr-free-roam-dom',
    });
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected) {
      const reason = rejected.reason instanceof Error ? rejected.reason.message : String(rejected.reason);
      setSessionStatus(reason || 'XR session failed');
    } else {
      setSessionStatus('XR session requested');
    }
    sync();
  });

  return {
    sync,
    setSessionStatus,
    refreshXrSupport,
  };

  function sync() {
    const presenting = options.isPresenting();
    const readyToEnter = !presenting && allPreflightChecksReady();
    const xrUnavailable = checkStates.xr === 'failed';
    shell?.classList.toggle('is-presenting', presenting);
    if (enterButton instanceof HTMLButtonElement) {
      enterButton.hidden = presenting || xrUnavailable;
      enterButton.disabled = !readyToEnter;
      enterButton.textContent = resolveEnterButtonLabel(readyToEnter);
    }
    if (xrRequirements instanceof HTMLElement) {
      xrRequirements.hidden = !xrUnavailable;
    }
  }

  function setSessionStatus(text) {
    if (sessionStatus) {
      sessionStatus.textContent = text;
    }
  }

  async function refreshXrSupport() {
    setCheckState('xr', 'pending', 'Checking');
    sync();
    let xrSupported;
    try {
      xrSupported = await globalThis.navigator?.xr?.isSessionSupported?.('immersive-vr') ?? false;
    } catch {
      xrSupported = false;
    }
    setCheckState('xr', xrSupported ? 'ready' : 'failed', xrSupported ? 'Available' : 'Unavailable');
    sync();
    return xrSupported;
  }

  function refreshStarStatus(delta) {
    if (delta?.type === 'stars/error') {
      setCheckState('stars', 'failed', 'Stream failed');
      return;
    }
    if (delta?.type === 'stars/cells-upsert') {
      setCheckState('stars', 'ready', 'Loading');
      return;
    }
    if (delta?.type === 'stars/current') {
      setCheckState('stars', 'ready', 'Ready');
      return;
    }
    const snapshot = options.source?.getSnapshot?.();
    if (snapshot?.status === 'failed') {
      setCheckState('stars', 'failed', 'Stream failed');
    } else if (snapshot?.status === 'streaming') {
      setCheckState('stars', 'ready', 'Loading');
    } else if (snapshot?.status === 'current') {
      setCheckState('stars', 'ready', 'Ready');
    } else if (snapshot?.store?.starCount > 0) {
      setCheckState('stars', 'ready', 'Loading');
    } else if (snapshot?.demandCount > 0 || snapshot?.sessionId) {
      setCheckState('stars', 'ready', 'Loading');
    } else {
      setCheckState('stars', 'pending', 'Waiting for cells');
    }
  }

  function setCheckState(id, state, text) {
    checkStates[id] = state;
    setPreflightCheckState(id, state, text);
  }

  function allPreflightChecksReady() {
    return checkStates.skykit === 'ready' && checkStates.stars === 'ready' && checkStates.xr === 'ready';
  }

  function resolveEnterButtonLabel(readyToEnter) {
    if (readyToEnter) return 'Enter VR';
    if (checkStates.stars === 'failed') return 'Stars unavailable';
    return 'Running checklist';
  }
}

function setPreflightCheckState(id, state, text) {
  const item = document.querySelector(`[data-preflight-check="${id}"]`);
  if (!item) return;
  item.dataset.state = state;
  item.setAttribute('aria-busy', state === 'pending' ? 'true' : 'false');
  const status = item.querySelector('[data-preflight-check-status]');
  if (status) {
    status.textContent = text;
  }
}

function markPreflightStartupFailure(error) {
  setPreflightCheckState('skykit', 'failed', 'Unavailable');
  const sessionStatus = document.querySelector('[data-session-status]');
  if (sessionStatus) {
    const message = error instanceof Error ? error.message : String(error);
    sessionStatus.textContent = message || 'SkyKit startup failed';
  }
}

function formatWorldScale(value) {
  return `${value.toLocaleString('en-US', { maximumSignificantDigits: 3 })} m/pc`;
}

function createEmptyIdentifierFields() {
  return {
    properName: '',
    bayer: '',
    hd: '',
    hip: '',
    gaia: '',
    primaryLabel: '',
  };
}

function createSelectedIdentifierLines(selected) {
  const fields = selected.identifiers ?? createEmptyIdentifierFields();
  const lines = [
    `Proper: ${fields.properName || '-'}`,
    `Bayer: ${fields.bayer || '-'}`,
    `HD: ${fields.hd || '-'}`,
    `HIP: ${fields.hip || '-'}`,
    `Gaia: ${fields.gaia || '-'}`,
  ];
  if (selected.identifierStatus === 'loading') {
    lines.push('Loading identifiers...');
  } else if (selected.identifierStatus === 'error') {
    lines.push('Identifiers unavailable');
  } else if (selected.identifierStatus === 'unavailable') {
    lines.push('No catalog identifiers');
  }
  return lines;
}

function createRightHandTouchPointerSource(raySource) {
  const controls = createSkykitXrControlBindings({
    buttons: {
      select: { hand: 'right', button: 'trigger' },
    },
  });
  const pointerSource = createXrRayPointerSource(() => {
    const skykitFrame = pointerSource.getLatestPanelFrame?.();
    const xr = skykitFrame?.xr;
    if (xr?.presenting !== true || !xr.session) return undefined;
    const inputSources = xr.session && typeof xr.session === 'object'
      ? xr.session.inputSources ?? []
      : [];
    controls.update({ inputSources });
    const ray = raySource.getRay({
      frame: xr.frame,
      referenceSpace: xr.referenceSpace,
      session: xr.session,
      inputSources,
    });
    if (!ray) return undefined;

    const select = controls.getButton('select');
    const phase = select.pressedEdge ? 'down' : select.releasedEdge ? 'up' : 'move';
      return {
        pointerId: 'right-trigger',
        pointerType: 'ray',
        handedness: 'right',
      phase,
      timestamp: skykitFrame.elapsedSeconds * 1000,
      sourceId: 'right-controller',
      pressure: select.value,
      origin: ray.origin,
      direction: ray.direction,
    };
  });
  pointerSource.getLatestPanelFrame = () => null;
  return pointerSource;
}

function createWorldXrRaySource(source, transformRoot) {
  return {
    id: `${source.id}:world`,
    getRay(context) {
      const ray = source.getRay(context);
      if (!ray) return null;
      transformRoot.updateMatrixWorld(true);
      const origin = new THREE.Vector3(ray.origin.x, ray.origin.y, ray.origin.z)
        .applyMatrix4(transformRoot.matrixWorld);
      const rootQuaternion = transformRoot.getWorldQuaternion(new THREE.Quaternion());
      const direction = new THREE.Vector3(ray.direction.x, ray.direction.y, ray.direction.z)
        .applyQuaternion(rootQuaternion)
        .normalize();
      return {
        ...ray,
        origin: { x: origin.x, y: origin.y, z: origin.z },
        direction: { x: direction.x, y: direction.y, z: direction.z },
      };
    },
    getSnapshot() {
      return source.getSnapshot?.() ?? { id: `${source.id}:world` };
    },
    dispose() {
      source.dispose?.();
    },
  };
}

function applyLocalTabletPlacement(mesh, options = {}) {
  const offset = options.offset ?? {};
  mesh.position.set(0, 0, 0);
  mesh.quaternion.identity();
  mesh.scale.set(1, 1, 1);
  if (Number.isFinite(options.tiltRadians)) {
    mesh.rotateX(options.tiltRadians);
  }
  mesh.translateX(offset.x ?? 0);
  mesh.translateY(offset.y ?? 0);
  mesh.translateZ(offset.z ?? 0);
}

function createSelectedStarTarget() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const center = canvas.width / 2;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(84, 255, 172, 0.96)';
  context.lineWidth = 7;
  context.shadowColor = 'rgba(84, 255, 172, 0.48)';
  context.shadowBlur = 10;
  context.beginPath();
  context.arc(center, center, 42, 0, Math.PI * 2);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const object3d = new THREE.Sprite(material);
  object3d.name = 'xr-selected-star-target';
  object3d.visible = false;
  object3d.renderOrder = 10_000;
  object3d.scale.set(1, 1, 1);
  const worldPosition = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();

  return {
    object3d,
    setPosition(position) {
      object3d.position.set(position.x, position.y, position.z);
      object3d.visible = true;
    },
    clear() {
      object3d.visible = false;
    },
    update(camera) {
      if (!object3d.visible) return;
      object3d.getWorldPosition(worldPosition);
      camera.getWorldPosition(cameraPosition);
      const distance = Math.max(worldPosition.distanceTo(cameraPosition), 0.001);
      const diameter = Math.max(distance * 0.032, 0.035);
      object3d.scale.set(diameter, diameter, 1);
    },
    dispose() {
      object3d.parent?.remove(object3d);
      material.dispose();
      texture.dispose();
    },
  };
}

function createShipDeckSlab() {
  const root = new THREE.Group();
  root.name = 'xr-ship-deck';
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.025, 1.45),
    new THREE.MeshBasicMaterial({
      color: 0x1f8f90,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );
  base.position.set(0, -0.015, -0.08);
  root.add(base);
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.03, 0.34),
    new THREE.MeshBasicMaterial({
      color: 0xb5fff2,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    }),
  );
  nose.position.set(0, -0.012, -0.7);
  root.add(nose);
  return root;
}

function approachTargetFromObserver(targetPc, observerPc, distancePc) {
  const direction = new THREE.Vector3(
    observerPc.x - targetPc.x,
    observerPc.y - targetPc.y,
    observerPc.z - targetPc.z,
  );
  if (direction.lengthSq() < 1e-8) {
    direction.set(0, 0, 1);
  }
  direction.normalize();
  return {
    x: targetPc.x + direction.x * distancePc,
    y: targetPc.y + direction.y * distancePc,
    z: targetPc.z + direction.z * distancePc,
  };
}

function orientationLookingAt(observerPc, targetPc) {
  const direction = new THREE.Vector3(
    targetPc.x - observerPc.x,
    targetPc.y - observerPc.y,
    targetPc.z - observerPc.z,
  );
  if (direction.lengthSq() < 1e-8) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  direction.normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

function renderPositionToPc(position, coordinateUnitsPerParsec) {
  const scale = Number.isFinite(coordinateUnitsPerParsec) && coordinateUnitsPerParsec > 0
    ? coordinateUnitsPerParsec
    : 1;
  return {
    x: position.x / scale,
    y: position.y / scale,
    z: position.z / scale,
  };
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}
