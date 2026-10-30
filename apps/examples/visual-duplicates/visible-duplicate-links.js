import { createVisualDuplicatesProvider } from './visual-duplicates-provider.js';

const MAX_CONCURRENT_CELL_DECODES = 4;
const VISUAL_DUPLICATE_ROLE_ATTRIBUTE = 'visual_duplicate_role';
const ROLE_GAIA = 1;
const ROLE_HIP = 2;
const STATUS_UPDATE_INTERVAL_MS = 500;

export function createVisibleDuplicateLinksExtension(options) {
  const sidecar = createVisualDuplicatesProvider({
    url: options.sidecarUrl,
    parentDatasetId: options.context.datasetId,
  });

  return {
    plugin: createVisualDuplicateRolePlugin({ ...options, sidecar }),
  };
}

function createVisualDuplicateRolePlugin(options) {
  const id = 'visual-duplicate-role-buffer';
  const activeCells = new Map();
  const pendingCells = new Map();
  const inFlightCells = new Set();
  const cellGenerations = new Map();
  const roleCountsByCell = new Map();
  const roleMasksByCell = new Map();
  let annotatedCells = null;
  let unsubscribe = null;
  let disposed = false;
  let gaiaCount = 0;
  let hipCount = 0;
  let statusTimeout = null;

  return {
    id,
    setup() {
      unsubscribe = options.context.source.subscribe(handleDelta, { replay: true });
      void initializeSidecar();
      return dispose;
    },
  };

  async function initializeSidecar() {
    options.onState?.({ state: 'loading', message: 'Loading duplicate sidecar' });
    try {
      const header = await options.sidecar.ensureHeader();
      const cells = await options.sidecar.listAnnotatedCells();
      if (disposed) return;
      annotatedCells = cells;
      options.onState?.({
        state: 'ready',
        message: `${cells.size.toLocaleString()} role-bearing cells indexed`,
        sidecarId: header.sidecarUuid,
      });
      for (const cell of activeCells.values()) queueCell(cell);
    } catch (error) {
      publishError(error);
    }
  }

  function handleDelta(delta) {
    if (disposed) return;
    if (delta.type === 'stars/cells-upsert') {
      for (const cell of delta.cells) {
        activeCells.set(cell.cellKey, cell);
        cellGenerations.set(cell.cellKey, (cellGenerations.get(cell.cellKey) ?? 0) + 1);
        if (annotatedCells) queueCell(cell);
      }
      return;
    }
    if (delta.type === 'stars/cells-remove') {
      for (const cellKey of delta.cellKeys) removeCell(cellKey);
      return;
    }
    if (delta.type === 'stars/error') {
      publishError(delta.error?.message ?? 'Star stream failed');
    }
  }

  function queueCell(cell) {
    if (!annotatedCells?.has(cell.cellKey)) return;
    pendingCells.set(cell.cellKey, cell);
    pumpCellQueue();
  }

  function pumpCellQueue() {
    while (!disposed && inFlightCells.size < MAX_CONCURRENT_CELL_DECODES) {
      let next = null;
      for (const candidate of pendingCells.entries()) {
        if (!inFlightCells.has(candidate[0])) {
          next = candidate;
          break;
        }
      }
      if (!next) return;
      const [cellKey, cell] = next;
      pendingCells.delete(cellKey);
      if (activeCells.get(cellKey) !== cell) continue;
      const generation = cellGenerations.get(cellKey);
      inFlightCells.add(cellKey);
      void decorateCell(cell, generation).finally(() => {
        inFlightCells.delete(cellKey);
        pumpCellQueue();
      });
    }
  }

  async function decorateCell(cell, generation) {
    try {
      let roleMask = roleMasksByCell.get(cell.cellKey);
      if (!roleMask || roleMask.roles.length !== cell.count) {
        const records = await options.sidecar.getDuplicatesCell({
          datasetId: options.context.datasetId,
          level: cell.cell.level,
          mortonCode: cell.cell.mortonCode,
        });
        roleMask = createRoleMask(cell.count, records);
        roleMasksByCell.set(cell.cellKey, roleMask);
      }
      if (
        disposed ||
        activeCells.get(cell.cellKey) !== cell ||
        cellGenerations.get(cell.cellKey) !== generation
      ) {
        return;
      }

      if (!options.context.starField.setCellVertexAttribute(
        cell.cellKey,
        VISUAL_DUPLICATE_ROLE_ATTRIBUTE,
        roleMask.roles,
      )) {
        return;
      }
      replaceCellRoleCounts(cell.cellKey, roleMask.gaia, roleMask.hip);
      publishCounts();
    } catch (error) {
      if (cellGenerations.get(cell.cellKey) !== generation) return;
      publishError(error);
    }
  }

  function replaceCellRoleCounts(cellKey, nextGaiaCount, nextHipCount) {
    const previous = roleCountsByCell.get(cellKey);
    gaiaCount -= previous?.gaia ?? 0;
    hipCount -= previous?.hip ?? 0;
    gaiaCount += nextGaiaCount;
    hipCount += nextHipCount;
    roleCountsByCell.set(cellKey, { gaia: nextGaiaCount, hip: nextHipCount });
  }

  function removeCell(cellKey) {
    activeCells.delete(cellKey);
    pendingCells.delete(cellKey);
    cellGenerations.set(cellKey, (cellGenerations.get(cellKey) ?? 0) + 1);
    const previous = roleCountsByCell.get(cellKey);
    if (previous) {
      gaiaCount -= previous.gaia;
      hipCount -= previous.hip;
      roleCountsByCell.delete(cellKey);
      publishCounts();
    }
    roleMasksByCell.delete(cellKey);
  }

  function publishCounts() {
    if (statusTimeout || disposed) return;
    statusTimeout = setTimeout(() => {
      statusTimeout = null;
      if (disposed) return;
      options.onState?.({
        state: 'ready',
        message: `${gaiaCount.toLocaleString()} Gaia · ${hipCount.toLocaleString()} HIP shining`,
        gaiaCount,
        hipCount,
      });
    }, STATUS_UPDATE_INTERVAL_MS);
  }

  function publishError(error) {
    if (disposed) return;
    options.onState?.({
      state: 'failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (statusTimeout) clearTimeout(statusTimeout);
    statusTimeout = null;
    unsubscribe?.();
    unsubscribe = null;
    options.sidecar.dispose?.();
    activeCells.clear();
    pendingCells.clear();
    inFlightCells.clear();
    cellGenerations.clear();
    roleCountsByCell.clear();
    roleMasksByCell.clear();
  }
}

function createRoleMask(count, records) {
  const roles = new Uint8Array(count);
  let gaia = 0;
  let hip = 0;
  for (const record of records ?? []) {
    const ordinal = Number(record.ordinal);
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= count) continue;
    if (record.role === 'gaia') {
      if (roles[ordinal] !== ROLE_GAIA) gaia += 1;
      roles[ordinal] = ROLE_GAIA;
    } else if (record.role === 'hip') {
      if (roles[ordinal] !== ROLE_HIP) hip += 1;
      roles[ordinal] = ROLE_HIP;
    }
  }
  return { gaia, hip, roles };
}
