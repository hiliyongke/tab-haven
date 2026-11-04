import { browser } from 'wxt/browser';
import type { TabRecord } from '@/core/tab-types';
import { toUndoTabRecord } from '@/core/undo/UndoStack';
import { newId } from '@/core/util/id';
import { t } from '@/i18n/headless';
import { logDegraded } from '@/platform/diagnostics';
import { REUSE_CLOSED_LIMIT, sendMessageWithDelivery } from '@/platform/messages';
import { getTab, moveTab, queryWindowTabs } from '@/platform/tabs';
import { setActionClickBehavior } from '@/platform/sidePanel';
import { settingsRepository } from '@/platform/storage/repositories';
import { persistReuseClosedBatch } from '@/platform/reuse/persistClosed';
import {
  removeReuseClosedBatch,
  waitForReuseClosedAck,
  writeReuseClosedShards
} from '@/platform/reuse/reuseClosedPending';
import type { AddEntryResult } from '@/platform/background/contextMenus';
import { getLastActiveTabId } from '@/platform/background/windowCache';
import { notifyUser } from '@/platform/background/shared';

/** 窗口缓存关心的 onUpdated 字段（与 windowCache collectTabs 采集口径一致）。 */
export const WINDOW_CACHE_UPDATE_KEYS = [
  'url',
  'title',
  'favIconUrl',
  'pinned',
  'mutedInfo',
  'groupId'
];

/** 自动分组关心的 onUpdated 字段（域名就绪 / 入组状态 / 固定状态变化才重新对账）。 */
export const AUTO_GROUP_UPDATE_KEYS = ['url', 'pendingUrl', 'groupId', 'pinned', 'status'];

// 「整理完成」角标的色值只能写死：chrome.action 的 badge 背景色只接受 CSS 颜色字符串。
export const BADGE_DONE_COLOR = '#16a34a';
export const BADGE_DONE_TTL_MS = 1500;

/** 复用关闭的标签快照回传面板登记撤销（与 notifyReuse 分开：撤销登记不受提示开关影响）。 */
export function reportReuseClosed(windowId: number, closed: readonly TabRecord[]): void {
  void (async () => {
    // 组名必须随快照回传：只有 groupId 而没有组名做校验会误入被浏览器复用的组 id。
    // 查询失败不得伪装成「没有组」，否则恢复侧只能盲入旧 id。降级但必须留痕。
    const groups = await browser.tabGroups.query({ windowId }).catch((error) => {
      logDegraded('background', `窗口 ${windowId} 原生组查询失败，撤销记录缺组名`, error);
      return [];
    });
    const groupNameById = new Map(groups.map((group) => [group.id, group.title]));
    const records = closed.map((tab) => toUndoTabRecord(tab, groupNameById));
    const batchId = newId('reuse');
    const at = Date.now();
    const shardCount = Math.max(1, Math.ceil(records.length / REUSE_CLOSED_LIMIT));
    const shards = Array.from({ length: shardCount }, (_, shardIndex) => ({
      batchId,
      windowId,
      records: records.slice(
        shardIndex * REUSE_CLOSED_LIMIT,
        (shardIndex + 1) * REUSE_CLOSED_LIMIT
      ),
      shardIndex,
      shardCount,
      at
    }));
    try {
      await writeReuseClosedShards(shards);
    } catch (error) {
      logDegraded('background', '复用关闭撤销台账写入失败，直接补登记撤销库', error);
      const persisted = await persistReuseClosedBatch(windowId, records).catch(() => false);
      if (!persisted) logDegraded('background', '复用关闭撤销批次补登记失败');
      return;
    }
    const acknowledged = waitForReuseClosedAck(batchId);
    let delivered = true;
    try {
      for (const shard of shards) {
        await sendMessageWithDelivery({
          type: 'reuse-closed',
          windowId,
          batchId,
          tabs: shard.records,
          shardIndex: shard.shardIndex,
          shardCount
        });
      }
    } catch (error) {
      delivered = false;
      logDegraded('background', '复用关闭分片投递失败', error);
    }
    const confirmed = delivered && (await acknowledged);
    if (confirmed) {
      await removeReuseClosedBatch(batchId, shardCount).catch((error) =>
        logDegraded('background', '复用关闭撤销台账清理失败', error)
      );
      return;
    }
    const persisted = await persistReuseClosedBatch(windowId, records, batchId).catch(() => false);
    if (persisted) {
      await removeReuseClosedBatch(batchId, shardCount).catch(() => undefined);
    } else {
      logDegraded('background', '无面板补登记复用撤销批次失败，台账保留供下次重试');
    }
  })();
}

