import type { StarCellStrategy } from '@found-in-space/star-trees';
import type {
  StarOctreeProviderService,
  StarOctreeSessionOptions,
} from '@found-in-space/star-octree-provider';
import type { ThreeStarField } from '@found-in-space/three-star-field';
import type * as THREE from 'three';

import type {
  SkykitAnimationLoop,
  SkykitAnimationLoopOptions,
  SkykitDragLookOptions,
  SkykitKeyboardNavigationOptions,
  SkykitPluginInput,
  SkykitViewState,
  SkykitViewer,
} from './index.js';

export type SkykitBrowserHost = string | {
  appendChild?: (node: unknown) => void;
  removeChild?: (node: unknown) => void;
  clientWidth?: number;
  clientHeight?: number;
  style?: { touchAction?: string };
};

export type SkykitBrowserStatusTarget = string | { textContent?: string | null };

export interface SkykitBrowserOptions {
  host?: SkykitBrowserHost;
  status?: boolean | SkykitBrowserStatusTarget | null;
  renderer?: THREE.WebGLRenderer;
  camera?: THREE.PerspectiveCamera;
  provider?: StarOctreeProviderService;
  starField?: ThreeStarField;
  octreeUrl?: string;
  strategy?: StarCellStrategy;
  session?: StarOctreeSessionOptions;
  keyboard?: false | SkykitKeyboardNavigationOptions;
  grab?: false | SkykitDragLookOptions;
  plugins?: Iterable<SkykitPluginInput>;
  view?: Partial<SkykitViewState>;
  loop?: SkykitAnimationLoopOptions;
  limitingMagnitude?: number;
  exposure?: number;
  coordinateUnitsPerParsec?: number;
  speedPcPerSec?: number;
  fovDeg?: number;
  near?: number;
  far?: number;
  antialias?: boolean;
  background?: THREE.ColorRepresentation;
  maxDevicePixelRatio?: number;
  autoStart?: boolean;
  autoResize?: boolean;
  autoDispose?: boolean;
  disableTouchAction?: boolean;
}

export interface SkykitBrowser {
  viewer: SkykitViewer;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  provider: StarOctreeProviderService;
  starField: ThreeStarField;
  loop: SkykitAnimationLoop;
  resize(): void;
  dispose(): Promise<void>;
}

export declare function createSkykitBrowser(host: SkykitBrowserHost): Promise<SkykitBrowser>;
export declare function createSkykitBrowser(options?: SkykitBrowserOptions): Promise<SkykitBrowser>;
