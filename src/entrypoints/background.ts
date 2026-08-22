import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { duplicateAllowanceKey, findReuseTarget } from '@/core/dupes';
import type { TabRecord } from '@/core/tab-types';
import { comparableUrl, isBlankStartUrl, isReusableUrl } from '@/core/url';
import { AllowDuplicateOnceMessageSchema, DuplicateReusedMessageSchema } from '@/platform/messages';
import { mapTab } from '@/platform/tabs';

/**
 * Service Worker：重复标签复用引擎（从 Tabstead background.js 完整移植）。
 *
 * 职责（docs/ARCHITECTURE.md 5.6）：
 *  - 新开标签 URL 与当前窗口已有标签相同时：激活已有标签并关闭新标签；
 *  - 10 秒 TTL 豁免白名单：显式复制/撤销恢复时放行副本；
 *  - 无痕窗口完全排除。
 *
 * 引擎状态为内存态（MV3 SW 随时终止，基线已验证该范式）：
 * pendingNewTabs 追踪新建标签、allowedDuplicateCreates 为 TTL 豁免白名单。
 */

const ALLOW_DUPLICATE_TTL_MS = 10_000;

interface PendingTabState {
  latestTab: TabRecord;
  checking: boolean;
  needsCheck: boolean;
}

interface DuplicateAllowance {
  count: number;
  expiresAt: number;
}

export default defineBackground(() => {
  const pendingNewTabs = new Map<number, PendingTabState>();
  const allowedDuplicateCreates = new Map<string, DuplicateAllowance>();

  const enableActionClick = () => {
    if (browser.sidePanel?.setPanelBehavior) {
      browser.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error(error));
    }
  };

  function cleanExpiredAllowances(): void {
    const now = Date.now();
    for (const [key, allowance] of allowedDuplicateCreates) {
      if (allowance.expiresAt <= now || allowance.count <= 0) {
        allowedDuplicateCreates.delete(key);
      }
    }
  }

  function allowDuplicateOnce(windowId: number, url: string): void {
    cleanExpiredAllowances();
    const key = duplicateAllowanceKey(windowId, url);
    const allowance = allowedDuplicateCreates.get(key) || { count: 0, expiresAt: 0 };
    allowance.count += 1;
    allowance.expiresAt = Date.now() + ALLOW_DUPLICATE_TTL_MS;
    allowedDuplicateCreates.set(key, allowance);
  }

  function consumeDuplicateAllowance(windowId: number, url: string): boolean {
    cleanExpiredAllowances();
    const key = duplicateAllowanceKey(windowId, url);
    const allowance = allowedDuplicateCreates.get(key);
    if (!allowance) return false;

    allowance.count -= 1;
    if (allowance.count <= 0) {
      allowedDuplicateCreates.delete(key);
    } else {
      allowedDuplicateCreates.set(key, allowance);
    }
    return true;
  }

  async function reuseExistingTabIfNeeded(tab: TabRecord): Promise<void> {
    const state = pendingNewTabs.get(tab.id);
    if (!state || tab.incognito) {
      pendingNewTabs.delete(tab.id);
      return;
    }

    const url = comparableUrl(tab);
    if (!isReusableUrl(url)) {
      if (tab.status === 'complete' && !isBlankStartUrl(url)) {
        pendingNewTabs.delete(tab.id);
      }
      return;
    }

    if (consumeDuplicateAllowance(tab.windowId, url)) {
      pendingNewTabs.delete(tab.id);
      return;
    }

    const windowTabs = await browser.tabs.query({ windowId: tab.windowId });
    const records = windowTabs.map(mapTab);
    const matchingTabs = records.filter((candidate) => comparableUrl(candidate) === url);
    const reuseTarget = findReuseTarget(matchingTabs, tab.id, new Set(pendingNewTabs.keys()));

    if (!reuseTarget) {
      if (tab.status === 'complete') pendingNewTabs.delete(tab.id);
      return;
    }

    await browser.tabs.update(reuseTarget.id, { active: true });
    await browser.tabs.remove(tab.id);
    pendingNewTabs.delete(tab.id);
    const notification = DuplicateReusedMessageSchema.parse({ type: 'duplicate-reused' });
    browser.runtime.sendMessage(notification).catch(() => {});
  }

  function queueDuplicateCheck(tab: TabRecord): void {
    const state = pendingNewTabs.get(tab.id);
    if (!state) return;

    state.latestTab = tab;
    if (state.checking) {
      state.needsCheck = true;
      return;
    }

    state.checking = true;
    Promise.resolve()
      .then(async () => {
        do {
          state.needsCheck = false;
          await reuseExistingTabIfNeeded(state.latestTab);
        } while (pendingNewTabs.has(tab.id) && state.needsCheck);
      })
      .catch(console.error)
      .finally(() => {
        state.checking = false;
      });
  }

  browser.tabs.onCreated.addListener((tab) => {
    if (tab.incognito) return;
    const record = mapTab(tab);
    pendingNewTabs.set(record.id, {
      latestTab: record,
      checking: false,
      needsCheck: false
    });
    queueDuplicateCheck(record);
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!pendingNewTabs.has(tabId)) return;
    if (!changeInfo.url && !changeInfo.status) return;
    queueDuplicateCheck(mapTab(tab));
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    pendingNewTabs.delete(tabId);
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const parsed = AllowDuplicateOnceMessageSchema.safeParse(message);
    if (!parsed.success) return;
    const { windowId, url } = parsed.data;
    if (!isReusableUrl(url)) {
      sendResponse({ ok: false });
      return;
    }
    allowDuplicateOnce(windowId, url);
    sendResponse({ ok: true });
  });

  browser.runtime.onInstalled.addListener(() => {
    enableActionClick();
  });
  browser.runtime.onStartup.addListener(() => {
    enableActionClick();
  });
  enableActionClick();
});
