// @ts-nocheck
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import {
  createTimedJourneyEvaluator,
  deleteJourneyEaseLocationGroupHelpers,
  easeJourneyLocationRangeStartEnd,
  equalizeJourneyLocationRangeSpeeds,
  getJourneyLocationRangeSpeedStats,
  normalizeTimedJourney,
  rebuildJourneyEaseLocationGroup,
} from '@found-in-space/journey';
import {
  createObject3dPlugin,
  createSkykitAnimationLoop,
  createSkykitViewer,
  createStreamingStarsPlugin,
} from '@found-in-space/skykit';
import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createObserverShellStrategy } from '@found-in-space/star-trees';
import { createThreeStarField } from '@found-in-space/three-star-field';

import {
  createJourneyVideoEditorDocument,
  exportJourneyVideoEditorDocument,
  importJourneyVideoEditorDocument,
  normalizeJourneyVideoEditorState,
} from './index.js';
import {
  computeJourneyBounds,
  createJourneyEditorProjectionData,
  createJourneyProjectionTransform,
  hitJourneyEditorMarker,
  projectJourneyEditorPoint,
} from './editor/projection.js';

const SAMPLE_STEP_SECS = 0.5;
const TIMELINE_STEP_SECS = 0.05;
const TILE_MODES = ['xy', 'xz', 'yz', 'perspective', 'skykit'];
const TILE_LABELS = new Map([
  ['xy', 'XY'],
  ['xz', 'XZ'],
  ['yz', 'YZ'],
  ['perspective', 'Perspective'],
  ['skykit', 'SkyKit'],
]);

/**
 * @param {import('./editor.d.ts').CreateJourneyVideoEditorOptions} [options]
 * @returns {import('./editor.d.ts').JourneyVideoEditor}
 */
export function createJourneyVideoEditor(options = {}) {
  const model = createEditorModel(options);
  const mount = options.host ? mountEditor(options.host, model, options) : null;
  return {
    setJourney(nextJourney) {
      model.setJourney(nextJourney);
      mount?.renderAll();
    },
    getJourney() {
      return model.getJourney();
    },
    evaluateAt(timeSecs) {
      return model.evaluateAt(timeSecs);
    },
    setTime(timeSecs) {
      model.setTime(timeSecs);
      mount?.renderAll();
    },
    play() {
      model.play();
      mount?.startLoop();
      mount?.renderAll();
    },
    pause() {
      model.pause();
      mount?.renderAll();
    },
    setTileMode(index, mode) {
      model.setTileMode(index, mode);
      mount?.renderAll();
    },
    setZoom(zoom) {
      model.setZoom(zoom);
      mount?.renderAll();
    },
    selectWidget(type, id) {
      model.selectWidget(type, id);
      mount?.renderAll();
    },
    getSnapshot() {
      return model.getSnapshot();
    },
    async dispose() {
      model.dispose();
      await mount?.dispose();
    },
  };
}

/**
 * @param {import('./editor.d.ts').CreateJourneyVideoEditorOptions} options
 */
