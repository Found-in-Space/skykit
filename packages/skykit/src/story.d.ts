import type { SkykitBrowser, SkykitBrowserHost, SkykitBrowserOptions } from './browser.js';
import type { SkykitViewState, SkykitViewer, Vector3Like } from './index.js';

export type SkykitStoryHost = SkykitBrowserHost;

export interface SkykitStoryChapterInput {
  id?: string;
  title?: string;
  body?: string;
  bodyHtml?: string | null;
  targetPc?: Vector3Like | null;
  observerPc?: Vector3Like | null;
  view?: Partial<SkykitViewState> | null;
  annotations?: unknown[];
}

export interface SkykitStoryChapter {
  id: string;
  title: string;
  body: string;
  bodyHtml: string | null;
  targetPc: Vector3Like | null;
  observerPc: Vector3Like | null;
  view: Partial<SkykitViewState> | null;
  annotations: unknown[];
}

export interface SkykitStoryOptions extends SkykitBrowserOptions {
  host?: SkykitStoryHost;
  src?: string;
  chapters?: Iterable<SkykitStoryChapterInput>;
  initialChapter?: string | number;
  controls?: boolean;
  previousLabel?: string;
  nextLabel?: string;
}

export interface SkykitStory {
  browser: SkykitBrowser;
  viewer: SkykitViewer;
  chapters: SkykitStoryChapter[];
  readonly currentIndex: number;
  readonly currentChapter: SkykitStoryChapter | null;
  next(): SkykitStoryChapter | null;
  previous(): SkykitStoryChapter | null;
  goTo(indexOrId: number | string): SkykitStoryChapter | null;
  dispose(): Promise<void>;
}

export declare function createSkykitStory(
  host: SkykitStoryHost,
  options?: SkykitStoryOptions
): Promise<SkykitStory>;

export declare function createSkykitStory(
  options?: SkykitStoryOptions
): Promise<SkykitStory>;
