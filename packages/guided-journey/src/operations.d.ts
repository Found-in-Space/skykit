export type OperationStatus = 'completed' | 'cancelled' | 'superseded' | 'failed';
export interface OperationResult {
  readonly id: string;
  readonly status: OperationStatus;
  readonly error?: unknown;
}
export interface JourneyOperation {
  readonly id: string;
  readonly lanes: readonly string[];
  readonly finished: Promise<OperationResult>;
  cancel(): void;
}
export interface OperationControl {
  readonly operation: JourneyOperation;
  readonly signal: AbortSignal;
  readonly settled: boolean;
  settle(status: OperationStatus, error?: unknown): void;
  abort(status?: 'cancelled' | 'superseded'): void;
}
/** Shared operation primitive for domain navigation adapters. Outcomes never reject. */
export declare function createJourneyOperation(options?: {
  id?: string;
  lanes?: readonly string[];
  signal?: AbortSignal;
  onCancel?: (status: 'cancelled' | 'superseded') => void;
}): OperationControl;