function createEditorModel(options) {
  let document = options.document
    ? importJourneyVideoEditorDocument(options.document)
    : createJourneyVideoEditorDocument({
      journey: options.journey,
      editorState: options.editorState,
    });
  let journey = document.journey;
  let state = normalizeJourneyVideoEditorState(document.editorState);
  let evaluator = createTimedJourneyEvaluator(journey);
  let samples = evaluator.sample({ stepSecs: SAMPLE_STEP_SECS });
  let evaluated = evaluator.evaluate(state.timeSecs);
  let disposed = false;

  function persist() {
    document = createJourneyVideoEditorDocument({ journey, editorState: state, metadata: document.metadata });
    options.storage?.save?.(document);
    options.onChange?.(document);
  }

  function rebuild() {
    evaluator = createTimedJourneyEvaluator(journey);
    samples = evaluator.sample({ stepSecs: SAMPLE_STEP_SECS });
    state.timeSecs = clamp(state.timeSecs, 0, journey.durationSecs);
    evaluated = evaluator.evaluate(state.timeSecs);
    persist();
  }

  return {
    get journey() { return journey; },
    get state() { return state; },
    get evaluator() { return evaluator; },
    get samples() { return samples; },
    get evaluated() { return evaluated; },
    setJourney(nextJourney) {
      assertActive();
      journey = normalizeTimedJourney(nextJourney);
      state.selectedWidget = null;
      state.selectedLocationRange = null;
      state.selectedLocationGroupId = null;
      state.selectedLocationGroupPhase = null;
      rebuild();
    },
    getJourney() {
      return normalizeTimedJourney(journey);
    },
    evaluateAt(timeSecs) {
      return evaluator.evaluate(timeSecs);
    },
    setTime(timeSecs) {
      assertActive();
      state.timeSecs = clamp(snapTime(timeSecs), 0, journey.durationSecs);
      evaluated = evaluator.evaluate(state.timeSecs);
      persist();
    },
    play() {
      assertActive();
      state.playing = true;
      persist();
    },
    pause() {
      state.playing = false;
      if (!disposed) persist();
    },
    tick(deltaSeconds) {
      if (!state.playing) return;
      const next = state.timeSecs + Math.max(0, Number(deltaSeconds) || 0);
      this.setTime(next >= journey.durationSecs ? 0 : next);
    },
    setTileMode(index, mode) {
      assertActive();
      if (!TILE_MODES.includes(mode)) return;
      state.tileModes[Math.max(0, Math.min(3, Number(index) || 0))] = mode;
      persist();
    },
    setZoom(zoom) {
      assertActive();
      state.zoom = clamp(Number(zoom), 0.35, 50);
      persist();
    },
    selectWidget(type, id, options = {}) {
      assertActive();
      const ref = findWidget(journey, type, id);
      if (!ref) {
        state.selectedWidget = null;
        state.selectedLocationRange = null;
        return;
      }
      if (options.extendRange && ref.type === 'location' && state.selectedWidget?.type === 'location') {
        state.selectedLocationRange = { anchorId: state.selectedWidget.id, focusId: ref.id };
      } else if (!options.keepRange) {
        state.selectedLocationRange = null;
      }
      state.selectedWidget = ref;
      persist();
    },
    updateSelectedPoint(point) {
      const selected = state.selectedWidget;
      if (!selected) return;
      const target = findMutableWidget(journey, selected.type, selected.id);
      if (!target) return;
      if (selected.type === 'location') target.positionPc = { ...point };
      if (selected.type === 'guide') target.positionPc = { ...point };
      if (selected.type === 'camera' && target.kind === 'target') target.targetPc = { ...point };
      rebuild();
    },
    addLocation() {
      const frame = evaluated;
      const waypoint = {
        id: nextId(journey.locationWaypoints, 'loc'),
        timeSecs: state.timeSecs,
        positionPc: { ...frame.observerPc },
      };
      journey = {
        ...journey,
        locationWaypoints: sortByTime([...journey.locationWaypoints, waypoint]),
      };
      state.selectedWidget = { type: 'location', id: waypoint.id };
      rebuild();
    },
    addCamera() {
      const frame = evaluated;
      const waypoint = {
        id: nextId(journey.cameraLookWaypoints, 'cam'),
        timeSecs: state.timeSecs,
        kind: 'target',
        targetPc: { ...frame.targetPc },
        up: { ...frame.cameraUpPc },
      };
      journey = {
        ...journey,
        cameraLookWaypoints: sortByTime([...journey.cameraLookWaypoints, waypoint]),
      };
      state.selectedWidget = { type: 'camera', id: waypoint.id };
      rebuild();
    },
    addGuide() {
      const frame = evaluated;
      const guide = {
        id: nextId(journey.guides, 'guide'),
        label: `Guide ${journey.guides.length + 1}`,
        shape: 'sphere',
        positionPc: { ...frame.observerPc },
        radiusPc: 5,
        sizePc: 5,
        color: '#8fd5ff',
        opacity: 0.45,
      };
      journey = { ...journey, guides: [...journey.guides, guide] };
      state.selectedWidget = { type: 'guide', id: guide.id };
      rebuild();
    },
    deleteSelected() {
      const selected = state.selectedWidget;
      if (!selected) return;
      if (selected.type === 'location') {
        journey = { ...journey, locationWaypoints: journey.locationWaypoints.filter((entry) => entry.id !== selected.id) };
      } else if (selected.type === 'camera') {
        journey = { ...journey, cameraLookWaypoints: journey.cameraLookWaypoints.filter((entry) => entry.id !== selected.id) };
      } else {
        journey = { ...journey, guides: journey.guides.filter((entry) => entry.id !== selected.id) };
      }
      state.selectedWidget = null;
      state.selectedLocationRange = null;
      rebuild();
    },
    applyJourney(nextJourney) {
      journey = normalizeTimedJourney(nextJourney);
      rebuild();
    },
    exportDocument() {
      return exportJourneyVideoEditorDocument(document);
    },
    getSnapshot() {
      return {
        disposed,
        journeyId: journey.id,
        title: journey.title,
        durationSecs: journey.durationSecs,
        timeSecs: state.timeSecs,
        playing: state.playing,
        tileModes: [...state.tileModes],
        selectedWidget: state.selectedWidget ? { ...state.selectedWidget } : null,
        selectedLocationRange: state.selectedLocationRange ? { ...state.selectedLocationRange } : null,
        locationWaypointCount: journey.locationWaypoints.length,
        cameraWaypointCount: journey.cameraLookWaypoints.length,
        guideCount: journey.guides.length,
      };
    },
    dispose() {
      disposed = true;
      state.playing = false;
    },
  };

  function assertActive() {
    if (disposed) throw new Error('JourneyVideoEditor has been disposed.');
  }
}

/**
 * @param {Element} host
 * @param {ReturnType<typeof createEditorModel>} model
 * @param {import('./editor.d.ts').CreateJourneyVideoEditorOptions} options
 */
