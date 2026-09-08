import { browser } from 'wxt/browser';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { t } from '@/i18n/headless';
import { cachedSettings } from './shared';
import { logDegraded } from '@/platform/diagnostics';

let badgeTimer: ReturnType<typeof setTimeout> | undefined;

/** 刷新角标：按 badgeMode 计算当前窗口重复标签数。 */
async function refreshBadge(): Promise<void> {
  if (!browser.action) return;
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
    const mode = cachedSettings.badgeMode;
    const dupCount = dupGroups.size;
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
      title: t('bg.badgeTitle', { total, dups: dupCount, discarded })
    });
  } catch (error) {
    logDegraded('badge', '工具栏角标更新失败', error);
    // badge 不可用时静默（不阻塞其他功能）
  }
}

/** 防抖刷新角标（事件高频时合并）。 */
function refreshBadgeSoon(): void {
  if (badgeTimer) return;
  badgeTimer = setTimeout(() => {
    badgeTimer = undefined;
    void refreshBadge();
  }, 500);
}

export { refreshBadge, refreshBadgeSoon };
