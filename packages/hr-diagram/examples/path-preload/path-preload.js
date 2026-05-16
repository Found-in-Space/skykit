import { createStarOctreeProviderService } from '@found-in-space/star-octree-provider';
import {
  buildTravelVolumeRequests,
  warmVolumeRequests,
} from '@found-in-space/star-octree-provider';

const DEFAULT_OCTREE_URL =
  'https://d1kwci8ql2abxm.cloudfront.net/c56103e6-ad4c-41f9-be06-048b48ec632b/stars.octree';

const provider = createStarOctreeProviderService({ url: DEFAULT_OCTREE_URL });
const requests = buildTravelVolumeRequests({
  routePointsPc: [
    { x: 0, y: 0, z: 0 },
    { x: 50, y: 0, z: 0 },
    { x: 120, y: 40, z: 0 },
  ],
  radiusProfile: [
    { progress: 0, radiusPc: 12 },
    { progress: 0.6, radiusPc: 20 },
    { progress: 1, radiusPc: 8 },
  ],
});

const result = await warmVolumeRequests(provider, requests, {
  attributes: ['position', 'magAbs', 'teffLog8'],
  onProgress({ requestIndex, delta }) {
    if (delta.type === 'data/product-upsert') {
      console.log(`request ${requestIndex}: warmed ${delta.product.count} stars`);
    }
  },
});

console.log(result);