function mountEditor(host, model, options) {
  const doc = host.ownerDocument ?? globalThis.document;
  if (!doc) return null;
  host.classList.add('fis-journey-video-editor-host');
  host.innerHTML = editorMarkup();
  const refs = queryRefs(host);
  /** @type {Map<number, unknown>} */
  const tileStates = new Map();
  /** @type {number | null} */
  let raf = null;
  let lastTick = performance.now();

  refs.play.addEventListener('click', () => {
    if (model.state.playing) model.pause();
    else model.play();
    startLoop();
    renderAll();
  });
  refs.time.addEventListener('input', () => {
    model.setTime(Number(refs.time.value));
    renderAll();
  });
  refs.duration.addEventListener('change', () => {
    model.applyJourney({ ...model.journey, durationSecs: Math.max(0.1, Number(refs.duration.value) || model.journey.durationSecs) });
    renderAll();
  });
  refs.zoom.addEventListener('input', () => {
    model.setZoom(Number(refs.zoom.value));
    renderAll();
  });
  refs.exportJson.addEventListener('click', () => {
    refs.json.value = JSON.stringify(model.getJourney(), null, 2);
  });
  refs.importJson.addEventListener('click', () => {
    try {
      model.setJourney(JSON.parse(refs.json.value));
      renderAll();
    } catch (error) {
      reportError(error);
    }
  });
  refs.downloadJson.addEventListener('click', () => downloadText(doc, `${model.journey.id || 'journey'}.json`, refs.json.value));
  refs.addLocation.addEventListener('click', () => { model.addLocation(); renderAll(); });
  refs.addCamera.addEventListener('click', () => { model.addCamera(); renderAll(); });
  refs.addGuide.addEventListener('click', () => { model.addGuide(); renderAll(); });

  for (const [index, tile] of refs.tiles.entries()) {
    tile.select.addEventListener('change', () => {
      model.setTileMode(index, tile.select.value);
      renderAll();
    });
  }

  renderAll();

  return {
    renderAll,
    startLoop,
    async dispose() {
      if (raf != null) cancelAnimationFrame(raf);
      for (const state of tileStates.values()) await state?.dispose?.();
      host.replaceChildren();
      host.classList.remove('fis-journey-video-editor-host');
    },
  };

  function renderAll() {
    renderSidebar();
    renderTimeline();
    renderInspector();
    renderTiles();
  }

  function renderSidebar() {
    refs.time.max = String(model.journey.durationSecs);
    refs.time.value = String(model.state.timeSecs);
    refs.timeLabel.textContent = `${model.state.timeSecs.toFixed(2)}s`;
    refs.duration.value = String(model.journey.durationSecs);
    refs.zoom.value = String(model.state.zoom);
    refs.zoomLabel.textContent = `${Math.round(model.state.zoom * 100)}%`;
    refs.play.textContent = model.state.playing ? 'Pause' : 'Play';
    refs.json.value = JSON.stringify(model.getJourney(), null, 2);
    refs.stats.time.textContent = `${model.state.timeSecs.toFixed(2)}s`;
    refs.stats.position.textContent = pointText(model.evaluated.observerPc);
    refs.stats.speed.textContent = `${model.evaluated.speedPcPerSec.toFixed(2)} pc/s`;
    refs.stats.velocity.textContent = pointText(model.evaluated.velocityPcPerSec);
    refs.stats.camera.textContent = pointText(model.evaluated.targetPc);
    refs.guideList.replaceChildren(...model.journey.guides.map((guide) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'jve-guide-chip';
      button.textContent = guide.label ?? guide.id;
      button.addEventListener('click', () => {
        model.selectWidget('guide', guide.id);
        renderAll();
      });
      return button;
    }));
  }

  function renderTimeline() {
    refs.locationLane.replaceChildren(...model.journey.locationWaypoints.map((waypoint, index) => createTimelineWidget('location', waypoint, String(index + 1))));
    refs.cameraLane.replaceChildren(...model.journey.cameraLookWaypoints.map((waypoint, index) => createTimelineWidget('camera', waypoint, String(index + 1))));
    refs.playhead.style.left = `${(model.state.timeSecs / Math.max(0.1, model.journey.durationSecs)) * 100}%`;
  }

  function createTimelineWidget(type, waypoint, label) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'jve-timeline-widget';
    button.dataset.widgetType = type;
    const group = waypoint.motionGroup;
    if (group?.role) button.dataset.motionRole = String(group.role);
    if (model.state.selectedWidget?.type === type && model.state.selectedWidget.id === waypoint.id) button.classList.add('is-selected');
    button.style.left = `${(waypoint.timeSecs / Math.max(0.1, model.journey.durationSecs)) * 100}%`;
    button.textContent = label;
    button.addEventListener('click', (event) => {
      model.selectWidget(type, waypoint.id, { extendRange: event.shiftKey });
      renderAll();
    });
    button.addEventListener('pointerdown', (event) => beginTimelineDrag(event, waypoint, button));
    return button;
  }

  function beginTimelineDrag(event, waypoint, button) {
    event.preventDefault();
    const track = button.parentElement;
    const rect = track.getBoundingClientRect();
    const move = (moveEvent) => {
      const percent = clamp((moveEvent.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      waypoint.timeSecs = snapTime(percent * model.journey.durationSecs);
      model.applyJourney(model.journey);
      renderAll();
    };
    const done = () => {
      globalThis.removeEventListener('pointermove', move);
      globalThis.removeEventListener('pointerup', done);
    };
    globalThis.addEventListener('pointermove', move);
    globalThis.addEventListener('pointerup', done, { once: true });
  }

  function renderInspector() {
    refs.inspector.replaceChildren();
    const selected = model.state.selectedWidget;
    const range = selectedLocationRangeInfo();
    if (range) {
      refs.inspector.append(renderRangeInspector(range));
      return;
    }
    if (!selected) {
      refs.inspector.append(paragraph('Select a timeline widget or path marker.'));
      return;
    }
    const widget = findMutableWidget(model.journey, selected.type, selected.id);
    if (!widget) {
      refs.inspector.append(paragraph('Selected widget no longer exists.'));
      return;
    }
    refs.inspector.append(renderWidgetInspector(selected, widget));
  }

  function renderRangeInspector(range) {
    const section = panel('Location range');
    const stats = getJourneyLocationRangeSpeedStats(model.journey.locationWaypoints, range.anchorId, range.focusId);
    section.append(keyValueGrid([
      ['from', range.anchorId],
      ['to', range.focusId],
      ['waypoints', String(stats?.waypointCount ?? 0)],
      ['distance', `${(stats?.totalLengthPc ?? 0).toFixed(2)} pc`],
      ['avg speed', `${(stats?.averageSpeedPcPerSec ?? 0).toFixed(2)} pc/s`],
    ]));
    const row = doc.createElement('div');
    row.className = 'jve-button-row';
    const equalize = button('Equalize speed', () => {
      const result = equalizeJourneyLocationRangeSpeeds(model.journey.locationWaypoints, range.anchorId, range.focusId);
      model.applyJourney({ ...model.journey, locationWaypoints: result.locationWaypoints });
      renderAll();
    });
    const ease = button('Ease start/end', () => {
      const result = easeJourneyLocationRangeStartEnd(model.journey.locationWaypoints, range.anchorId, range.focusId);
      model.applyJourney({ ...model.journey, locationWaypoints: result.locationWaypoints });
      renderAll();
    });
    row.append(equalize, ease);
    section.append(row);
    return section;
  }

  function renderWidgetInspector(selected, widget) {
    const section = panel(`${selected.type} ${widget.id}`);
    section.append(field('Time', numberInput(widget.timeSecs ?? model.state.timeSecs, (value) => {
      widget.timeSecs = snapTime(value);
      model.applyJourney(model.journey);
      renderAll();
    })));
    if (selected.type === 'camera') {
      if (widget.kind !== 'target') {
        widget.kind = 'target';
        widget.targetPc = { ...model.evaluated.targetPc };
      }
      section.append(vectorEditor('Target', widget.targetPc, (point) => {
        widget.targetPc = point;
        model.applyJourney(model.journey);
        renderAll();
      }));
    } else {
      const point = selected.type === 'guide' ? widget.positionPc : widget.positionPc;
      section.append(vectorEditor('Position', point, (nextPoint) => {
        widget.positionPc = nextPoint;
        model.applyJourney(model.journey);
        renderAll();
      }));
    }
    if (selected.type === 'guide') {
      section.append(field('Label', textInput(widget.label, (value) => {
        widget.label = value;
        model.applyJourney(model.journey);
        renderAll();
      })));
      section.append(field('Color', colorInput(widget.color ?? '#8fd5ff', (value) => {
        widget.color = value;
        model.applyJourney(model.journey);
        renderAll();
      })));
    }
    if (selected.type === 'location' && widget.motionGroup?.id) {
      const row = doc.createElement('div');
      row.className = 'jve-button-row';
      row.append(
        button('Select ease group', () => {
          model.state.selectedLocationGroupId = widget.motionGroup.id;
          model.state.selectedLocationGroupPhase = widget.motionGroup.phase === 'start' || widget.motionGroup.phase === 'end' ? widget.motionGroup.phase : null;
          renderAll();
        }),
        button('Rebuild ease', () => {
          const result = rebuildJourneyEaseLocationGroup(model.journey.locationWaypoints, widget.motionGroup.id, { phase: widget.motionGroup.phase });
          model.applyJourney({ ...model.journey, locationWaypoints: result.locationWaypoints });
          renderAll();
        }),
        button('Delete ease helpers', () => {
          const result = deleteJourneyEaseLocationGroupHelpers(model.journey.locationWaypoints, widget.motionGroup.id, { phase: widget.motionGroup.phase });
          model.applyJourney({ ...model.journey, locationWaypoints: result.locationWaypoints });
          renderAll();
        }),
      );
      section.append(row);
    }
    section.append(button('Delete', () => { model.deleteSelected(); renderAll(); }, 'is-danger'));
    return section;
  }

  function renderTiles() {
    for (const [index, tile] of refs.tiles.entries()) {
      const mode = model.state.tileModes[index] ?? 'xy';
      tile.select.value = mode;
      for (const entry of TILE_MODES) {
        if (![...tile.select.options].some((option) => option.value === entry)) {
          const option = doc.createElement('option');
          option.value = entry;
          option.textContent = TILE_LABELS.get(entry) ?? entry;
          tile.select.append(option);
        }
      }
      const current = tileStates.get(index);
      if (current?.mode !== mode) {
        current?.dispose?.();
        tile.body.replaceChildren();
        tileStates.delete(index);
        if (mode === 'perspective') tileStates.set(index, createPerspectiveTile(tile.body));
        else if (mode === 'skykit') tileStates.set(index, createSkykitTile(tile.body, options.preview));
        else tileStates.set(index, createProjectionTile(tile.body, mode));
      }
      tileStates.get(index)?.render?.();
    }
  }

  function createProjectionTile(body, mode) {
    const canvas = doc.createElement('canvas');
    canvas.className = 'jve-tile-canvas';
    body.append(canvas);
    let markers = [];
    canvas.addEventListener('click', (event) => {
      const point = canvasPoint(canvas, event.clientX, event.clientY);
      const marker = hitJourneyEditorMarker(markers, point.x, point.y);
      if (marker) {
        model.selectWidget(marker.type, marker.id, { extendRange: event.shiftKey });
        renderAll();
      }
    });
    canvas.addEventListener('pointerdown', (event) => {
      const point = canvasPoint(canvas, event.clientX, event.clientY);
      const marker = hitJourneyEditorMarker(markers, point.x, point.y);
      if (!marker) return;
      model.selectWidget(marker.type, marker.id, { extendRange: event.shiftKey });
      const projection = markers.projection;
      const move = (moveEvent) => {
        const canvasPos = canvasPoint(canvas, moveEvent.clientX, moveEvent.clientY);
        const [axisA, axisB] = projection.axes;
        const currentPoint = widgetPoint(model.journey, marker.type, marker.id);
        if (!currentPoint) return;
        const next = { ...currentPoint };
        next[axisA] = projection.centerA + (canvasPos.x - projection.width / 2) / projection.scale;
        next[axisB] = projection.centerB - (canvasPos.y - projection.height / 2) / projection.scale;
        model.updateSelectedPoint(next);
        renderAll();
      };
      const done = () => {
        globalThis.removeEventListener('pointermove', move);
        globalThis.removeEventListener('pointerup', done);
      };
      globalThis.addEventListener('pointermove', move);
      globalThis.addEventListener('pointerup', done, { once: true });
    });
    return {
      mode,
      render() {
        const { width, height, context } = syncCanvas(canvas);
        const data = createJourneyEditorProjectionData(model.journey, { sampleStepSecs: SAMPLE_STEP_SECS });
        const projection = createJourneyProjectionTransform({
          mode,
          bounds: data.bounds,
          width,
          height,
          zoom: model.state.zoom,
          center: model.evaluated.observerPc,
        });
        markers = drawProjection(context, data, projection);
        markers.projection = projection;
      },
      dispose() {
        canvas.remove();
      },
    };
  }

  function createPerspectiveTile(body) {
    const canvas = doc.createElement('canvas');
    canvas.className = 'jve-tile-canvas';
    body.append(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100000);
    const controls = new OrbitControls(camera, canvas);
    const root = new THREE.Group();
    scene.add(root);
    scene.background = new THREE.Color(0x02050b);
    return {
      mode: 'perspective',
      render() {
        const { width, height } = syncCanvas(canvas);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        root.clear();
        const bounds = computeJourneyBounds(model.journey, model.samples);
        const center = vector3(model.evaluated.observerPc);
        const distance = Math.max(30, bounds.span / Math.max(0.2, model.state.zoom));
        camera.position.copy(center).add(new THREE.Vector3(distance, distance * 0.6, distance));
        controls.target.copy(center);
        controls.update();
        addPerspectiveContent(root);
        renderer.render(scene, camera);
      },
      dispose() {
        renderer.dispose();
        controls.dispose();
        canvas.remove();
      },
    };
  }

  function createSkykitTile(body, preview = {}) {
    const shell = doc.createElement('div');
    shell.className = 'jve-skykit-tile';
    body.append(shell);
    const guideGroup = new THREE.Group();
    guideGroup.name = 'journey-video-editor-guides';
    let disposed = false;
    let ready = false;
    let viewer = null;
    let loop = null;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    const camera = new THREE.PerspectiveCamera(60, 1, 0.001, 10000);
    const provider = createStarOctreeProviderService({ url: preview.octreeUrl ?? OCTREE_DEFAULT });
    const starField = createThreeStarField({ renderScale: preview.renderScale ?? 0.02 });
    createSkykitViewer({
      host: shell,
      renderer,
      camera,
      view: { coordinateUnitsPerParsec: preview.coordinateUnitsPerParsec ?? 0.02 },
      plugins: [
        createStreamingStarsPlugin({
          provider,
          renderer: starField,
          session: { strategy: createObserverShellStrategy() },
        }),
        createObject3dPlugin({ id: 'journey-guides', object3d: guideGroup }),
      ],
    }).then((created) => {
      if (disposed) {
        void created.dispose();
        return;
      }
      viewer = created;
      loop = createSkykitAnimationLoop(viewer, { render: true });
      loop.start();
      ready = true;
      applySkykitState();
    }).catch(reportError);
    return {
      mode: 'skykit',
      render() {
        if (ready) applySkykitState();
      },
      async dispose() {
        disposed = true;
        loop?.dispose?.();
        await viewer?.dispose?.();
        provider.dispose?.();
        renderer.dispose?.();
        shell.remove();
      },
    };

    function applySkykitState() {
      if (!viewer) return;
      updateGuideMeshes(guideGroup);
      viewer.requestViewState({
        observerPc: model.evaluated.observerPc,
        orientationIcrs: model.evaluated.orientationIcrs,
        targetPc: model.evaluated.targetPc,
        limitingMagnitude: preview.limitingMagnitude ?? 6.5,
      }, 'journey-video-editor');
      viewer.resize();
    }
  }

  function startLoop() {
    if (raf != null) return;
    lastTick = performance.now();
    const tick = (now) => {
      raf = null;
      const delta = Math.min(0.1, (now - lastTick) / 1000);
      lastTick = now;
      if (model.state.playing) {
        model.tick(delta);
        renderAll();
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
  }

  function selectedLocationRangeInfo() {
    const range = model.state.selectedLocationRange;
    if (!range) return null;
    const ids = new Set(model.journey.locationWaypoints.map((waypoint) => waypoint.id));
    return ids.has(range.anchorId) && ids.has(range.focusId) ? range : null;
  }

  function reportError(error) {
    options.onError?.(error);
    refs.status.textContent = error instanceof Error ? error.message : String(error);
  }

  function drawProjection(context, data, projection) {
    const width = projection.width;
    const height = projection.height;
    const markers = [];
    context.fillStyle = '#02050b';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(91, 231, 196, 0.14)';
    context.lineWidth = 1;
    for (let index = -16; index <= 16; index += 1) {
      context.beginPath();
      context.moveTo(width / 2 + index * 44 * model.state.zoom, 0);
      context.lineTo(width / 2 + index * 44 * model.state.zoom, height);
      context.moveTo(0, height / 2 + index * 44 * model.state.zoom);
      context.lineTo(width, height / 2 + index * 44 * model.state.zoom);
      context.stroke();
    }
    context.strokeStyle = '#f2f6ff';
    context.lineWidth = 2;
    context.beginPath();
    for (const [index, sample] of data.samples.entries()) {
      const point = projectJourneyEditorPoint(sample.observerPc, projection);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.stroke();
    for (const guide of model.journey.guides) {
      const point = projectJourneyEditorPoint(guide.positionPc, projection);
      context.strokeStyle = guide.color ?? '#8fd5ff';
      context.lineWidth = isSelected('guide', guide.id) ? 3 : 1.5;
      context.beginPath();
      context.arc(point.x, point.y, Math.max(4, Number(guide.radiusPc ?? 1) * projection.scale), 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = guide.color ?? '#8fd5ff';
      context.fillText(guide.label ?? guide.id, point.x + 7, point.y - 7);
      markers.push({ type: 'guide', id: guide.id, x: point.x, y: point.y, radius: 12 });
    }
    for (const waypoint of model.journey.locationWaypoints) {
      const point = projectJourneyEditorPoint(waypoint.positionPc, projection);
      context.fillStyle = isSelected('location', waypoint.id) ? '#ffb454' : waypoint.motionGroup?.role === 'helper' ? '#5be7c4' : '#f2f6ff';
      context.beginPath();
      context.arc(point.x, point.y, waypoint.motionGroup?.role === 'helper' ? 4 : 6, 0, Math.PI * 2);
      context.fill();
      markers.push({ type: 'location', id: waypoint.id, x: point.x, y: point.y, radius: 11 });
    }
    for (const waypoint of model.journey.cameraLookWaypoints) {
      if (waypoint.kind !== 'target') continue;
      const point = projectJourneyEditorPoint(waypoint.targetPc, projection);
      context.strokeStyle = isSelected('camera', waypoint.id) ? '#ffb454' : '#5ddcff';
      context.beginPath();
      context.arc(point.x, point.y, 8, 0, Math.PI * 2);
      context.stroke();
      markers.push({ type: 'camera', id: waypoint.id, x: point.x, y: point.y, radius: 12 });
    }
    const current = projectJourneyEditorPoint(model.evaluated.observerPc, projection);
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(current.x, current.y, 5, 0, Math.PI * 2);
    context.fill();
    return markers;
  }

  function addPerspectiveContent(root) {
    for (const sample of model.samples) {
      const point = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xf2f6ff }),
      );
      point.position.copy(vector3(sample.observerPc));
      root.add(point);
    }
    updateGuideMeshes(root, false);
    for (const waypoint of model.journey.locationWaypoints) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 16, 8),
        new THREE.MeshBasicMaterial({ color: isSelected('location', waypoint.id) ? 0xffb454 : 0x5be7c4 }),
      );
      mesh.position.copy(vector3(waypoint.positionPc));
      root.add(mesh);
    }
  }

  function updateGuideMeshes(group, clear = true) {
    if (clear) {
      for (const child of [...group.children]) {
        group.remove(child);
        disposeObject3d(child);
      }
    }
    for (const guide of model.journey.guides) {
      const material = new THREE.MeshBasicMaterial({
        color: colorNumber(guide.color),
        transparent: true,
        opacity: clamp(Number(guide.opacity ?? 0.45), 0, 1),
        wireframe: Number(guide.opacity ?? 0.45) < 0.3,
      });
      const geometry = guide.shape === 'cube'
        ? new THREE.BoxGeometry(Number(guide.sizePc ?? guide.radiusPc ?? 1), Number(guide.sizePc ?? guide.radiusPc ?? 1), Number(guide.sizePc ?? guide.radiusPc ?? 1))
        : new THREE.SphereGeometry(Number(guide.radiusPc ?? guide.sizePc ?? 1), 32, 16);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(vector3(guide.positionPc));
      group.add(mesh);
    }
  }

  function isSelected(type, id) {
    return model.state.selectedWidget?.type === type && model.state.selectedWidget.id === id;
  }

  function field(label, input) {
    const wrapper = doc.createElement('label');
    wrapper.append(span(label), input);
    return wrapper;
  }

  function vectorEditor(label, point, onChange) {
    const grid = doc.createElement('div');
    grid.className = 'jve-vector-grid';
    grid.append(span(label));
    for (const axis of ['x', 'y', 'z']) {
      grid.append(numberInput(point?.[axis] ?? 0, (value) => {
        onChange({ ...point, [axis]: value });
      }));
    }
    return grid;
  }

  function numberInput(value, onChange) {
    const input = doc.createElement('input');
    input.type = 'number';
    input.step = '0.05';
    input.value = formatNumber(value);
    input.addEventListener('change', () => onChange(Number(input.value)));
    return input;
  }

  function textInput(value, onChange) {
    const input = doc.createElement('input');
    input.value = String(value ?? '');
    input.addEventListener('change', () => onChange(input.value));
    return input;
  }

  function colorInput(value, onChange) {
    const input = doc.createElement('input');
    input.type = 'color';
    input.value = /^#[0-9a-f]{6}$/iu.test(String(value)) ? String(value) : '#8fd5ff';
    input.addEventListener('input', () => onChange(input.value));
    return input;
  }

  function button(label, onClick, className = '') {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (className) button.className = className;
    button.addEventListener('click', onClick);
    return button;
  }

  function panel(title) {
    const section = doc.createElement('section');
    const heading = doc.createElement('h2');
    heading.textContent = title;
    section.append(heading);
    return section;
  }

  function paragraph(text) {
    const p = doc.createElement('p');
    p.textContent = text;
    return p;
  }

  function span(text) {
    const value = doc.createElement('span');
    value.textContent = text;
    return value;
  }

  function keyValueGrid(rows) {
    const grid = doc.createElement('dl');
    grid.className = 'jve-key-value-grid';
    for (const [key, value] of rows) {
      const dt = doc.createElement('dt');
      const dd = doc.createElement('dd');
      dt.textContent = key;
      dd.textContent = value;
      grid.append(dt, dd);
    }
    return grid;
  }
}

