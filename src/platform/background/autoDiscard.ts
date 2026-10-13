import { browser } from 'wxt/browser';
import { type Settings } from '@/core/schema/models';
import { canSafelyDiscardTab } from '@/core/tab-types';
import { mapTab } from '@/platform/tabs';
import { readSession } from '@/platform/storage/session';
import { settingsRepository } from '@/platform/storage/repositories';
import {
  appendAutoDiscardBatch,
  mutateAutoDiscardLedger,
  readAutoDiscardBatches
} from '@/platform/storage/autoDiscardLedger';
import { sendMessage } from '@/platform/messages';
import { t } from '@/i18n/headless';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from '@/core/util/concurrency';
import { buildWhitelistMatcher, cachedSettings, hostnameOf, notifyUser } from './shared';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 自动休眠闹钟名。
 *
 * 与 `AUTO_SNAPSHOT_ALARM`（autoSnapshot.ts）同口径：闹钟名一度是裸字符串，
 * 创建处与 `alarms.onAlarm` 的分发处各写一份，改名必漏一处（漏的那侧表现为
 * 「闹钟照响但功能不执行」，无任何报错）。集中为导出常量后两侧同源。
 */
export const AUTO_DISCARD_ALARM = 'tabs-auto-discard';

/**
 * 单个标签休眠：成功 true / 失败 false（不抛）。
 *
 * 并发映射里必须吞掉单次失败：一个标签因「正在播放音频 / 已激活 / 已被关闭」
 * 被浏览器拒绝就整批中止，其余可休眠标签会全部漏掉。
 */
async function discardSafely(tabId: number): Promise<boolean> {
  try {
    await browser.tabs.discard(tabId);
    return true;
  } catch {
    return false;
  }
}

/**
 * 追加一轮休眠台账（多批次保留，按 at 滚动淘汰最旧的）。
 *
 * 此前整表覆盖写（单槽位）：第二轮自动休眠会抹掉第一轮的 tabIds，而第一轮冻结的
 * 标签还没被唤醒 —— 「全部唤醒」于是只兜得住最近一轮，更早的批次永久失去出口。
 */
async function recordAutoDiscardBatch(tabIds: number[]): Promise<void> {
  if (tabIds.length === 0) return;
  const at = Date.now();
  // 走台账模块：追加是整表 RMW，必须与「面板全部唤醒」共用同一把跨页锁，
  // 否则两者并发时后写覆盖先写，刚写入的批次会被面板的整表写回抹掉。
  const persisted = await appendAutoDiscardBatch(tabIds, at);
  if (cachedSettings.discardNotifyEnabled) {
    // 通知文案走 headless i18n 轨道（语言决策链与 UI 一致）。
    notifyUser(
      'Tabs',
      t('已休眠 {{count}} 个标签（可在侧边栏一键唤醒）', { count: tabIds.length })
    );
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
    const batches = await readAutoDiscardBatches();
    if (batches.length === 0) return;
    const tabs = await browser.tabs.query({});
    const live = new Map(tabs.map((tab) => [tab.id, tab.discarded]));
    // 只保留「仍有标签处于休眠」的批次：已全部唤醒的批次留着会出现点了没反应的入口。
    // 与追加/摘除共用跨页锁内重读的磁盘基线，避免用过期快照整表覆盖。
    await mutateAutoDiscardLedger((disk) => {
      const kept = disk.filter((batch) => batch.tabIds.some((id) => live.get(id) === true));
      return kept.length === disk.length ? null : kept;
    });
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
    const outcomes = await mapWithConcurrency(targets, DEFAULT_CONCURRENCY, discardSafely);
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
      await browser.alarms.create(AUTO_DISCARD_ALARM, { periodInMinutes: 1 });
    } else {
      await browser.alarms.clear(AUTO_DISCARD_ALARM);
    }
  } catch (error) {
    logDegraded('auto-discard', '自动休眠唤醒失败', error);
    // alarms 不可用时忽略
  }
}

/** 休眠当前窗口全部后台标签、可安全丢弃的标签（含台账与通知）。 */
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
    const outcomes = await mapWithConcurrency(targets, DEFAULT_CONCURRENCY, discardSafely);
    const discardedIds = targets.filter((_tabId, index) => outcomes[index] === true);
    if (discardedIds.length === 0) return;
    await recordAutoDiscardBatch(discardedIds);
  } catch (error) {
    // 与 runAutoDiscard 同口径：查询失败等异常不得逃逸为 async 命令监听器的
    // unhandled rejection（浏览器级快捷键路径）。
    logDegraded('auto-discard', '休眠后台标签执行失败', error);
  }
}

export { runAutoDiscard, discardInactiveTabs, syncAutoDiscardAlarm };
