import type { JourneyOperation, OperationStatus } from './operations.js';
export type { JourneyOperation, OperationResult, OperationStatus } from './operations.js';

export type Cleanup = () => void | Promise<void>;
export type JourneyStatus = 'idle' | 'preparing' | 'transitioning' | 'active' | 'cancelled' | 'failed';
export type LeaveReason = 'leave' | 'cancelled' | 'superseded' | 'failed' | 'disposed';
export interface JourneyContext<Scene = unknown, Services = unknown> {
  readonly journeyId: string;
  readonly chapterId: string;
  readonly previousChapterId: string | null;
  readonly requestedChapterId: string;
  readonly source: string;
  readonly signal: AbortSignal;
  readonly services: Services;
  readonly scene: Scene;
  readonly transition: JourneyTransition;
  readonly reason?: LeaveReason;
  isCurrent(): boolean;
  throwIfAborted(): void;
  addCleanup(cleanup: Cleanup): void;
  reportProgress(progress: unknown): void;
}
export type JourneyHook<Scene, Services> = (context: JourneyContext<Scene, Services>) => void | Cleanup | Promise<void | Cleanup>;
export interface JourneyChapter<Scene = unknown, Services = unknown> {
  readonly id: string;
  readonly title?: string;
  readonly scene: Scene;
  readonly transition?: JourneyTransition;
  readonly prepare?: JourneyHook<Scene, Services>;
  readonly enter?: JourneyHook<Scene, Services>;
  readonly arrive?: JourneyHook<Scene, Services>;
  readonly leave?: JourneyHook<Scene, Services>;
}
export interface JourneyTransition {
  readonly durationSecs?: number;
  readonly [key: string]: unknown;
}
export interface JourneyDefinition<Scene = unknown, Services = unknown> {
  readonly id: string;
  readonly title?: string;
  readonly chapters: readonly JourneyChapter<Scene, Services>[];
  readonly transitions?: readonly (JourneyTransition & { readonly from: string; readonly to: string })[];
  readonly transition?: JourneyTransition;
}
export interface JourneyDriver<Scene = unknown, Services = unknown> {
  readonly services?: Services;
  prepare?(scene: Scene, context: JourneyContext<Scene, Services>): void | Cleanup | Promise<void | Cleanup>;
  enter?(scene: Scene, context: JourneyContext<Scene, Services>): void | Cleanup | Promise<void | Cleanup>;
  transition(scene: Scene, context: JourneyContext<Scene, Services>): JourneyOperation;
  /** Release this driver's motion, including persistent arrival motion, keeping the live pose. */
  cancel(): void;
}
export interface JourneySnapshot {
  readonly id: string;
  readonly status: JourneyStatus;
  readonly requestedChapterId: string | null;
  readonly enteredChapterId: string | null;
  readonly arrivedChapterId: string | null;
  readonly history: readonly string[];
  readonly operation: JourneyOperation | null;
  readonly source: string | null;
  readonly error: unknown;
  readonly progress: unknown;
  readonly disposed: boolean;
}
export interface GoToOptions { source?: string; signal?: AbortSignal }
export interface GuidedJourneyController {
  start(id?: string, options?: GoToOptions): JourneyOperation;
  goTo(id: string, options?: GoToOptions): JourneyOperation;
  next(options?: GoToOptions): JourneyOperation;
  previous(options?: GoToOptions): JourneyOperation;
  cancel(): void;
  getSnapshot(): JourneySnapshot;
  subscribe(listener: (snapshot: JourneySnapshot) => void): () => void;
  dispose(): Promise<void>;
}
export declare function defineGuidedJourney<Scene, Services = unknown>(definition: JourneyDefinition<Scene, Services>): JourneyDefinition<Scene, Services>;
export declare function createGuidedJourneyController<Scene, Services = unknown>(options: {
  definition: JourneyDefinition<Scene, Services>;
  driver: JourneyDriver<Scene, Services>;
}): GuidedJourneyController;
