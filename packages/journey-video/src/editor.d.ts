import type {
  TimedJourney,
  TimedJourneyFrame,
} from '@found-in-space/journey';
import type {
  JourneyVideoEditorDocument,
  JourneyVideoEditorState,
  JourneyVideoEditorTileMode,
  JourneyVideoEditorWidgetRef,
  JourneyVideoStorage,
} from './index.js';

export interface JourneyVideoStorageLike {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

export interface JourneyVideoEditorPreviewOptions {
  skykit?: boolean;
  octreeUrl?: string;
  renderScale?: number;
  coordinateUnitsPerParsec?: number;
  limitingMagnitude?: number;
}

export interface CreateJourneyVideoEditorOptions {
  host?: Element | null;
  document?: unknown;
  journey?: unknown;
  editorState?: unknown;
  storage?: JourneyVideoStorage | null;
  preview?: JourneyVideoEditorPreviewOptions;
  onChange?: (document: JourneyVideoEditorDocument) => void;
  onError?: (error: unknown) => void;
}

export interface JourneyVideoEditorSnapshot {
  disposed: boolean;
  journeyId: string;
  title: string;
  durationSecs: number;
  timeSecs: number;
  playing: boolean;
  tileModes: JourneyVideoEditorTileMode[];
  selectedWidget: JourneyVideoEditorWidgetRef | null;
  selectedLocationRange: JourneyVideoEditorState['selectedLocationRange'];
  locationWaypointCount: number;
  cameraWaypointCount: number;
  guideCount: number;
}

export interface JourneyVideoEditor {
  setJourney(journey: unknown): void;
  getJourney(): TimedJourney;
  evaluateAt(timeSecs: number): TimedJourneyFrame;
  setTime(timeSecs: number): void;
  play(): void;
  pause(): void;
  setTileMode(index: number, mode: JourneyVideoEditorTileMode): void;
  setZoom(zoom: number): void;
  selectWidget(type: JourneyVideoEditorWidgetRef['type'], id: string): void;
  getSnapshot(): JourneyVideoEditorSnapshot;
  dispose(): Promise<void>;
}

export declare function createJourneyVideoEditor(
  options?: CreateJourneyVideoEditorOptions
): JourneyVideoEditor;
