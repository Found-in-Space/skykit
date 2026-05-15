import { createStarOctreeProviderService } from '@found-in-space/star-octree-provider';
import { streamVolumeProducts } from '@found-in-space/star-volume-query';

const DEFAULT_OCTREE_URL =
  'https://d1kwci8ql2abxm.cloudfront.net/c56103e6-ad4c-41f9-be06-048b48ec632b/stars.octree';

const provider = createStarOctreeProviderService({ url: DEFAULT_OCTREE_URL });
let products = 0;
let stars = 0;

for await (const delta of streamVolumeProducts(provider, {
  type: 'sphere',
  centerPc: { x: 0, y: 0, z: 0 },
  radiusPc: 25,
}, {
  attributes: ['position', 'magAbs', 'teffLog8'],
})) {
  if (delta.type === 'data/product-upsert') {
    products += 1;
    stars += delta.product.count;
    console.log(`product ${products}: ${delta.product.count} stars`);
  }
  if (delta.type === 'data/representation-current') {
    console.log(`current: ${stars} stars across ${products} products`);
    break;
  }
}
