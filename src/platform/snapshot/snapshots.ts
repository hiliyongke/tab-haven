import type { Settings, Snapshot, SnapshotTab } from '@/core/schema/models';
import { settingsRepository, snapshotsRepository } from '@/platform/storage/repositories';
import { createTabsWithUrls } from '@/platform/tabs';

/** 生成快照 id（SW / 面板均可用的 crypto.randomUUID，退化路径相容）。 */
function newSnapshotId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // 退化路径
  }
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 由窗口标签构建一条快照的输入。 */
export interface BuildSnapshotInput {
  name: string;
  origin: Snapshot['origin'];
  windowId: number | undefined;
  tabs: readonly SnapshotTab[];
}

/** 由窗口标签构建一条快照（origin: manual 手动 / auto 关窗自动保存）。 */
export function buildSnapshot(input: BuildSnapshotInput): Snapshot {
  const { name, origin, windowId, tabs } = input;
  const list = tabs.filter((tab) => tab.url);
  return {
    id: newSnapshotId(),
    name: name.trim() || (origin === 'auto' ? 'Auto snapshot' : 'Snapshot'),
    origin,
    createdAt: Date.now(),
    windowId,
    tabCount: list.length,
    tabs: list
  };
}

/**
 * 快照裁剪：先保证自动快照不超过 maxAutoSnapshots（仅保留最新 N 条 auto），
 * 再保证总快照不超过 snapshotLimit（保留最新 N 条）。返回新数组（不修改入参）。
 */
export function trimSnapshots(list: readonly Snapshot[], settings: Settings): Snapshot[] {
  const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
  const maxAuto = Math.max(1, settings.maxAutoSnapshots);
  const autoKept = sorted.filter((s) => s.origin === 'auto').slice(0, maxAuto);
  const manualKept = sorted.filter((s) => s.origin !== 'auto');
  const merged = [...autoKept, ...manualKept].sort((a, b) => b.createdAt - a.createdAt);
  const limit = Math.max(1, settings.snapshotLimit);
  return merged.slice(0, limit);
}

/**
 * 解析 OneTab 导出文本为快照条目（D9.3 竞品迁移）。
 * 兼容格式：每行一个条目，可为裸 URL、或 "URL - Title"、"[URL] Title"。
 * 仅抽取可恢复的 URL；非法行跳过。返回轻量 SnapshotTab 数组。
 */
export function parseOneTab(text: string): SnapshotTab[] {
  const out: SnapshotTab[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    let url: string;
    let title = '';
    const bracket = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (bracket) {
      url = bracket[1]!.trim();
      title = bracket[2]?.trim() ?? '';
    } else if (line.includes(' - ')) {
      const idx = line.indexOf(' - ');
      url = line.slice(0, idx).trim();
      title = line.slice(idx + 3).trim();
    } else {
      url = line;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        out.push({ url: parsed.href, title, pinned: false });
      }
    } catch {
      // 跳过非 URL 行
    }
  }
  return out;
}

/**
 * 写入一条快照（与现有列表合并、裁剪后落盘）。返回落盘后的快照列表。
 * 写盘失败（quota 超限/存储不可用）显式抛错：快照是「恢复入口」，
 * 静默丢失会被用户误认为已保存，必须由调用方提示。
 */
export async function persistSnapshot(snapshot: Snapshot): Promise<Snapshot[]> {
  const settings = await settingsRepository.read();
  const existing = await snapshotsRepository.read();
  const next = trimSnapshots([snapshot, ...existing], settings);
  const ok = await snapshotsRepository.write(next);
  if (!ok) throw new Error('persistSnapshot: storage write failed');
  return next;
}

/**
 * 恢复快照：在当前（或指定）窗口重新打开全部标签。返回成功打开的标签数。
 * 仅 http(s) 条目可恢复（chrome:// 等内部页浏览器不允许以 URL 创建，采集端已过滤，
 * 此处兜底旧数据）；复用豁免由 createTabsWithUrls 逐条发放，与撤销恢复行为一致。
 */
export async function restoreSnapshot(snapshot: Snapshot, windowId?: number): Promise<number> {
  const urls = snapshot.tabs.map((tab) => tab.url).filter((url) => /^https?:\/\//i.test(url));
  if (urls.length === 0) return 0;
  return createTabsWithUrls(urls, windowId);
}
