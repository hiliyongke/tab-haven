import { browser } from 'wxt/browser';
import { type Settings } from '@/core/schema/models';
import { canSafelyDiscardTab } from '@/core/tab-types';
import { mapTab } from '@/platform/tabs';
import { readSession } from '@/platform/storage/session';
import { autoDiscardRepository, settingsRepository } from '@/platform/storage/repositories';
import { AutoDiscardedMessageSchema } from '@/platform/messages';
import { t } from '@/i18n/headless';
import { cachedSettings, hostnameOf, isWhitelisted, notifyUser } from './shared';

// ---------------------------------------------------------------------------
// 自动休眠：白名单 + 台账 + 通知（可撤销）
// ---------------------------------------------------------------------------

async function recordAutoDiscardBatch(tabIds: number[]): Promise<void> {
  if (tabIds.length === 0) return;
  await autoDiscardRepository.write({ tabIds, at: Date.now(), count: tabIds.length });
  if (cachedSettings.discardNotifyEnabled) {
    // 通知文案走 headless i18n 轨道（语言决策链与 UI 一致）。
    notifyUser('TabHaven', t('bg.autoDiscarded', { count: tabIds.length }));
  }
  const message = AutoDiscardedMessageSchema.parse({
    type: 'auto-discarded',
    tabIds,
    count: tabIds.length,
    at: Date.now()
  });
  browser.runtime.sendMessage(message).catch(() => {});
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
  } catch {
    // 读取失败保持现状
  }
}

/** 自动休眠一轮：白名单 + 安全判定 + 台账。 */
const runAutoDiscard = async (): Promise<void> => {
  try {
    const settings = await settingsRepository.read();
    if (!settings.autoDiscardEnabled) return;
    const [tabs, session] = await Promise.all([browser.tabs.query({ windowType: 'normal' }), readSession()]);
    const boundTabIds = new Set(Object.values(session.itemTabBindings));
    const whitelist = settings.discardWhitelist;
    const cutoff = Date.now() - settings.autoDiscardMinutes * 60_000;
    const discardedIds: number[] = [];
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
      if (host && isWhitelisted(host, whitelist)) continue;
      const ok = await browser.tabs.discard(tab.id).then(() => true).catch(() => false);
      if (ok) discardedIds.push(tab.id);
    }
    if (discardedIds.length > 0) await recordAutoDiscardBatch(discardedIds);
    await pruneAutoDiscardBatch();
  } catch {
    // 忽略：下次闹钟自动重试
  }
};

/** 按设置创建/清除自动休眠闹钟：关闭时不保留闹钟，避免每分钟空跑唤醒 SW。 */
async function syncAutoDiscardAlarm(settings: Settings): Promise<void> {
  try {
    if (settings.autoDiscardEnabled) {
      // periodInMinutes 最小为 1；同名闹钟重复创建即重置，幂等安全。
      await browser.alarms.create('tabhaven-auto-discard', { periodInMinutes: 1 });
    } else {
      await browser.alarms.clear('tabhaven-auto-discard');
    }
  } catch {
    // alarms 不可用时忽略
  }
}

/** 休眠当前窗口全部非激活、可安全丢弃的标签（含台账与通知）。 */
async function discardInactiveTabs(): Promise<void> {
  const [tabs, session] = await Promise.all([browser.tabs.query({ currentWindow: true }), readSession()]);
  // 与 runAutoDiscard / 面板 UI 同一安全集：固定空间绑定的标签永不休眠。
  const boundTabIds = new Set(Object.values(session.itemTabBindings));
  const targets: number[] = [];
  for (const rawTab of tabs) {
    const tab = mapTab(rawTab);
    if (tab.id >= 0 && !boundTabIds.has(tab.id) && canSafelyDiscardTab(tab)) targets.push(tab.id);
  }
  const discardedIds: number[] = [];
  for (const tabId of targets) {
    const ok = await browser.tabs.discard(tabId).then(() => true).catch(() => false);
    if (ok) discardedIds.push(tabId);
  }
  if (discardedIds.length === 0) return;
  await recordAutoDiscardBatch(discardedIds);
}

export { runAutoDiscard, discardInactiveTabs, syncAutoDiscardAlarm };
