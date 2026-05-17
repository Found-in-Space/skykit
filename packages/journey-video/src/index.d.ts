import type { TimedJourney } from '@found-in-space/journey';

export declare const JOURNEY_VIDEO_PACKAGE_STATUS: 'alpha-editor';
export declare const JOURNEY_VIDEO_EDITOR_TILE_MODES: readonly ['xy', 'xz', 'yz', 'perspective', 'skykit'];

export type JourneyVideoEditorTileMode = 'xy' | 'xz' | 'yz' | 'perspective' | 'skykit';
export type JourneyVideoEditorWidgetType = 'location' | 'camera' | 'guide';

export interface JourneyVideoEditorWidgetRef {
  type: JourneyVideoEditorWidgetType;
  id: string;
}

export interface JourneyVideoEditorLocationRangeRef {
  anchorId: string;
  focusId: string;
}

export interface JourneyVideoEditorState {
  tileModes: JourneyVideoEditorTileMode[];
  zoom: number;
  selectedWidget: JourneyVideoEditorWidgetRef | null;
  selectedLocationRange: JourneyVideoEditorLocationRangeRef | null;
  selectedLocationGroupId: string | null;
  selectedLocationGroupPhase: 'start' | 'end' | null;
  timeSecs: number;
  playing: boolean;
}

export interface JourneyVideoEditorDocument {
  format: 'fis-journey-video-editor-v1';
  journey: TimedJourney;
  editorState: JourneyVideoEditorState;
  metadata: Record<string, unknown>;
}

export interface JourneyVideoStorage {
  load(): JourneyVideoEditorDocument | null;
  save(document: JourneyVideoEditorDocument): void;
  clear(): void;
}

export declare const DEFAULT_JOURNEY_VIDEO_EDITOR_STATE: Readonly<JourneyVideoEditorState>;
export declare function normalizeJourneyVideoEditorState(input?: unknown): JourneyVideoEditorState;
export declare function createJourneyVideoEditorDocument(options?: {
  journey?: unknown;
  editorState?: unknown;
  metadata?: Record<string, unknown>;
}): JourneyVideoEditorDocument;
export declare function exportJourneyVideoEditorDocument(document: JourneyVideoEditorDocument): string;
export declare function importJourneyVideoEditorDocument(input: string | unknown): JourneyVideoEditorDocument;
export declare function createJourneyVideoStorage(
  storage: { getItem?: Function; setItem?: Function; removeItem?: Function } | null | undefined,
  key?: string
): JourneyVideoStorage;
