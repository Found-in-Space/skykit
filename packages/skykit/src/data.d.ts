import type { MetaSidecarEntry, MetaSidecarProviderService } from '@found-in-space/meta-sidecar-provider';
import type {
  StarOctreeCellStreamOptions,
  StarOctreeProviderService,
  StarOctreeProviderServiceOptions,
} from '@found-in-space/star-octree-provider';
import type {
  StarObjectRef,
  StarTreePointPc,
} from '@found-in-space/star-trees';

export {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
export {
  createObserverShellStrategy,
  createSphereVolumeStrategy,
  createStarCellKey,
  decodeTemperatureK,
  temperatureToRgb,
} from '@found-in-space/star-trees';
export {
  createMetaSidecarProviderService,
  deriveMetaSidecarUrlFromRenderUrl,
  metaSidecarEntryDisplayFields,
} from '@found-in-space/meta-sidecar-provider';

export interface SkykitStarRow {
  ref: StarObjectRef | null;
  cellKey: string;
  level: number;
  mortonCode: string;
  ordinal: number;
  positionPc: StarTreePointPc;
  xPc: number;
  yPc: number;
  zPc: number;
  distancePc: number;
  magAbs: number | null;
  absoluteMagnitude: number | null;
  apparentMagnitude: number | null;
  teffLog8: number | null;
  temperatureK: number | null;
}

export interface SkykitRowsFromCellsOptions {
  observerPc?: StarTreePointPc;
  limitingMagnitude?: number;
  filterVisible?: boolean;
}

export interface SkykitStarDataOptions extends Omit<StarOctreeCellStreamOptions, 'view' | 'strategy'> {
  provider?: StarOctreeProviderService;
  providerId?: string;
  octreeUrl?: string;
  persistentCache?: StarOctreeProviderServiceOptions['persistentCache'];
  limits?: StarOctreeProviderServiceOptions['limits'];
  observerPc?: StarTreePointPc;
  centerPc?: StarTreePointPc;
  radiusPc?: number;
  limitingMagnitude?: number;
  maxStars?: number;
  filterVisible?: boolean;
  sortBy?:
    | 'apparentMagnitude'
    | 'distancePc'
    | 'magAbs'
    | 'absoluteMagnitude'
    | null
    | false
    | ((left: SkykitStarRow, right: SkykitStarRow) => number);
  view?: StarOctreeCellStreamOptions['view'];
  strategy?: StarOctreeCellStreamOptions['strategy'];
}

export type SkykitStarLabelInput = SkykitStarRow | StarObjectRef;

export interface SkykitStarLabelOptions {
  metaProvider?: MetaSidecarProviderService;
  metaProviderId?: string;
  metaUrl?: string;
  parentDatasetId?: string;
  datasetId?: string;
  persistentCache?: 'on' | 'off';
  metaLimits?: {
    shardPrefetchBytes?: number;
  };
  provider?: StarOctreeProviderService;
  octreeUrl?: string;
}

export interface SkykitStarLabel {
  star: SkykitStarLabelInput;
  ref: StarObjectRef | null;
  entry: MetaSidecarEntry | null;
  fields: {
    properName: string;
    bayer: string;
    hd: string;
    hip: string;
    gaia: string;
    primaryLabel: string;
  };
  label: string;
}

export declare function createStarStream(
  options?: SkykitStarDataOptions
): AsyncIterable<SkykitStarRow[]>;

export declare function loadStarRows(
  options?: SkykitStarDataOptions
): Promise<SkykitStarRow[]>;

export declare function streamStarRows(
  options?: SkykitStarDataOptions
): AsyncIterable<SkykitStarRow[]>;

export declare function rowsFromStarCells(
  cells: Iterable<import('@found-in-space/star-trees').StarCellData>,
  options?: SkykitRowsFromCellsOptions
): SkykitStarRow[];

export declare function loadStarLabels(
  input: Iterable<SkykitStarLabelInput> | SkykitStarDataOptions,
  options?: SkykitStarLabelOptions
): Promise<SkykitStarLabel[]>;

export declare function formatStarLabel(
  entry?: MetaSidecarEntry | null,
  fallback?: string
): string;
