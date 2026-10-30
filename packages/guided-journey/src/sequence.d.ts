import type { JourneyOperation } from './operations.js';

/** Evaluation is pure. Domain values declare their own coordinate frames and units. */
export interface JourneySequence<Value> {
  readonly durationSecs: number;
  evaluate(timeSecs: number): Value;
}
export interface SequenceFrame<Value> {
  readonly timeSecs: number;
  readonly durationSecs: number;
  readonly value: Value;
}
export interface SequenceContext {
  readonly signal: AbortSignal;
  /** Check after asynchronous work before applying a sample. */
  isCurrent(): boolean;
  /** A host can release playback when manual input or another camera owner wins. */
  cancel(): void;
}
export interface SequenceCapabilities {
  readonly seek: boolean;
  /** Nonzero finite rates; negative rates run towards the start. */
  readonly rates: 'any' | readonly number[];
}
export interface SequenceParticipant<Value> {
  readonly capabilities?: Partial<SequenceCapabilities>;
  /** Blend from the live scene into this sample. Omit for a participant with no navigation. */
  join?(frame: SequenceFrame<Value>, context: SequenceContext): JourneyOperation;
  /** Apply one shared sample. Resolve an asynchronous result only once it reaches the host. */
  apply(frame: SequenceFrame<Value>, context: SequenceContext): void | Promise<void>;
  /** Release ownership at the live scene without restoring an authored snapshot. */
  release(): void;
}
export interface SequenceSnapshot<Value> {
  readonly frame: SequenceFrame<Value>;
  readonly status: 'paused' | 'playing' | 'ended' | 'failed';
  readonly ownership: 'detached' | 'joining' | 'attached';
  readonly rate: number;
  readonly capabilities: SequenceCapabilities;
  readonly operation: JourneyOperation | null;
  readonly joinOperation: JourneyOperation | null;
  readonly error: unknown;
  readonly disposed: boolean;
}
export interface JourneySequencePlayer<Value> {
  /** Playback end, independently of join/arrival. Does not implicitly join or rewind. */
  play(): JourneyOperation;
  pause(): void;
  /** Clamp a finite time to the duration; detached seeks never acquire scene ownership. */
  seek(timeSecs: number): SequenceFrame<Value>;
  setRate(rate: number): void;
  /** Explicit live-pose entry/re-entry. Presentation time holds while joining. */
  join(options?: { signal?: AbortSignal }): JourneyOperation;
  /** Cancel playback and release the scene at the current pose and presentation time. */
  cancel(): void;
  /** Call once per host frame, with nonnegative elapsed seconds. No clock or render loop is installed. */
  update(deltaSecs: number): SequenceFrame<Value>;
  getSnapshot(): SequenceSnapshot<Value>;
  subscribe(listener: (snapshot: SequenceSnapshot<Value>) => void): () => void;
  dispose(): void;
}
export declare function createJourneySequencePlayer<Value>(options: {
  sequence: JourneySequence<Value>;
  participant?: SequenceParticipant<NoInfer<Value>>;
  timeSecs?: number;
  rate?: number;
}): JourneySequencePlayer<Value>;
