export declare const JOURNEY_VIDEO_EXPORT_PACKAGE_STATUS: 'alpha-export';
export declare const JOURNEY_VIDEO_EXPORT_PLATES: readonly ['sky', 'overlay', 'composite'];
export declare const JOURNEY_VIDEO_BROWSER_IDS: readonly ['webkit', 'chromium', 'firefox'];
export declare const JOURNEY_VIDEO_LAYOUT_IDS: readonly string[];
export declare const JOURNEY_VIDEO_DEFAULT_LAYOUT_ID: 'landscape-4k';
export declare const JOURNEY_VIDEO_PREVIEW_LAYOUT_ID: 'landscape-1080p';
export declare const JOURNEY_VIDEO_RENDER_PROFILE_IDS: readonly string[];

export interface JourneyVideoTextLayout {
  x: number;
  bottom: number;
  maxWidth: number;
  titleMaxWidth?: number;
  bodyMaxWidth?: number;
  eyebrowFontSize: number;
  titleFontSize: number;
  bodyFontSize: number;
  eyebrowGap: number;
  bodyGap: number;
  titleLineHeight: number;
  bodyLineHeight: number;
  shadowBlur: number;
  shadowOffsetY: number;
}

export interface JourneyVideoLayoutProfile {
  id: string;
  label: string;
  width: number;
  height: number;
  text: JourneyVideoTextLayout;
}

export interface JourneyVideoRenderProfile {
  mode: 'preview' | 'final';
  layout: JourneyVideoLayoutProfile;
  fps: number;
  seconds: number;
  frameCount: number;
  browser: 'webkit' | 'chromium' | 'firefox';
  crf: number;
  retainFrames: boolean;
}

export interface JourneyVideoOverlayBlock {
  id: string;
  startSecs: number;
  endSecs: number;
  fadeInSecs: number;
  fadeOutSecs: number;
  eyebrow: string;
  title: string;
  body: string;
}

export interface JourneyVideoOverlayAssetBlock extends JourneyVideoOverlayBlock {
  assetPath: string;
}

export interface BuildJourneyVideoFfmpegArgsOptions {
  profile: Partial<JourneyVideoRenderProfile> | Record<string, unknown>;
  skyFramePattern: string;
  overlayBlocks?: Iterable<JourneyVideoOverlayAssetBlock>;
  outputPath: string;
}

export declare function normalizeJourneyVideoLayout(layoutInput?: unknown): JourneyVideoLayoutProfile;
export declare function normalizeJourneyVideoRenderProfile(input?: unknown): JourneyVideoRenderProfile;
export declare function createJourneyVideoOverlayBlocks(
  journeyInput: unknown,
  options?: { fadeSecs?: number }
): JourneyVideoOverlayBlock[];
export declare function computeJourneyVideoOverlayOpacity(
  block: JourneyVideoOverlayBlock,
  timeSecs: number
): number;
export declare function buildJourneyVideoFfmpegArgs(options: BuildJourneyVideoFfmpegArgsOptions): string[];
export declare function buildJourneyVideoFfmpegFilter(blocks: JourneyVideoOverlayAssetBlock[]): string;
export declare function createJourneyVideoRenderMetadata(input?: unknown): Record<string, unknown>;
