let nextId = 0;

/**
 * @param {{ id?: string, lanes?: readonly string[], signal?: AbortSignal,
 * onCancel?: (status: 'cancelled' | 'superseded') => void }} [options]
 * @returns {import('./operations.d.ts').OperationControl}
 */
export function createJourneyOperation(options = {}) {
  const id = options.id ?? `operation-${++nextId}`;
  const abortController = new AbortController();
  let settled = false;
  /** @type {(result: import('./operations.d.ts').OperationResult) => void} */
  let resolve;
  const finished = new Promise((done) => { resolve = done; });
  const externalAbort = () => abort();
  /** @param {import('./operations.d.ts').OperationStatus} status @param {unknown} [error] */
  function settle(status, error) {
    if (settled) return;
    settled = true;
    options.signal?.removeEventListener('abort', externalAbort);
    resolve({ id, status, ...(error === undefined ? {} : { error }) });
  }
  /** @param {'cancelled' | 'superseded'} [status] */
  function abort(status = 'cancelled') {
    if (settled || abortController.signal.aborted) return;
    abortController.abort(status);
    try { options.onCancel?.(status); }
    catch (error) { settle('failed', error); return; }
    settle(status);
  }
  const operation = Object.freeze({ id, lanes: Object.freeze([...(options.lanes ?? [])]), finished, cancel: () => abort() });
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', externalAbort, { once: true });
  return { operation, signal: abortController.signal, get settled() { return settled; }, settle, abort };
}
