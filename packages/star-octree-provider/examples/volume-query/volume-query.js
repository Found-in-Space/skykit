import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
  streamVolumeProducts,
} from '@found-in-space/star-octree-provider';

const provider = createStarOctreeProviderService({ url: OCTREE_DEFAULT });
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
