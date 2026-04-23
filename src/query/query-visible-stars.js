import {
  decodeSelectedStars,
  emitQueryEvent,
  normalizePoint,
  resolveDatasetSession,
  resolveVisibleSelection,
} from './shared.js';

export async function queryVisibleStars(dataset, options = {}) {
  const session = resolveDatasetSession(dataset);
  const observerPc = normalizePoint(options.observerPc, { x: 0, y: 0, z: 0 });
  const targetPc = normalizePoint(options.targetPc, null);

  emitQueryEvent(dataset, {
    type: 'query/started',
    query: 'visible-stars',
    observerPc,
    targetPc,
  });

  const { strategy, selection } = await resolveVisibleSelection(session, {
    ...options,
    observerPc,
    targetPc,
  });
  const nodes = Array.isArray(selection?.nodes)
    ? selection.nodes.filter((node) => node && node.payloadLength > 0)
    : [];
  const bootstrap = await session.ensureRenderBootstrap();
  const stars = await decodeSelectedStars(session, nodes, {
    ...options,
    observerPc,
    bootstrap,
  });

  const result = {
    kind: 'visible-stars',
    strategy,
    observerPc,
    targetPc,
    selection,
    stats: selection?.meta ?? {},
    stars,
  };

  emitQueryEvent(dataset, {
    type: 'query/completed',
    query: 'visible-stars',
    strategy,
    observerPc,
    targetPc,
    starCount: stars.length,
  });

  return result;
}
