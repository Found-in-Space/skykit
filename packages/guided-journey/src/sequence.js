import { createJourneyOperation } from './operations.js';

/**
 * @template Value
 * @param {{ sequence: import('./sequence.d.ts').JourneySequence<Value>, participant?: import('./sequence.d.ts').SequenceParticipant<Value>, timeSecs?: number, rate?: number }} options
 * @returns {import('./sequence.d.ts').JourneySequencePlayer<Value>}
 */
export function createJourneySequencePlayer({ sequence, participant, timeSecs = 0, rate: initialRate = 1 }) {
  if (!Number.isFinite(sequence.durationSecs) || sequence.durationSecs < 0) throw new RangeError('Sequence duration must be nonnegative seconds.');
  const durationSecs = sequence.durationSecs;
  const rates = participant?.capabilities?.rates ?? 'any';
  if (rates !== 'any' && (!rates.length || rates.some(rate => !Number.isFinite(rate) || rate === 0))) throw new RangeError('Declare supported nonzero finite playback rates.');
  const capabilities = Object.freeze({ seek: participant?.capabilities?.seek ?? true,
    rates: rates === 'any' ? rates : Object.freeze([...rates]) });
  let rate = initialRate;
  validateRate(rate);
  let frame = evaluate(timeSecs);
  /** @type {import('./sequence.d.ts').SequenceSnapshot<Value>['status']} */
  let status = 'paused';
  /** @type {import('./sequence.d.ts').SequenceSnapshot<Value>['ownership']} */
  let ownership = 'detached';
  /** @type {unknown} */
  let error = null;
  let disposed = false, ownerVersion = 0, sampleVersion = 0;
  /** @type {AbortController | null} */
  let owner = null;
  /** @type {import('./operations.d.ts').OperationControl | null} */
  let playback = null, joining = null;
  /** @type {import('./operations.d.ts').JourneyOperation | null} */
  let navigation = null;
  /** @type {Set<(snapshot: import('./sequence.d.ts').SequenceSnapshot<Value>) => void>} */
  const listeners = new Set();

  const getSnapshot = () => ({ frame, status, ownership, rate, capabilities,
    operation: playback?.operation ?? null, joinOperation: joining?.operation ?? null, error, disposed });
  function publish() { for (const listener of listeners) listener(getSnapshot()); }
  function assertActive() { if (disposed) throw new Error('Sequence player is disposed.'); }
  /** @param {number} value */
  function validateRate(value) {
    if (!Number.isFinite(value) || value === 0) throw new RangeError('Rate must be nonzero and finite; use pause() to hold time.');
    if (capabilities.rates !== 'any' && !capabilities.rates.includes(value)) throw new RangeError('Playback rate is not supported by this participant.');
  }
  /** @param {number} time */
  function evaluate(time) {
    if (!Number.isFinite(time)) throw new RangeError('Presentation time must be finite seconds.');
    const timeSecs = Math.max(0, Math.min(durationSecs, time));
    return Object.freeze({ timeSecs, durationSecs, value: sequence.evaluate(timeSecs) });
  }
  const atEnd = () => rate > 0 ? frame.timeSecs === durationSecs : frame.timeSecs === 0;
  /** @param {'cancelled' | 'superseded'} reason */
  function release(reason) {
    const owned = ownership !== 'detached', oldJoin = joining, oldNavigation = navigation, oldOwner = owner;
    ownerVersion++; owner = null; joining = null; navigation = null; ownership = 'detached';
    oldOwner?.abort(reason); oldNavigation?.cancel(); oldJoin?.abort(reason);
    if (owned) participant?.release();
  }
  /** @param {unknown} failure */
  function fail(failure) {
    const oldJoin = joining;
    joining = null; oldJoin?.settle('failed', failure);
    try { release('cancelled'); } catch (releaseError) { failure = new AggregateError([failure, releaseError], 'Sequence failure and release failure.'); }
    status = 'failed'; error = failure;
    playback?.settle('failed', failure);
    publish();
  }
  function cancel() {
    if (disposed) return;
    const old = playback; playback = null;
    old?.abort();
    try { release('cancelled'); status = 'paused'; error = null; }
    catch (failure) { status = 'failed'; error = failure; }
    publish();
  }
  /** Apply a cached sample once; all participants must use this same envelope. */
  function apply() {
    if (ownership !== 'attached') {
      if (status === 'ended') playback?.settle('completed');
      return;
    }
    const token = ownerVersion, version = sampleVersion, pending = playback;
    const context = { signal: /** @type {AbortController} */ (owner).signal,
      isCurrent: () => !disposed && ownership === 'attached' && token === ownerVersion && version === sampleVersion,
      cancel() { if (token === ownerVersion) cancel(); } };
    try {
      const applied = participant?.apply(frame, context);
      // A queued host write acknowledges its final sample after the host applies
      // it. A seek, release or replacement makes that acknowledgement stale.
      void Promise.resolve(applied).then(() => {
        if (context.isCurrent() && pending === playback && status === 'ended' && pending && !pending.settled) {
          pending.settle('completed'); publish();
        }
      }, failure => { if (context.isCurrent()) fail(failure); });
    } catch (failure) { fail(failure); }
  }
  function play() {
    if (disposed) {
      const failed = createJourneyOperation(); failed.settle('failed', new Error('Sequence player is disposed.')); return failed.operation;
    }
    if (!playback || playback.settled) {
      const next = createJourneyOperation({ lanes: ['presentation'], onCancel() { if (playback === next) cancel(); } });
      playback = next;
    }
    const current = playback;
    error = null; status = atEnd() ? 'ended' : 'playing';
    if (ownership !== 'joining') apply();
    publish();
    return current.operation;
  }
  /** @param {{ signal?: AbortSignal }} [options] */
  function join(options = {}) {
    if (options.signal?.aborted) return createJourneyOperation({ signal: options.signal }).operation;
    const control = createJourneyOperation({ signal: options.signal, onCancel() { if (joining === control) cancel(); } });
    if (control.settled) return control.operation;
    if (disposed) { control.settle('failed', new Error('Sequence player is disposed.')); return control.operation; }
    try {
      release('superseded');
      owner = new AbortController(); ownership = 'joining'; joining = control; error = null;
      const token = ownerVersion;
      const context = { signal: owner.signal, isCurrent: () => !disposed && ownerVersion === token && ownership !== 'detached',
        cancel() { if (token === ownerVersion) cancel(); } };
      publish();
      if (!context.isCurrent()) return control.operation;
      if (participant?.join) navigation = participant.join(frame, context);
      else { const immediate = createJourneyOperation(); immediate.settle('completed'); navigation = immediate.operation; }
      void navigation.finished.then(result => {
        if (!context.isCurrent() || joining !== control) return;
        if (result.status === 'completed') {
          joining = null; navigation = null; ownership = 'attached';
          control.settle('completed'); publish();
        } else if (result.status === 'failed') fail(result.error);
        else {
          joining = null; control.settle(result.status);
          cancel();
        }
      });
    } catch (failure) { control.settle('failed', failure); fail(failure); }
    return control.operation;
  }
  /** @param {number} time */
  function seek(time) {
    assertActive();
    if (!capabilities.seek) throw new Error('Seeking is not supported by this participant.');
    const next = evaluate(time);
    // Scrubbing a transfer cancels that transfer. It does not start another
    // navigation implicitly; rejoin is explicit from the new live pose.
    if (ownership === 'joining') { release('superseded'); status = 'paused'; }
    frame = next; sampleVersion++; error = null;
    if (status === 'ended' || status === 'failed') status = 'paused';
    if (status === 'playing' && atEnd()) status = 'ended';
    apply(); publish();
    return frame;
  }
  /** @param {number} value */
  function setRate(value) {
    assertActive(); validateRate(value);
    rate = value; sampleVersion++;
    if (status === 'ended') status = 'paused';
    publish();
  }
  /** @param {number} deltaSecs */
  function update(deltaSecs) {
    assertActive();
    if (!Number.isFinite(deltaSecs) || deltaSecs < 0) throw new RangeError('Host delta must be nonnegative seconds.');
    if (ownership === 'joining') return frame;
    const advancing = status === 'playing';
    if (advancing) {
      try { frame = evaluate(Math.max(0, Math.min(durationSecs, frame.timeSecs + deltaSecs * rate))); sampleVersion++; }
      catch (failure) { fail(failure); return frame; }
      if (atEnd()) status = 'ended';
    }
    apply(); if (advancing) publish();
    return frame;
  }
  return {
    play, join, cancel, seek, setRate, update, getSnapshot,
    pause() { assertActive(); if (status === 'playing') { status = 'paused'; publish(); } },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { if (disposed) return; cancel(); disposed = true; publish(); listeners.clear(); },
  };
}
