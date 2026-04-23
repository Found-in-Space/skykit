export {
  DatasetSession,
  createDataset,
  deriveMetaOctreeUrlFromRenderUrl,
  getDatasetSession,
  resolveFoundInSpaceDatasetOverrides,
  unwrapDatasetSession,
  DEFAULT_FOUND_IN_SPACE_META_OCTREE_URL,
  DEFAULT_FOUND_IN_SPACE_OCTREE_URL,
} from '../index.js';
import type {
  CommandBase,
  DatasetCommand,
  DatasetEvent,
  DatasetHandle,
  DatasetSnapshot,
  EventBase,
  FoundInSpaceDatasetCreateOptions,
  HookMap,
  SkyKitBuiltinHookMap,
} from '../types/public.js';
export type * from '../types/public.js';

export { createFoundInSpaceDatasetOptions } from '../index.js';

export declare function createFoundInSpaceDataset<
  TExtraCommand extends CommandBase = never,
  TExtraEvent extends EventBase<DatasetSnapshot> = never,
  THookMap extends HookMap<DatasetSnapshot, DatasetCommand | TExtraCommand, DatasetEvent<TExtraEvent>> = SkyKitBuiltinHookMap<DatasetSnapshot, DatasetCommand | TExtraCommand, DatasetEvent<TExtraEvent>>,
>(
  options?: FoundInSpaceDatasetCreateOptions,
): DatasetHandle<TExtraCommand, TExtraEvent, THookMap>;
