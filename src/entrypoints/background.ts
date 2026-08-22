import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { canSafelyDiscardTab } from '@/core/tab-types';
import { mapTab } from '@/platform/tabs';
import { ReuseCoordinator } from '@/platform/reuse/ReuseCoordinator';
import { settingsRepository } from '@/platform/storage/repositories';
import {
  AllowDuplicateOnceMessageSchema,
  DuplicateReusedMessageSchema,
  SearchFocusMessageSchema
} from '@/platform/messages';

/**
 * Service Worker 入口（全新设计，复用协调器见 platform/reuse）。
 *
 * 职责：
 *  - 把 tabs 生命周期事件接入 ReuseCoordinator（重复标签自动复用）；
 *  - 处理 UI 的豁免授权请求（allow-duplicate-once）；
 *  - 点击图标打开侧边栏（sidePanel 形态）。
 */

export default defineBackground(() => {
  const coordinator = new ReuseCoordinator({
    scanWindow: async (windowId) => {
      const tabs = await browser.tabs.query({ windowId });
      return tabs.map(mapTab);
    },
    activate: (tabId) => browser.tabs.update(tabId, { active: true }).then(() => undefined),
    close: (tabId) => browser.tabs.remove(tabId),
    notifyReuse: () => {
      const notification = DuplicateReusedMessageSchema.parse({ type: 'duplicate-reused' });
      browser.runtime.sendMessage(notification).catch(() => {});
    }
  });

  // 同 URL 唯一化开关联动（设置存储在 chrome.storage.local）。
  const syncCoordinatorEnabled = async () => {
    try {
      const settings = await settingsRepository.read();
      coordinator.setEnabled(settings.uniqueUrlTabs);
    } catch {
      // 读取失败保持当前状态
    }
  };
  void syncCoordinatorEnabled();
  browser.storage?.local?.onChanged.addListener((changes) => {
    if (!changes['tabhaven.settings.v1']) return;
    void syncCoordinatorEnabled();
  });

  browser.tabs.onCreated.addListener((tab) => {
    coordinator.handleCreated(mapTab(tab));
  });
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    coordinator.handleUpdated(
      tabId,
      { url: Boolean(changeInfo.url), status: Boolean(changeInfo.status) },
      mapTab(tab)
    );
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    coordinator.handleRemoved(tabId);
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const parsed = AllowDuplicateOnceMessageSchema.safeParse(message);
    if (!parsed.success) return;
    const { windowId, url } = parsed.data;
    coordinator.grantAllowance(windowId, url);
    sendResponse({ ok: true });
  });

  // 浏览器级快捷键：聚焦搜索（FR-D2.2）
  browser.commands?.onCommand.addListener(async (command) => {
    if (command !== 'focus-search') return;
    if (browser.sidePanel?.open) {
      const [tab] = await browser.tabs.query({ currentWindow: true, active: true });
      if (tab?.windowId !== undefined) {
        await browser.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
      }
    }
    const message = SearchFocusMessageSchema.parse({ type: 'focus-search' });
    browser.runtime.sendMessage(message).catch(() => {});
  });

  const enableActionClick = () => {
    if (browser.sidePanel?.setPanelBehavior) {
      browser.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error(error));
    }
  };

  browser.runtime.onInstalled.addListener(() => {
    enableActionClick();
  });
  browser.runtime.onStartup.addListener(() => {
    enableActionClick();
  });
  enableActionClick();

  // 自动休眠：周期性冻结长时间未访问的非激活标签，释放内存（受设置开关控制）。
  // 使用 chrome.alarms 而非 setInterval：MV3 service worker 在空闲后会被浏览器回收，
  // setInterval 回调无法保证触发；alarms 由浏览器保活调度，即使 SW 回收到点也会重新拉起。
  const runAutoDiscard = async () => {
    try {
      const settings = await settingsRepository.read();
      if (!settings.autoDiscardEnabled) return;
      const tabs = await browser.tabs.query({
        windowType: 'normal'
      });
      const cutoff = Date.now() - settings.autoDiscardMinutes * 60_000;
      for (const rawTab of tabs) {
        const tab = mapTab(rawTab);
        if (
          tab.id >= 0 &&
          canSafelyDiscardTab(tab) &&
          (tab.lastAccessed ?? 0) < cutoff
        ) {
          await browser.tabs.discard(tab.id).catch(() => {});
        }
      }
    } catch {
      /* 忽略：下次闹钟自动重试 */
    }
  };
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'tabhaven-auto-discard') void runAutoDiscard();
  });
  // periodInMinutes 最小为 1；同名闹钟重复创建即重置，幂等安全。
  browser.alarms.create('tabhaven-auto-discard', { periodInMinutes: 1 }).catch(() => {});
});
