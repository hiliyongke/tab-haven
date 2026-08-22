import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { mapTab } from '@/platform/tabs';
import { ReuseCoordinator } from '@/platform/reuse/ReuseCoordinator';
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
});
