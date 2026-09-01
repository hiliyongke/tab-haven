import { browser } from 'wxt/browser';
import type { Settings, SnapshotTab } from '@/core/schema/models';
import { mapTab, mapTabGroup } from '@/platform/tabs';
import { settingsRepository, snapshotsRepository } from '@/platform/storage/repositories';
import { buildSnapshot, persistSnapshot } from '@/platform/snapshot/snapshots';
import { t } from '@/i18n/headless';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 定时自动快照（PRD FR-D5.2 触发①）。
 *
 * 关窗自动保存只能兜住「关窗」这一条路径；崩溃、强制退出、长时间不关机的场景下
 * 它永远不会触发，因此必须补一条周期性触发，否则自动保存的承诺存在结构性缺口。
 *
 * 边界（与 PRD 一致，须在设置页明示）：
 *  - alarms 是浏览器托管调度，不保证精确触发，也不保证 SW 每次都能被唤起；
 *  - 内容未变化时跳过写入，避免生成一串完全相同的噪音快照并快速耗尽 maxAutoSnapshots。
 */

const AUTO_SNAPSHOT_ALARM = 'tabhaven-auto-snapshot';

/** 现场指纹：定时快照的去重依据（URL 集合 + 顺序）。 */
function signatureOf(tabs: readonly SnapshotTab[]): string {
  return tabs.map((tab) => tab.url).join('|');
}

/** 最新一份自动快照的指纹（不存在则返回 null）。 */
async function latestAutoSignature(): Promise<string | null> {
  const all = await snapshotsRepository.read();
  const latest = all
    .filter((snap) => snap.origin === 'auto')
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return latest ? signatureOf(latest.tabs) : null;
}

/** 采集某窗口可恢复的标签（仅 http(s)，chrome:// 等内部页无法重建，收入只会成为死条目）。 */
async function collectWindowTabs(windowId: number): Promise<SnapshotTab[]> {
  const [rawTabs, rawGroups] = await Promise.all([
    browser.tabs.query({ windowId }),
    browser.tabGroups.query({ windowId }).catch(() => [])
  ]);
  const groups = rawGroups.map(mapTabGroup);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const out: SnapshotTab[] = [];
  for (const raw of rawTabs) {
    const tab = mapTab(raw);
    if (!tab.url || !/^https?:\/\//i.test(tab.url)) continue;
    const group = groupById.get(tab.groupId);
    out.push({
      url: tab.url,
      title: tab.title || '',
      favIconUrl: tab.favIconUrl,
      pinned: tab.pinned,
      muted: tab.muted ?? false,
      groupTitle: group?.title || undefined,
      groupColor: group?.color || undefined
    });
  }
  return out;
}

/**
 * 一轮定时自动快照：为每个有标签的普通窗口保存一份 auto 快照（内容无变化则跳过）。
 * 写盘失败（quota 超限等）只告警：自动保存是兜底链路，异常不应逃逸为未捕获 rejection。
 */
export async function runAutoSnapshot(): Promise<void> {
  try {
    const settings = await settingsRepository.read();
    if (!settings.autoSaveSnapshots) return;

    // 与 windowCache 同款查询：populate:false 不回传标签数组（标签另行按窗口查询），
    // 且不依赖 windowTypes 参数（部分运行环境的实现不一致）。
    const wins = await browser.windows.getAll({ populate: false }).catch(() => []);
    const normalWins = wins.filter((win) => win.incognito !== true);
    const previous = await latestAutoSignature();
    let saved = 0;

    for (const win of normalWins) {
      if (typeof win.id !== 'number') continue;
      const tabs = await collectWindowTabs(win.id).catch(() => [] as SnapshotTab[]);
      if (tabs.length === 0) continue;
      // 单窗口场景与上一份完全相同则跳过；多窗口时以首窗口差异判断（其余窗口仍需各自留档）。
      if (normalWins.length === 1 && previous !== null && signatureOf(tabs) === previous) continue;
      const snapshot = buildSnapshot({
        name: '',
        fallbackName: t('snapshots.defaultAutoName'),
        origin: 'auto',
        windowId: win.id,
        tabs
      });
      await persistSnapshot(snapshot).catch((error) => {
        logDegraded('auto-snapshot', '定时自动快照写入失败', error);
      });
      saved += 1;
    }

    if (saved === 0) return;
    // 裁剪由 persistSnapshot 内的 trimSnapshots 完成（auto 按 maxAutoSnapshots 滚动覆盖）。
  } catch (error) {
    logDegraded('auto-snapshot', '定时自动快照执行失败', error);
    // 忽略：下个周期自动重试
  }
}

/**
 * 按设置创建/清除定时闹钟。
 *
 * 周期直接使用用户设置值：alarms 的 periodInMinutes 最小为 1，而设置项下限是 5，
 * 不存在被浏览器静默抬升为 1 分钟的情况（那样会造成远超预期的写入与 SW 唤醒）。
 */
export async function syncAutoSnapshotAlarm(settings: Settings): Promise<void> {
  try {
    if (settings.autoSaveSnapshots) {
      await browser.alarms.create(AUTO_SNAPSHOT_ALARM, {
        periodInMinutes: settings.autoSnapshotIntervalMin,
        // 首次触发延后一个完整周期：刚开启设置时立刻写一份快照意义不大，
        // 且会让用户误以为「自动保存是实时的」。
        delayInMinutes: settings.autoSnapshotIntervalMin
      });
    } else {
      await browser.alarms.clear(AUTO_SNAPSHOT_ALARM);
    }
  } catch (error) {
    logDegraded('auto-snapshot', '定时自动快照闹钟设置失败', error);
    // alarms 不可用时忽略
  }
}

export { AUTO_SNAPSHOT_ALARM };
