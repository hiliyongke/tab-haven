import { browser } from 'wxt/browser';
import type { Settings, SnapshotTab } from '@/core/schema/models';
import { mapTab, mapTabGroup } from '@/platform/tabs';
import { tabGroups } from '@/platform/tabGroups';
import { settingsRepository, snapshotsRepository } from '@/platform/storage/repositories';
import { buildSnapshot, collectSnapshotTabs, persistSnapshot } from '@/platform/snapshot/snapshots';
import { DEFAULT_SNAPSHOT_NAMES } from '@/core/snapshot/defaultNames';
import { logDegraded } from '@/platform/diagnostics';
import { AUTO_SNAPSHOT_ALARM } from '@/platform/storage/keys';
import { listNormalWindowIds } from '@/platform/windows';

/**
 * 定时自动快照。关窗自动保存只兜住「关窗」这一条路径；崩溃、强制退出、长时间不关机的
 * 场景下它永远不触发，因此必须补一条周期性触发。
 * 边界：alarms 是浏览器托管调度，不保证精确触发，也不保证 SW 每次都被唤起；内容未变化
 * 时跳过写入，避免生成一串相同噪音快照并快速耗尽 maxAutoSnapshots。
 */

/**
 * 现场指纹：定时快照的去重依据（URL 集合 + 顺序）。与 core/util/signature 的
 * structuralSignature 不是同一件事：那个是整份数据的结构签名，这里只比 URL 序列。
 */
function urlSetFingerprint(tabs: readonly SnapshotTab[]): string {
  return tabs.map((tab) => tab.url).join('|');
}

/** 最新一份自动快照的指纹（不存在则返回 null）。 */
async function latestAutoSignature(): Promise<string | null> {
  const all = await snapshotsRepository.read();
  const latest = all
    .filter((snap) => snap.origin === 'auto')
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return latest ? urlSetFingerprint(latest.tabs) : null;
}

/** 采集某窗口可恢复的标签（口径见 collectSnapshotTabs，全仓唯一实现）。 */
async function collectWindowTabs(windowId: number): Promise<SnapshotTab[]> {
  const [rawTabs, rawGroups] = await Promise.all([
    browser.tabs.query({ windowId }),
    // 与 windowCache 同口径：查询失败不得伪装成「该窗口没有组」——那样这份自动快照会
    // 静默丢掉全部分组信息，用户只会以为快照本来就没分组。
    tabGroups.query({ windowId }).catch((error) => {
      logDegraded('auto-snapshot', `窗口 ${windowId} 原生组查询失败，本次快照不含分组信息`, error);
      return [];
    })
  ]);
  return collectSnapshotTabs(
    rawTabs.map((raw) => mapTab(raw)),
    rawGroups.map(mapTabGroup)
  );
}

/**
 * 一轮定时自动快照：为每个有标签的普通窗口保存一份 auto 快照（内容无变化则跳过）。
 * 写盘失败（quota 超限等）只告警：自动保存是兜底链路，异常不应逃逸为未捕获 rejection。
 */
export async function runAutoSnapshot(): Promise<void> {
  try {
    const settings = await settingsRepository.read();
    if (!settings.autoSaveSnapshots) return;

    // 与 windowCache / autoGroup 共用 listNormalWindowIds（窗口类型/无痕口径一致）。
    // 查询失败不能退化成空数组：那样本轮会「静默什么都不保存」，与「所有窗口都没有
    // 可保存标签」在表现上完全一致，自动保存的缺口无从察觉。
    const windowIds = await listNormalWindowIds().catch((error) => {
      logDegraded('auto-snapshot', '窗口列表查询失败，本轮未保存任何窗口', error);
      return [] as number[];
    });
    const previous = await latestAutoSignature();
    let saved = 0;

    for (const windowId of windowIds) {
      const tabs = await collectWindowTabs(windowId).catch((error) => {
        // 单窗口采集失败不得静默跳过：自动快照是唯一兜底链路，缺窗必须留痕。
        logDegraded('auto-snapshot', `窗口 ${windowId} 标签采集失败，本轮跳过该窗口`, error);
        return [] as SnapshotTab[];
      });
      if (tabs.length === 0) continue;
      // 单窗口场景与上一份完全相同则跳过；多窗口时以首窗口差异判断（其余窗口仍需各自保存）。
      if (windowIds.length === 1 && previous !== null && urlSetFingerprint(tabs) === previous)
        continue;
      const snapshot = buildSnapshot({
        name: '',
        fallbackName: DEFAULT_SNAPSHOT_NAMES.auto,
        origin: 'auto',
        windowId,
        tabs
      });
      const ok = await persistSnapshot(snapshot).catch((error) => {
        logDegraded('auto-snapshot', '定时自动快照写入失败', error);
        return false;
      });
      // 仅真实落盘成功计入 saved：失败也自增会让「saved===0 直接返回」的语义失真。
      if (ok) saved += 1;
    }

    if (saved === 0) return;
    // 裁剪由 persistSnapshot 内的 trimSnapshotsWithEvicted 完成（auto 按 maxAutoSnapshots 滚动覆盖）。
  } catch (error) {
    logDegraded('auto-snapshot', '定时自动快照执行失败', error);
    // 忽略：下个周期自动重试
  }
}

/**
 * 按设置创建/清除定时闹钟。周期直接用用户设置值：alarms 的 periodInMinutes 最小为 1，
 * 而设置项下限是 5，不存在被浏览器静默抬升为 1 分钟的情况。
 */
export async function syncAutoSnapshotAlarm(settings: Settings): Promise<void> {
  try {
    if (settings.autoSaveSnapshots) {
      // 同名 create 会**重置**触发时间，而 SW 每次被唤醒都会跑一遍本函数：
      // 只看内存签名不够（SW 重启后签名归零），必须问浏览器现有闹钟的周期。
      // 不比对就重建，周期会被无限期推后，自动快照可能永远不触发。
      const existing = await browser.alarms.get(AUTO_SNAPSHOT_ALARM);
      if (existing?.periodInMinutes === settings.autoSnapshotIntervalMin) return;
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
