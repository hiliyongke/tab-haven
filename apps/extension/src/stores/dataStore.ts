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
 * 组合根：共享写入/降级/镜像/监视器逻辑在 `data/context.ts`，业务动作按领域拆为各 Slice。
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
    // null = 本次会话还没拉取过镜像（已 seeded 的设备不拉取，状态行不渲染）
    mirrorIssue: null,
    mirrorWriteFailed: false,
    mirrorQuotaExceeded: false,
    importing: false,
    ready: false,

    ...createInitSlice(ctx),
    ...createFolderSlice(ctx),
    ...createPinsSlice(ctx),
    ...createSettingsSlice(ctx),
    ...createTransferSlice(ctx)
  };
  // 刻意不加 `as DataState`：各切片的 `DataSlice<...>` 声明自身提供的键，
  // 完备性由编译器兜住；加断言会让「漏挂某切片」退化为运行时 `xxx is not a function`。
});