/**
 * 工具栏图标点击行为（settings.actionClickMode）：panel 直接打开侧边栏；regroup 后台整理。
 * setPanelBehavior 不跨会话持久，每次唤醒/设置变更都要对齐一次；读实时设置避开缓存未就绪窗口。
 */
export async function syncActionClickBehavior(): Promise<void> {
  try {
    const settings = await settingsRepository.readStrict();
    await setActionClickBehavior(settings.actionClickMode !== 'regroup');
  } catch (error) {
    logDegraded('background', '读取工具栏点击行为失败，保持当前行为不变', error);
  }
}

/**
 * 全局「新建标签位置」（settings.newTabPosition）：'after-active' 模式下把新标签移到上一激活
 * 标签之后。锚点用 onActivated 维护的最近激活标签——onCreated 时新标签已被 Chrome 激活。
 */
export async function enforceNewTabPosition(tab: {
  id?: number;
  windowId?: number;
  index?: number;
  pinned?: boolean;
}): Promise<void> {
  try {
    // 读实时设置而非共享缓存：SW 刚唤醒时缓存尚未就绪，首次新建会被按默认值放过。
    const settings = await settingsRepository.read();
    if (settings.newTabPosition !== 'after-active') return;
    if (tab.id === undefined || tab.windowId === undefined) return;
    if (tab.pinned) return;
    let anchorId = getLastActiveTabId(tab.windowId);
    if (anchorId === undefined) {
      // 冷启动锚点补种：取窗口中除新标签外的最后一个普通标签作为近似锚点。
      const siblings = await queryWindowTabs(tab.windowId);
      const fallback = siblings
        .filter((candidate) => candidate.id !== tab.id && !candidate.pinned)
        .sort((a, b) => (b.index ?? 0) - (a.index ?? 0))[0];
      if (typeof fallback?.id === 'number') anchorId = fallback.id;
    }
    if (anchorId === undefined || anchorId === tab.id) return;
    const anchor = await getTab(anchorId);
    if (!anchor || anchor.windowId !== tab.windowId || anchor.index === undefined) return;
    const target = anchor.index + 1;
    if (tab.index === target) return;
    await moveTab(tab.id, target, tab.windowId);
  } catch (error) {
    logDegraded('background', '新建标签位置调整失败', error);
  }
}

/**
 * 卸载挽留：卸载扩展会连同 chrome.storage.local 一起删除全部数据，必须提醒用户。
 * 硬约束：目标页随扩展打包到本地（public/uninstall-backup.html，样式内联，无外部资源）；
 * URL 不带任何查询参数——否则「用户卸载了」本身就被上报，构成事实上的遥测。
 */
export const registerUninstallUrl = (): void => {
  try {
    // setUninstallURL 只接受完整 URL；返回 Promise，rejection 需单独 .catch（不走同步 try）。
    void browser.runtime
      .setUninstallURL(browser.runtime.getURL('/uninstall-backup.html'))
      .catch((error) => {
        // 个别环境该 API 不可用：尽力而为，失败不影响主流程，但须留痕。
        logDegraded('background', '卸载挽留页注册失败，用户卸载时将不会看到数据备份提醒', error);
      });
  } catch (error) {
    logDegraded('background', '卸载挽留页注册失败（同步异常）', error);
  }
};

/** 右键「加入文件夹」结果反馈：三态各发一条（成功也要反馈，失败通知已由 addEntryToFolder 发出）。 */
export const notifyAddToFolderResult = (result: AddEntryResult): void => {
  if (result === 'failed') return;
  notifyUser('Tabs', t(result === 'added' ? '已保存到收藏夹文件夹' : '这个网址已经在文件夹里了'));
};
