import type { JourneyVideoRenderProfile } from './export.js';

export interface RunJourneyVideoExportOptions {
  profile?: Partial<JourneyVideoRenderProfile> | Record<string, unknown>;
  journeyPath?: string;
  outputDir?: string;
  videoFilename?: string;
  pageUrl?: string;
  serverCwd?: string;
}

export interface NormalizedJourneyVideoCliOptions extends RunJourneyVideoExportOptions {
  profile: JourneyVideoRenderProfile;
  journeyPath: string;
  outputDir: string;
  pageUrl: string | null;
  serverCwd: string;
}

export interface JourneyVideoExportResult {
  outputDir: string;
  videoPath: string;
  metadataPath: string;
  metadata: Record<string, unknown>;
}

export declare function normalizeJourneyVideoCliOptions(rawArgs?: string[]): NormalizedJourneyVideoCliOptions;
export declare function runJourneyVideoExport(options?: RunJourneyVideoExportOptions): Promise<JourneyVideoExportResult>;
export declare function runJourneyVideoCli(rawArgs?: string[]): Promise<JourneyVideoExportResult>;
