import * as THREE from 'three';
import { loadConstellationArtManifest } from '../constellations/constellation-art.js';
import { buildConstellationDirectionResolver, toRaDec } from '../constellations/constellation-direction-resolver.js';

function identitySceneToIcrsTransform(x, y, z) {
  return [x, y, z];
}

function normalizeHysteresis(value, fallback = 0.5) {
  if (value === null) {
    return null;
  }
  return Number.isFinite(value) && value >= 0 ? Number(value) : fallback;
}

function cloneDirection(direction) {
  if (!Array.isArray(direction) || direction.length !== 3) {
    return null;
  }
  return [direction[0], direction[1], direction[2]];
}

export function createConstellationCompassController(options = {}) {
  const id = options.id ?? 'constellation-compass-controller';
  const sceneToIcrsTransform = typeof options.sceneToIcrsTransform === 'function'
    ? options.sceneToIcrsTransform
    : identitySceneToIcrsTransform;
  let hysteresisSecs = normalizeHysteresis(options.hysteresisSecs, 0.5);
  const onConstellationIn = typeof options.onConstellationIn === 'function'
    ? options.onConstellationIn
    : () => {};
  const onConstellationOut = typeof options.onConstellationOut === 'function'
    ? options.onConstellationOut
    : () => {};

  let resolver = null;
  let committed = null;
  let candidate = null;
  let candidateHeldSecs = 0;
  let lastFrameTimeMs = null;

  let stats = {
    activeIau: null,
    candidateIau: null,
    viewIcrsDir: null,
    raDeg: null,
    raHours: null,
    decDeg: null,
  };

  const _forward = new THREE.Vector3();

  function commit(nextResolved, raDec, state) {
    const previous = committed;
    if (previous?.iau && previous.iau !== nextResolved?.iau) {
      onConstellationOut({
        iau: previous.iau,
        id: previous.id ?? null,
      });
    }

    if (nextResolved?.iau && previous?.iau !== nextResolved.iau) {
      onConstellationIn({
        iau: nextResolved.iau,
        id: nextResolved.id ?? null,
        name: nextResolved.name ?? null,
        raDeg: raDec?.raDeg ?? null,
        raHours: raDec?.raHours ?? null,
        decDeg: raDec?.decDeg ?? null,
      });
    }

    committed = nextResolved
      ? {
        iau: nextResolved.iau ?? null,
        id: nextResolved.id ?? null,
        name: nextResolved.name ?? null,
      }
      : null;
    if (state && typeof state === 'object') {
      state.activeConstellationIau = committed?.iau ?? null;
    }
  }

  function resolveDeltaSeconds(frame) {
    if (Number.isFinite(frame?.deltaSeconds) && frame.deltaSeconds >= 0) {
      return Number(frame.deltaSeconds);
    }

    if (!Number.isFinite(frame?.timeMs)) {
      return 0;
    }

    if (!Number.isFinite(lastFrameTimeMs)) {
      lastFrameTimeMs = Number(frame.timeMs);
      return 0;
    }

    const deltaSeconds = Math.max(0, (Number(frame.timeMs) - lastFrameTimeMs) / 1000);
    lastFrameTimeMs = Number(frame.timeMs);
    return deltaSeconds;
  }

  return {
    id,
    async attach(context) {
      const manifest = await loadConstellationArtManifest({
        manifest: options.manifest,
        manifestUrl: options.manifestUrl,
        fetchImpl: options.fetchImpl,
      });
      resolver = buildConstellationDirectionResolver(manifest);
      if (context?.state && typeof context.state === 'object') {
        context.state.activeConstellationIau = null;
      }
    },
    update(context) {
      if (!resolver) {
        return;
      }

      const deltaSeconds = resolveDeltaSeconds(context?.frame);
      const sceneForward = context?.camera?.getWorldDirection?.(_forward);
      if (!sceneForward) {
        return;
      }

      const [ix, iy, iz] = sceneToIcrsTransform(sceneForward.x, sceneForward.y, sceneForward.z);
      const resolved = resolver.resolve([ix, iy, iz], committed?.iau ?? null);
      const raDec = toRaDec([ix, iy, iz]);

      stats = {
        ...stats,
        viewIcrsDir: cloneDirection([ix, iy, iz]),
        raDeg: raDec?.raDeg ?? null,
        raHours: raDec?.raHours ?? null,
        decDeg: raDec?.decDeg ?? null,
      };

      if (hysteresisSecs === null && committed) {
        stats = {
          ...stats,
          candidateIau: null,
          activeIau: committed?.iau ?? null,
        };
        return;
      }

      const resolvedIau = resolved?.iau ?? null;
      const activeIau = committed?.iau ?? null;

      if (resolvedIau === activeIau) {
        candidate = null;
        candidateHeldSecs = 0;
        stats = {
          ...stats,
          candidateIau: null,
          activeIau,
        };
        if (context?.state && typeof context.state === 'object') {
          context.state.activeConstellationIau = activeIau;
        }
        return;
      }

      if (hysteresisSecs === 0) {
        commit(resolved, raDec, context?.state);
        candidate = null;
        candidateHeldSecs = 0;
        stats = {
          ...stats,
          candidateIau: null,
          activeIau: committed?.iau ?? null,
        };
        return;
      }

      if ((candidate?.iau ?? null) !== resolvedIau) {
        candidate = resolved
          ? { iau: resolved.iau ?? null, id: resolved.id ?? null }
          : null;
        candidateHeldSecs = deltaSeconds;
      } else {
        candidateHeldSecs += deltaSeconds;
      }

      if (candidateHeldSecs >= hysteresisSecs) {
        commit(resolved, raDec, context?.state);
        candidate = null;
        candidateHeldSecs = 0;
      }

      stats = {
        ...stats,
        candidateIau: candidate?.iau ?? null,
        activeIau: committed?.iau ?? null,
      };
    },
    setHysteresisSecs(value) {
      hysteresisSecs = normalizeHysteresis(value, hysteresisSecs ?? 0.5);
      candidate = null;
      candidateHeldSecs = 0;
    },
    dispose() {
      resolver = null;
      committed = null;
      candidate = null;
      candidateHeldSecs = 0;
      lastFrameTimeMs = null;
      stats = {
        activeIau: null,
        candidateIau: null,
        viewIcrsDir: null,
        raDeg: null,
        raHours: null,
        decDeg: null,
      };
    },
    getStats() {
      return {
        ...stats,
        viewIcrsDir: cloneDirection(stats.viewIcrsDir),
      };
    },
    getConfig() {
      return {
        hysteresisSecs,
      };
    },
  };
}
