import { create } from 'zustand';
import type { ReadLaterItem } from '@/core/schema/models';
import { readLaterRepository } from '@/platform/storage/repositories';
import { applyAddItem, mutateReadLater } from '@/platform/readlater/readLaterOps';
import { logFailure } from '@/platform/diagnostics';

/**
 * 稍后读 store：独立于固定文件夹的「一次性消费」暂存区。
 *
 * 语义与固定文件夹的差别：文件夹是长期资产（整理、分组、导出），
 * 稍后读是短周期队列（未读点 → 读完成灰 → 7 天未读提示归档进快照）。
 * 数据经 readLaterRepository 落盘（tabs.read-later.v1），不参与同步镜像。
 *
 * 全部写操作经 `platform/readlater/readLaterOps`：跨页锁内「重读 → 合并 → 写」
 * （面板操作与 background 右键菜单并发写入时，锁外合并会互相覆盖），
 * 且 SW 与面板共用同一份语义。
 */

interface ReadLaterState {
  items: ReadLaterItem[];
  ready: boolean;

  /** 拉取列表并订阅仓库变更（右键菜单在 background 写入后面板自动感知）。 */
  load: () => Promise<void>;
  /**
   * 暂存一个标签（同 URL 去重；已读条目重新变未读并刷新时间）。
   * 返回是否落盘成功：失败时调用方必须如实提示，不能报「已加入」。
   */
  addItem: (entry: { url: string; title: string; favIconUrl?: string }) => Promise<boolean>;
  markRead: (id: string) => Promise<boolean>;
  markAllRead: () => Promise<boolean>;
  removeItem: (id: string) => Promise<boolean>;
  /** 清空指定条目集合（归档后调用）。 */
  removeItems: (ids: readonly string[]) => Promise<boolean>;
}

let watcherStarted = false;
/** watch 的注销函数：仓库被测试替换后需要可复位，否则 watcher 仍指向旧仓库。 */
let watcherDispose: (() => void) | undefined;

/**
 * 锁内重读合并写（跨页并发安全）。
 * 返回是否落盘成功——与 addEntryToFolder 同口径：写失败时报成功会让用户以为
 * 数据已存，重启即丢。
 */
async function mergeWrite(apply: (current: ReadLaterItem[]) => ReadLaterItem[]): Promise<boolean> {
  const ok = await mutateReadLater(apply);
  if (!ok) {
    logFailure('readLater', '稍后读写入失败（quota 超限或存储不可用）');
  }
  return ok;
}

/** 复位 watcher（测试注入仓库时使用）。 */
export function __resetReadLaterWatcherForTest(): void {
  watcherDispose?.();
  watcherDispose = undefined;
  watcherStarted = false;
}

export const useReadLaterStore = create<ReadLaterState>()((set) => ({
  items: [],
  ready: false,

  load: async () => {
    if (!watcherStarted) {
      watcherStarted = true;
      watcherDispose = readLaterRepository.watch((value) =>
        useReadLaterStore.setState({ items: value })
      );
    }
    set({ items: await readLaterRepository.read(), ready: true });
  },

  addItem: async (entry) => {
    // 去重/重暂存/危险 URL 判定全部在 platform/readlater（与 background 右键共用）。
    return mergeWrite((current) => applyAddItem(current, entry));
  },

  markRead: async (id) =>
    mergeWrite((current) =>
      current.map((item) => (item.id === id ? { ...item, readAt: Date.now() } : item))
    ),

  markAllRead: async () => {
    const now = Date.now();
    return mergeWrite((current) =>
      current.map((item) => (item.readAt === undefined ? { ...item, readAt: now } : item))
    );
  },

  removeItem: async (id) => mergeWrite((current) => current.filter((item) => item.id !== id)),

  removeItems: async (ids) => {
    const idSet = new Set(ids);
    return mergeWrite((current) => current.filter((item) => !idSet.has(item.id)));
  }
}));
