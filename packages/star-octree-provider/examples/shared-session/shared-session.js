import {
  OCTREE_DEFAULT,
  createObserverShellStrategy,
  createSphereVolumeStrategy,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';

const provider = createStarOctreeProviderService({ url: OCTREE_DEFAULT });
const status = document.querySelector('[data-status]');
const providerOutput = document.querySelector('[data-provider]');

document.querySelector('[data-run]').addEventListener('click', run);

async function run() {
  status.textContent = 'streaming...';
  const sessionA = provider.createSession({
    id: 'lesson-visible-stars',
    strategy: createObserverShellStrategy(),
    attributes: ['position', 'magAbs', 'teffLog8'],
  });
  const sessionB = provider.createSession({
    id: 'lesson-volume-stars',
    strategy: createSphereVolumeStrategy({ centerPc: { x: 8, y: 0, z: -10 }, radiusPc: 8 }),
    attributes: ['position', 'magAbs', 'teffLog8'],
  });

  const [a, b] = await Promise.all([
    collect(sessionA, { observerPc: { x: 0, y: 0, z: 0 }, limitingMagnitude: 4.5 }),
    collect(sessionB, {}),
  ]);

  document.querySelector('[data-a]').textContent = JSON.stringify(a, null, 2);
  document.querySelector('[data-b]').textContent = JSON.stringify(b, null, 2);
  providerOutput.textContent = JSON.stringify(provider.getSnapshot(), null, 2);
  status.textContent = 'current';
  sessionA.dispose();
  sessionB.dispose();
}

async function collect(session, view) {
  const summary = { sessionId: session.id, products: 0, stars: 0, current: false };
  const iterator = session.deltas();
  session.updateView(view, { reason: 'shared-session-lesson' });

  for await (const delta of iterator) {
    if (delta.type === 'data/product-upsert') {
      summary.products += 1;
      summary.stars += delta.product.count;
    }
    if (delta.type === 'data/product-error') {
      throw new Error(delta.error?.message ?? 'Session failed.');
    }
    if (delta.type === 'data/representation-current') {
      summary.current = true;
      break;
    }
  }
  return { ...summary, snapshot: session.getSnapshot() };
}
