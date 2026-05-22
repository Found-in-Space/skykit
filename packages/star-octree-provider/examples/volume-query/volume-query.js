import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
  streamVolumeCells,
} from '@found-in-space/star-octree-provider';

const provider = createStarOctreeProviderService({ url: OCTREE_DEFAULT });
let cells = 0;
let stars = 0;

for await (const delta of streamVolumeCells(provider, {
  type: 'sphere',
  centerPc: { x: 0, y: 0, z: 0 },
  radiusPc: 25,
}, {
  attributes: ['position', 'magAbs', 'teffLog8'],
})) {
  if (delta.type === 'stars/cells-upsert') {
    cells += delta.cells.length;
    const count = delta.cells.reduce((sum, cell) => sum + cell.count, 0);
    stars += count;
    console.log(`cells ${cells}: ${count} stars`);
  }
  if (delta.type === 'stars/current') {
    console.log(`current: ${stars} stars across ${cells} cells`);
    break;
  }
}
