export const OCTREE_c56103 =
  'https://data.foundin.space/c56103e6-ad4c-41f9-be06-048b48ec632b/stars.octree';
export const OCTREE_82d9da =
  'https://data.foundin.space/82d9da64-0024-4485-9ac1-dd39ce9f7f08/stars.octree';
export const OCTREE_DEFAULT = OCTREE_c56103;

export {
  createStarOctreeFileProviderService,
  createStarOctreeProviderService,
} from './star-octree-provider-service.js';

export {
  streamVolumeCells,
  warmVolumeRequests,
} from './star-octree-strategies.js';
