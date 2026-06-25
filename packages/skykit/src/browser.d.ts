import type { StarCellStrategy } from '@found-in-space/star-trees';
import type {
  StarOctreeProviderService,
  StarOctreeSessionOptions,
} from '@found-in-space/star-octree-provider';
import type { ThreeStarField } from '@found-in-space/three-star-field';
import type * as THREE from 'three';

import type {
  Object3dLayerOptions,
  SkykitActionRegistry,
  SkykitAnimationLoop,
  SkykitAnimationLoopOptions,
  SkykitDragLookOptions,
  SkykitInspectFacade,
  SkykitLookAtInput,
  SkykitPlugin,
  SkykitCoordinateFrameId,
  SkykitCoordinateGridSystemId,
  SkykitKeyboardNavigationOptions,
  SkykitOrbitDragOptions,
  SkykitPluginInput,
  SkykitPluginTeardown,
  SkykitProductMetadata,
  SkykitProductRegistryPlugin,
  SkykitSelectionFacade,
  SkykitSelectionValue,
  SkykitStarPickingPluginOptions,
  SkykitThreePart,
  SkykitViewState,
  SkykitViewer,
  Vector3Like,
} from './index.js';

export type SkykitBrowserHost = string | {
  appendChild?: (node: unknown) => void;
  removeChild?: (node: unknown) => void;
  clientWidth?: number;
  clientHeight?: number;
  style?: { touchAction?: string };
};

export type SkykitBrowserStatusTarget = string | { textContent?: string | null };
export type SkykitBrowserMouseMode =
  | 'grab'
  | 'look'
  | 'mouse-look'
  | 'mouselook'
  | 'game'
  | 'strafe'
  | 'orbit'
  | 'object-orbit'
  | 'orbital'
  | 'inspect'
  | 'none'
  | 'off'
  | 'false';
export type SkykitConstellationArtMode = 'off' | 'lazy' | 'preload';
export type SkykitPersistentCacheMode = 'on' | 'off';

export interface SkykitBrowserAddonContext {
  id?: string;
  host: SkykitBrowserHost | Element;
  browser: SkykitBrowser;
  viewer: SkykitViewer;
  THREE: typeof THREE;
  skykit: Record<string, unknown>;
}

export interface SkykitBrowserAddon {
  id?: string;
  install(
    context: SkykitBrowserAddonContext
  ): void | Promise<void> | SkykitPluginTeardown | Promise<SkykitPluginTeardown | void>;
}

export type SkykitBrowserInstallInput = SkykitPluginInput | SkykitBrowserAddon;

export interface SkykitBrowserGlobal {
  browserAddons: SkykitBrowserAddon[];
  registerBrowserAddon(addon: SkykitBrowserAddon): SkykitPluginTeardown;
  whenReady(target?: string | Element): Promise<SkykitBrowser>;
  getBrowsers(): SkykitBrowser[];
}

export interface SkykitBrowserConstellationsOptions {
  skyculture?: string;
  manifest?: Record<string, unknown>;
  manifestUrl?: string;
  assetBaseUrl?: string;
  art?: SkykitConstellationArtMode | string;
  visible?: boolean;
  priority?: number;
  boundaryRadius?: number;
  boundaryColor?: THREE.ColorRepresentation;
  boundaryOpacity?: number;
  renderOrder?: number;
  artOpacity?: number;
  artMaxAngleDeg?: number;
  skipTextureErrors?: boolean;
}

export interface SkykitBrowserConstellationsFacade {
  load(options?: SkykitBrowserConstellationsOptions): Promise<SkykitBrowserConstellationsFacade>;
  show(): boolean | Promise<boolean>;
  hide(): boolean | Promise<boolean>;
  toggle(force?: boolean): boolean | Promise<boolean>;
  setArt(mode: SkykitConstellationArtMode | string): SkykitConstellationArtMode | Promise<SkykitConstellationArtMode>;
  getSnapshot(): unknown | Promise<unknown>;
  dispose?(): void;
}