function editorMarkup() {
  return `
    <div class="jve-shell">
      <aside class="jve-sidebar">
        <h1>Journey Video Editor</h1>
        <dl class="jve-stats">
          <dt>Time</dt><dd data-stat="time">0.00s</dd>
          <dt>Position</dt><dd data-stat="position">-</dd>
          <dt>Speed</dt><dd data-stat="speed">-</dd>
          <dt>Velocity</dt><dd data-stat="velocity">-</dd>
          <dt>Camera</dt><dd data-stat="camera">-</dd>
        </dl>
        <label>Duration <input data-duration type="number" min="0.1" step="0.1"></label>
        <div class="jve-button-row">
          <button data-export-json type="button">Export JSON</button>
          <button data-import-json type="button">Import JSON</button>
          <button data-download-json type="button">Download</button>
        </div>
        <textarea data-json spellcheck="false"></textarea>
        <div class="jve-button-row">
          <button data-add-location type="button">Add Location</button>
          <button data-add-camera type="button">Add Camera</button>
          <button data-add-guide type="button">Add Guide</button>
        </div>
        <div data-guide-list class="jve-guide-list"></div>
        <section data-inspector class="jve-inspector"></section>
        <p data-status class="jve-status"></p>
      </aside>
      <main class="jve-main">
        <div class="jve-view-toolbar">
          <label>Zoom <input data-zoom type="range" min="0.35" max="50" step="0.05"><span data-zoom-label>100%</span></label>
        </div>
        <section class="jve-tile-grid">
          ${[0, 1, 2, 3].map((index) => `
            <div class="jve-tile" data-tile="${index}">
              <div class="jve-tile-toolbar"><select data-tile-mode></select></div>
              <div class="jve-tile-body" data-tile-body></div>
            </div>
          `).join('')}
        </section>
        <section class="jve-bottom-panel">
          <div class="jve-transport"><button data-play type="button">Play</button><span data-time-label>0.00s</span></div>
          <div class="jve-timeline">
            <div data-playhead class="jve-playhead"></div>
            <div class="jve-lane"><span>Time</span><div class="jve-lane-track"><input data-time type="range" min="0" step="0.05"></div></div>
            <div class="jve-lane"><span>Loc</span><div class="jve-lane-track" data-lane-track="location"></div></div>
            <div class="jve-lane"><span>Cam</span><div class="jve-lane-track" data-lane-track="camera"></div></div>
          </div>
        </section>
      </main>
    </div>
  `;
}

