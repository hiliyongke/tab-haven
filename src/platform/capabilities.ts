import { browser } from 'wxt/browser';

/**
 * 运行时能力检测（FR-D10.1 形态路由的基础）。
 *
 * 注意：platform 层是唯一允许触碰 chrome.* 与 browser.* 的层；
 * 此处通过 wxt/browser 的统一 browser 命名空间访问。
 */
export function hasSidePanel(): boolean {
  return typeof browser.sidePanel !== 'undefined';
}

export function hasStorage(): boolean {
  return typeof browser.storage !== 'undefined' && Boolean(browser.storage.local);
}
