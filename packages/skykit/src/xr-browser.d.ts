import type { StarOctreeProviderService } from '@found-in-space/star-octree-provider';
import type * as THREE from 'three';

import type {
  SkykitBrowser,
  SkykitBrowserAddonContext,
  SkykitBrowserHost,
  SkykitBrowserStatusTarget,
  SkykitPersistentCacheMode,
} from './browser.js';
import type {
  SkykitHostedLayer,
  SkykitPluginTeardown,
} from './index.js';
import type {
  SkykitVrViewer,
  SkykitVrViewerOptions,
  SkykitXrBodyPlugin,
  SkykitXrComposition,
  SkykitXrNavigationPlugin,
  SkykitXrPickBridgePlugin,
  SkykitXrPickRouter,
  SkykitXrRaySource,
  SkykitXrRig,
  SkykitXrSessionHandle,
  SkykitXrSessionPlugin,
} from './xr.js';

export interface SkykitXrBrowserOptions extends Omit<SkykitVrViewerOptions, 'host' | 'products'> {
  host?: SkykitBrowserHost;
  status?: boolean | SkykitBrowserStatusTarget | null;
  provider?: StarOctreeProviderService;
  octreeUrl?: string;
  persistentCache?: SkykitPersistentCacheMode | string;
  background?: THREE.ColorRepresentation;
  disableTouchAction?: boolean;
}

export interface SkykitXrBrowser extends Omit<SkykitBrowser, 'provider' | 'starField' | 'loop'> {
  readonly vr: SkykitVrViewer;
  readonly xr: SkykitXrComposition | null;
  readonly rig: SkykitXrRig | null;
  readonly session: SkykitXrSessionPlugin | null;
  readonly body: SkykitXrBodyPlugin | null;
  readonly navigation: SkykitXrNavigationPlugin | null;
  readonly rays: Record<string, SkykitXrRaySource>;
  readonly provider: StarOctreeProviderService | null;
  readonly starSource: SkykitVrViewer['starSource'];
  readonly starField: SkykitVrViewer['starField'];
  readonly starLayer: SkykitVrViewer['starLayer'];
  readonly layerHost: SkykitVrViewer['layerHost'];
  readonly pickBridge: SkykitXrPickBridgePlugin | null;
  readonly pickRouter: SkykitXrPickRouter | null;
  readonly starPicking: SkykitVrViewer['starPicking'];
  readonly loop: SkykitVrViewer['loop'];
  enter(): Promise<SkykitXrSessionHandle>;
  exit(): Promise<void>;
  addLayer(layer: SkykitHostedLayer): SkykitPluginTeardown;
}

export interface SkykitXrBrowserAddonContext extends SkykitBrowserAddonContext {
  browser: SkykitXrBrowser;
  vr: SkykitVrViewer;
  xr: SkykitXrComposition | null;
}

export declare function createSkykitXrBrowser(host: SkykitBrowserHost): Promise<SkykitXrBrowser>;
export declare function createSkykitXrBrowser(options?: SkykitXrBrowserOptions): Promise<SkykitXrBrowser>;
