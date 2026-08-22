import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

/**
 * Service Worker 入口。
 *
 * V1.0 职责（见 docs/ARCHITECTURE.md 2.1 / 5.6）：
 *  - 重复标签复用引擎（移植 Tabstead：串行检查队列 + 10s TTL 豁免白名单）
 *  - commands 快捷键分发
 *  - 消息协议端点（allow-duplicate-once / duplicate-reused）
 *
 * 脚手架阶段仅落地 sidePanel 点击行为与消息端点占位，复用引擎随基线实现接入。
 */
export default defineBackground(() => {
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
