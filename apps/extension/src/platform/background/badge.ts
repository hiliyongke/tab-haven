import { browser } from 'wxt/browser';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { t } from '@/i18n/headless';
import { cachedSettings } from './shared';
import { logDegraded } from '@/platform/diagnostics';
import { createSerialChain } from '@/core/util/concurrency';

let badgeTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * 临时角标覆盖（如「整理完成」打勾）及其到期时间。
 *
 * 覆盖态自带到期时间是刻意的：SW 被回收时裸 setTimeout 会被吞掉，覆盖态若只靠
 * 定时器清除，角标会永久停在覆盖文案上。改为「到期时间 + 每次刷新时判定」后，
 * 只要之后发生任意一次刷新就会回到真实状态。
 */
let badgeOverride: { text: string; color: string; until: number } | undefined;
let overrideTimer: ReturnType<typeof setTimeout> | undefined;

/** 显示一段临时角标（覆盖当前设置的计算结果），到期后自动恢复。 */
export function showBadgeOverride(text: string, color: string, holdMs: number): void {
  badgeOverride = { text, color, until: Date.now() + holdMs };
  if (overrideTimer) clearTimeout(overrideTimer);
  overrideTimer = setTimeout(() => {
    overrideTimer = undefined;
    badgeOverride = undefined;
    void refreshBadge();
  }, holdMs);
  void refreshBadge();
}

/**
 * 角标写入串行链（多源并发刷新时防交错）。
 *
 * 与 `contextMenus` / `windowCache` 同口径：角标刷新有多个并发来源（标签事件回调、
 * 覆盖态到期回调、冷启动补刷），`setBadgeText` / `setTitle` 若交错执行，最终角标
 * 会停留在「先发起但后落地」的那次结果上，而不是最后一次输入的计算结果。
 */
const badgeChain = createSerialChain();

/** 单次角标刷新的执行体（串行链内执行，不自行并发）。 */
async function runRefreshBadge(): Promise<void> {
  if (!browser.action) return;
  if (badgeOverride && Date.now() >= badgeOverride.until) badgeOverride = undefined;
  if (badgeOverride) {
    await browser.action.setBadgeText({ text: badgeOverride.text }).catch(() => {});
    await browser.action.setBadgeBackgroundColor({ color: badgeOverride.color }).catch(() => {});
    return;
  }
  // 关模式：直接清空角标并跳过全量 tabs.query（避免每次标签事件都查全量标签）。
  if (cachedSettings.badgeMode === 'off') {
    await browser.action.setBadgeText({ text: '' }).catch(() => {});
    return;
  }
  try {
    const tabs = await browser.tabs.query({ windowType: 'normal' });
    const total = tabs.length;
    const dupGroups = new Set<string>();
    const seen = new Set<string>();
    for (const tab of tabs) {
      // 与全应用统一的 webComparisonKey 归一化口径（导航中取 pendingUrl，非 web 页跳过），
      // 保证角标重复组数与面板统计一致。
      const key = webComparisonKey(tab.url, tab.pendingUrl);
      if (!key) continue;
      if (seen.has(key)) dupGroups.add(key);
      seen.add(key);
    }
    const discarded = tabs.filter((tab) => tab.discarded).length;
    // 显式标注 string：TS 会因开头的 early-return 把 cachedSettings.badgeMode
    // 收窄为排除 'off' 的联合，而 await 期间它确实可能被改回 off。
    const mode: string = cachedSettings.badgeMode;
    const dupCount = dupGroups.size;
    // 全量查询期间模式可能被改成 off：必须重新判定，否则会落入 auto 分支
    // 在「角标已关闭」的状态下重新点亮它。
    if (mode === 'off') {
      await browser.action.setBadgeText({ text: '' }).catch(() => {});
      return;
    }
    let text = '';
    let color = '#6366f1';
    if (mode === 'dups') {
      text = dupCount > 0 ? String(Math.min(dupCount, 999)) : '';
      color = '#dc2626';
    } else if (mode === 'count') {
      text = total > 0 ? String(Math.min(total, 999)) : '';
    } else if (dupCount > 0) {
      // auto：有重复时优先展示重复组数（警示），否则展示标签总数
      text = String(Math.min(dupCount, 999));
      color = '#dc2626';
    } else {
      text = total > 0 ? String(Math.min(total, 999)) : '';
    }
    await browser.action.setBadgeText({ text });
    await browser.action.setBadgeBackgroundColor({ color });
    await browser.action.setTitle({
      title: t('共 {{total}} 个标签 · {{dups}} 组重复 · {{discarded}} 个已休眠', {
        total,
        dups: dupCount,
        discarded
      })
    });
  } catch (error) {
    logDegraded('badge', '工具栏角标更新失败', error);
    // badge 不可用时静默（不阻塞其他功能）
  }
}

/** 刷新角标：按 badgeMode 计算当前窗口重复标签数（并发调用串行执行）。 */
function refreshBadge(): Promise<void> {
  // 链尾统一兜底：调用方均以 `void refreshBadge()` 触发，无人接 rejection。
  return badgeChain.enqueueSettled(runRefreshBadge, (error) => {
    logDegraded('badge', '工具栏角标更新失败', error);
  });
}

/** 防抖窗口：标签事件连续触发时合并为一次全量查询。 */
const BADGE_DEBOUNCE_MS = 500;

/** 防抖刷新角标（事件高频时合并）。 */
function refreshBadgeSoon(): void {
  if (badgeTimer) return;
  badgeTimer = setTimeout(() => {
    badgeTimer = undefined;
    void refreshBadge();
  }, BADGE_DEBOUNCE_MS);
}

export { refreshBadge, refreshBadgeSoon };
