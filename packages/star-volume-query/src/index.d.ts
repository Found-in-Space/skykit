import type {
  StarOctreeFetchStrategy,
  StarOctreeObjectBatchStreamOptions,
  StarOctreeProductDelta,
  StarOctreeProviderService,
} from '@found-in-space/star-octree-provider';

export interface PointPc {
  x: number;
  y: number;
  z: number;
}

export interface SphereVolumeRequest {
  type: 'sphere';
  centerPc: PointPc;
  radiusPc: number;
}

export interface PathVolumeRequest {
  type: 'path';
  pointsPc: PointPc[];
  radiusPc: number;
}

export type StarVolumeRequest = SphereVolumeRequest | PathVolumeRequest;

export interface TravelRadiusProfilePoint {
  progress: number;
  radiusPc: number;
}

export interface BuildTravelVolumeRequestsOptions {
  routePointsPc: PointPc[];
  radiusProfile?: TravelRadiusProfilePoint[];
  defaultRadiusPc?: number;
  paddingPc?: number;
  quantizeStepPc?: number;
}

export interface WarmVolumeProgress {
  request: StarVolumeRequest;
  requestIndex: number;
  delta: StarOctreeProductDelta;
}

export interface WarmVolumeResult {
  requestCount: number;
  productCount: number;
  starCount: number;
  currentCount: number;
}

export declare function createSphereVolumeStrategy(
  options: Omit<SphereVolumeRequest, 'type'>
): StarOctreeFetchStrategy;

export declare function createPathVolumeStrategy(
  options: Omit<PathVolumeRequest, 'type'>
): StarOctreeFetchStrategy;

export declare function buildTravelVolumeRequests(
  options: BuildTravelVolumeRequestsOptions
): PathVolumeRequest[];

export declare function streamVolumeProducts(
  provider: StarOctreeProviderService,
  request: StarVolumeRequest,
  options?: Omit<StarOctreeObjectBatchStreamOptions, 'strategy'>
): AsyncIterable<StarOctreeProductDelta>;

export declare function warmVolumeRequests(
  provider: StarOctreeProviderService,
  requests: StarVolumeRequest[],
  options?: Omit<StarOctreeObjectBatchStreamOptions, 'strategy'> & {
    onProgress?: (progress: WarmVolumeProgress) => void;
  }
): Promise<WarmVolumeResult>;

export declare function distancePointToPathPc(
  point: PointPc,
  pointsPc: PointPc[]
): number;