export interface SkykitBrowserCoordinateFramesOptions {
  frames?: SkykitCoordinateFrameId | Iterable<SkykitCoordinateFrameId> | string;
  visible?: boolean;
  priority?: number;
  radiusPc?: number;
  publish?: false | {
    metadata?: SkykitProductMetadata;
  };
}

export interface SkykitBrowserCoordinateFramesFacade {
  load(options?: SkykitBrowserCoordinateFramesOptions): Promise<SkykitBrowserCoordinateFramesFacade>;
  show(): boolean | Promise<boolean>;
  hide(): boolean | Promise<boolean>;
  toggle(force?: boolean): boolean | Promise<boolean>;
  getSnapshot(): unknown | Promise<unknown>;
  dispose?(): void;
}

export interface SkykitBrowserCoordinateGridsOptions {
  grids?: SkykitCoordinateGridSystemId | Iterable<SkykitCoordinateGridSystemId> | string;
  visible?: boolean;
  priority?: number;
  radiusPc?: number;
  publish?: false | {
    metadata?: SkykitProductMetadata;
  };
}

export interface SkykitBrowserCoordinateGridsFacade {
  load(options?: SkykitBrowserCoordinateGridsOptions): Promise<SkykitBrowserCoordinateGridsFacade>;
  show(): boolean | Promise<boolean>;
  hide(): boolean | Promise<boolean>;
  toggle(force?: boolean): boolean | Promise<boolean>;
  getSnapshot(): unknown | Promise<unknown>;
  dispose?(): void;
}

export interface SkykitBrowserOptions {
  host?: SkykitBrowserHost;
  status?: boolean | SkykitBrowserStatusTarget | null;
  renderer?: THREE.WebGLRenderer;
  camera?: THREE.PerspectiveCamera;
  provider?: StarOctreeProviderService;
  starField?: ThreeStarField;
  pick?: false | true | SkykitBrowserStarPickOptions;
  octreeUrl?: string;
  persistentCache?: SkykitPersistentCacheMode | string;
  strategy?: StarCellStrategy;
  session?: StarOctreeSessionOptions;
  keyboard?: false | SkykitKeyboardNavigationOptions;
  grab?: false | SkykitDragLookOptions | SkykitOrbitDragOptions;
  mouseMode?: SkykitBrowserMouseMode;
  plugins?: Iterable<SkykitPluginInput>;
  view?: Partial<SkykitViewState>;
  lookAt?: SkykitLookAtInput;
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

export interface SkykitBrowserStarPickOptions
  extends Omit<SkykitStarPickingPluginOptions, 'renderer' | 'source'> {}

export interface SkykitBrowser {
  viewer: SkykitViewer;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  provider: StarOctreeProviderService;
  starField: ThreeStarField;
  starPicking: (SkykitPlugin & { getSnapshot?(): unknown }) | null;
  loop: SkykitAnimationLoop;
  capabilities: Set<string>;
  actions: SkykitActionRegistry;
  products: SkykitProductRegistryPlugin;
  selection: SkykitSelectionFacade<SkykitSelectionValue>;
  inspect: SkykitInspectFacade;
  constellations: SkykitBrowserConstellationsFacade;
  frames: SkykitBrowserCoordinateFramesFacade;
  grids: SkykitBrowserCoordinateGridsFacade;
  install(input: SkykitBrowserInstallInput): Promise<SkykitPluginTeardown>;
  addObject(
    object3d: THREE.Object3D,
    options?: SkykitBrowserObjectOptions
  ): SkykitBrowserObjectHandle;
  resize(): void;
  dispose(): Promise<void>;
}

export interface SkykitBrowserObjectOptions extends Omit<Object3dLayerOptions, 'object3d'> {
  positionPc?: Vector3Like;
}

export interface SkykitBrowserObjectHandle {
  object3d: THREE.Object3D;
  part: SkykitThreePart;
  remove: SkykitPluginTeardown;
  dispose: SkykitPluginTeardown;
}

export declare function createSkykitBrowser(host: SkykitBrowserHost): Promise<SkykitBrowser>;
export declare function createSkykitBrowser(options?: SkykitBrowserOptions): Promise<SkykitBrowser>;