/** @param {Element} host */
function queryRefs(host) {
  return {
    play: must(host, '[data-play]'),
    time: must(host, '[data-time]'),
    timeLabel: must(host, '[data-time-label]'),
    duration: must(host, '[data-duration]'),
    zoom: must(host, '[data-zoom]'),
    zoomLabel: must(host, '[data-zoom-label]'),
    exportJson: must(host, '[data-export-json]'),
    importJson: must(host, '[data-import-json]'),
    downloadJson: must(host, '[data-download-json]'),
    json: must(host, '[data-json]'),
    addLocation: must(host, '[data-add-location]'),
    addCamera: must(host, '[data-add-camera]'),
    addGuide: must(host, '[data-add-guide]'),
    guideList: must(host, '[data-guide-list]'),
    inspector: must(host, '[data-inspector]'),
    status: must(host, '[data-status]'),
    playhead: must(host, '[data-playhead]'),
    locationLane: must(host, '[data-lane-track="location"]'),
    cameraLane: must(host, '[data-lane-track="camera"]'),
    stats: {
      time: must(host, '[data-stat="time"]'),
      position: must(host, '[data-stat="position"]'),
      speed: must(host, '[data-stat="speed"]'),
      velocity: must(host, '[data-stat="velocity"]'),
      camera: must(host, '[data-stat="camera"]'),
    },
    tiles: [...host.querySelectorAll('[data-tile]')].map((tile) => ({
      el: tile,
      select: must(tile, '[data-tile-mode]'),
      body: must(tile, '[data-tile-body]'),
    })),
  };
}

