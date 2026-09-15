import { browser } from 'wxt/browser';
import { type Settings } from '@/core/schema/models';
import { canSafelyDiscardTab } from '@/core/tab-types';
import { mapTab } from '@/platform/tabs';
import { readSession } from '@/platform/storage/session';
import { autoDiscardRepository, settingsRepository } from '@/platform/storage/repositories';
import { sendMessage } from '@/platform/messages';
import { t } from '@/i18n/headless';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from '@/core/util/concurrency';
import { buildWhitelistMatcher, cachedSettings, hostnameOf, notifyUser } from './shared';
import { logDegraded } from '@/platform/diagnostics';

async function recordAutoDiscardBatch(tabIds: number[]): Promise<void> {
  if (tabIds.length === 0) return;
  const at = Date.now();
  const persisted = await autoDiscardRepository.write({ tabIds, at, count: tabIds.length });
  if (cachedSettings.discardNotifyEnabled) {
    // 通知文案走 headless i18n 轨道（语言决策链与 UI 一致）。
    notifyUser('Tabs', t('bg.autoDiscarded', { count: tabIds.length }));
  }
  if (!persisted) {
    // 台账未落盘：撤销入口会指向不存在的批次，故不发带 tabIds 的「可撤销」消息
    // （标签本身确实已休眠，通知照发）。写失败当成功上报会让「全部唤醒」点不动。
    logDegraded('auto-discard', '自动休眠台账写入失败，本次批次不支持撤销');
    return;
  }
  sendMessage({ type: 'auto-discarded', tabIds, count: tabIds.length, at });
}

/** 清理已失效的自动休眠台账（批次标签全部不存在或已唤醒）。 */
async function pruneAutoDiscardBatch(): Promise<void> {
  try {
    const batch = await autoDiscardRepository.read();
    if (!batch) return;
    const tabs = await browser.tabs.query({});
    const live = new Map(tabs.map((tab) => [tab.id, tab.discarded]));
    const anyStillDiscarded = batch.tabIds.some((id) => live.get(id) === true);
    if (!anyStillDiscarded) await autoDiscardRepository.write(null);
  } catch (error) {
    logDegraded('auto-discard', '自动休眠扫描失败', error);
    // 读取失败保持现状
  }
}

/** 自动休眠一轮：白名单 + 安全判定 + 台账。 */
const runAutoDiscard = async (): Promise<void> => {
  try {
    const settings = await settingsRepository.read();
    if (!settings.autoDiscardEnabled) return;
    const [tabs, session] = await Promise.all([
      browser.tabs.query({ windowType: 'normal' }),
      readSession()
    ]);
    const boundTabIds = new Set(Object.values(session.itemTabBindings));
    // 白名单归一化只做一次（原实现对每个标签×每个条目重复 3 次正则）。
    const isWhitelistedHost = buildWhitelistMatcher(settings.discardWhitelist);
    const cutoff = Date.now() - settings.autoDiscardMinutes * 60_000;
    const targets: number[] = [];
    for (const rawTab of tabs) {
      const tab = mapTab(rawTab);
      if (
        tab.id < 0 ||
        boundTabIds.has(tab.id) ||
        typeof tab.lastAccessed !== 'number' ||
        !canSafelyDiscardTab(tab) ||
        tab.lastAccessed >= cutoff
      ) {
        continue;
      }
      const host = hostnameOf(tab.url);
      if (host && isWhitelistedHost(host)) continue;
      targets.push(tab.id);
    }
    // 有限并发：严格串行下每个 tabs.discard 一次 IPC 往返，数百个标签会让 SW
    // 在每轮闹钟里长时间被占满（且 alarms 是每分钟触发的兜底链路）。
    const outcomes = await mapWithConcurrency(targets, DEFAULT_CONCURRENCY, (tabId) =>
      browser.tabs
        .discard(tabId)
        .then(() => true)
        .catch(() => false)
    );
    const discardedIds = targets.filter((_tabId, index) => outcomes[index] === true);
    if (discardedIds.length > 0) await recordAutoDiscardBatch(discardedIds);
    await pruneAutoDiscardBatch();
  } catch (error) {
    logDegraded('auto-discard', '自动休眠执行失败', error);
    // 忽略：下次闹钟自动重试
  }
};

/** 按设置创建/清除自动休眠闹钟：关闭时不保留闹钟，避免每分钟空跑唤醒 SW。 */
async function syncAutoDiscardAlarm(settings: Settings): Promise<void> {
  try {
    if (settings.autoDiscardEnabled) {
      // periodInMinutes 最小为 1；同名闹钟重复创建即重置，幂等安全。
      await browser.alarms.create('tabs-auto-discard', { periodInMinutes: 1 });
    } else {
      await browser.alarms.clear('tabs-auto-discard');
    }
  } catch (error) {
    logDegraded('auto-discard', '自动休眠唤醒失败', error);
    // alarms 不可用时忽略
  }
}

/** 休眠当前窗口全部非激活、可安全丢弃的标签（含台账与通知）。 */
async function discardInactiveTabs(): Promise<void> {
  try {
    const [tabs, session] = await Promise.all([
      browser.tabs.query({ currentWindow: true }),
      readSession()
    ]);
    // 与 runAutoDiscard / 面板 UI 同一安全集：固定空间绑定的标签永不休眠。
    const boundTabIds = new Set(Object.values(session.itemTabBindings));
    const targets: number[] = [];
    for (const rawTab of tabs) {
      const tab = mapTab(rawTab);
      if (tab.id >= 0 && !boundTabIds.has(tab.id) && canSafelyDiscardTab(tab)) targets.push(tab.id);
    }
    // 与 runAutoDiscard 同口径：有限并发，避免数百次串行 IPC 往返。
    const outcomes = await mapWithConcurrency(targets, DEFAULT_CONCURRENCY, (tabId) =>
      browser.tabs
        .discard(tabId)
        .then(() => true)
        .catch(() => false)
    );
    const discardedIds = targets.filter((_tabId, index) => outcomes[index] === true);
    if (discardedIds.length === 0) return;
    await recordAutoDiscardBatch(discardedIds);
  } catch (error) {
    // 与 runAutoDiscard 同口径：查询失败等异常不得逃逸为 async 命令监听器的
    // unhandled rejection（浏览器级快捷键路径）。
    logDegraded('auto-discard', '休眠非激活标签执行失败', error);
  }
}

export { runAutoDiscard, discardInactiveTabs, syncAutoDiscardAlarm };
