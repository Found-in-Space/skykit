import type { JourneyDriver } from '../src/index.js';
export declare function exerciseJourneyDriver<Scene, Services>(options: {
  driver: JourneyDriver<Scene, Services>;
  scenes: readonly [Scene, Scene, Scene];
  advance(): Promise<void>;
}): Promise<{ outcomes: string[]; history: readonly string[] }>;