function must(root, selector) {
  const value = root.querySelector(selector);
  if (!value) throw new Error(`Journey video editor markup missing ${selector}.`);
  return value;
}

function findWidget(journey, type, id) {
  return findMutableWidget(journey, type, id) ? { type, id } : null;
}

function findMutableWidget(journey, type, id) {
  if (type === 'location') return journey.locationWaypoints.find((entry) => entry.id === id) ?? null;
  if (type === 'camera') return journey.cameraLookWaypoints.find((entry) => entry.id === id) ?? null;
  if (type === 'guide') return journey.guides.find((entry) => entry.id === id) ?? null;
  return null;
}

function widgetPoint(journey, type, id) {
  const widget = findMutableWidget(journey, type, id);
  if (!widget) return null;
  if (type === 'camera') return widget.kind === 'target' ? widget.targetPc : null;
  return widget.positionPc;
}

function sortByTime(entries) {
  return [...entries].sort((left, right) => Number(left.timeSecs ?? 0) - Number(right.timeSecs ?? 0) || String(left.id).localeCompare(String(right.id)));
}

function nextId(entries, prefix) {
  const ids = new Set(entries.map((entry) => entry.id));
  let index = entries.length + 1;
  while (ids.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function syncCanvas(canvas) {
  const scale = Math.min(globalThis.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor((canvas.clientWidth || 1) * scale));
  const height = Math.max(1, Math.floor((canvas.clientHeight || 1) * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, scale, context: canvas.getContext('2d') };
}

function canvasPoint(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (canvas.width / Math.max(1, rect.width)),
    y: (clientY - rect.top) * (canvas.height / Math.max(1, rect.height)),
  };
}

function vector3(point) {
  return new THREE.Vector3(Number(point?.x ?? 0), Number(point?.y ?? 0), Number(point?.z ?? 0));
}

function pointText(point) {
  return `${formatNumber(point?.x)} ${formatNumber(point?.y)} ${formatNumber(point?.z)}`;
}

function formatNumber(value) {
  return Number(value ?? 0).toFixed(3).replace(/\.?0+$/u, '');
}

function snapTime(value) {
  return Math.round((Number(value) || 0) / TIMELINE_STEP_SECS) * TIMELINE_STEP_SECS;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
}

function colorNumber(value, fallback = 0x8fd5ff) {
  const text = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/iu.test(text) ? Number.parseInt(text.slice(1), 16) : fallback;
}

function disposeObject3d(object) {
  object.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      for (const material of child.material) material.dispose?.();
    } else {
      child.material?.dispose?.();
    }
  });
}

function downloadText(doc, filename, text) {
  const blob = new Blob([`${text.trim()}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
