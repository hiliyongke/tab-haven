import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { getRepositories } from '@/platform/registry';
import { buildDataContext } from './data/context';
import { createInitSlice } from './data/initSlice';
import { createFolderSlice } from './data/folderSlice';
import { createPinsSlice } from './data/pinsSlice';
import { createSettingsSlice } from './data/settingsSlice';
import { createTransferSlice } from './data/transferSlice';
import type { AddTabsToFolderResult, DataState } from './data/types';

export type { AddTabsToFolderResult, DataState };

/**
 * 固定空间数据 store：文件夹、常驻磁贴、设置、折叠状态。
 * 持久化经 DataRepository（chrome.storage.local + zod + 坏数据隔离）。
 *
 * 该文件为组合根：共享的写入/降级/镜像/监视器逻辑集中在 `data/context.ts`，
 * 业务动作按领域拆为 `data/{init,folder,pins,settings,transfer}Slice.ts`，
 * 对外 `useDataStore` 接口与单体时代完全一致。
 */
export const useDataStore = create<DataState>()((set, get) => {
  const repos = getRepositories();
  const ctx = buildDataContext(set, get, repos);

  return {
    folders: [],
    pins: [],
    collapsedSites: [],
    settings: DEFAULT_SETTINGS,
    boundTabIds: [],
    storageDegraded: false,
    importing: false,
    ready: false,

    ...createInitSlice(ctx),
    ...createFolderSlice(ctx),
    ...createPinsSlice(ctx),
    ...createSettingsSlice(ctx),
    ...createTransferSlice(ctx)
  } as DataState;
});
