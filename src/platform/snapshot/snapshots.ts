import { browser } from 'wxt/browser';
import type { Settings, Snapshot, SnapshotTab } from '@/core/schema/models';
import { NO_GROUP, type TabGroupRecord, type TabRecord } from '@/core/tab-types';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { settingsRepository, snapshotsRepository } from '@/platform/storage/repositories';
import { grantReuseAllowance } from '@/platform/reuse/reuseAllowance';

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

/**
 * chrome.tabGroups 类型桥接（wxt 类型对 query/update 的色名字面量覆盖不足，
 * 与 platform/tabs.ts 同款受控 workaround：查询/更新只经此一处）。
 */
const tabGroups = browser.tabGroups as unknown as {
  query: (queryInfo: { windowId?: number }) => Promise<{ id: number; title?: string }[]>;
  update: (groupId: number, updateProperties: { title?: string; color?: string }) => Promise<unknown>;
};

/** 由窗口标签构建一条快照的输入。 */
export interface BuildSnapshotInput {
  name: string;
  /** 名称为空时的回退名（由调用方按 i18n 解析传入，保持本函数纯净无文案依赖）。 */
  fallbackName: string;
  origin: Snapshot['origin'];
  windowId: number | undefined;
  tabs: readonly SnapshotTab[];
}

/** 由窗口标签构建一条快照（origin: manual 手动 / auto 关窗自动保存 / space 工作区 / archive 归档）。 */
export function buildSnapshot(input: BuildSnapshotInput): Snapshot {
  const { name, fallbackName, origin, windowId, tabs } = input;
  const list = tabs.filter((tab) => tab.url);
  return {
    id: newSnapshotId(),
    name: name.trim() || fallbackName,
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
        out.push({ url: parsed.href, title, pinned: false, muted: false });
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
 * 由窗口标签 + 原生组构建快照条目列表（UI 与 SW 关窗自动保存共用的采集端）。
 * 仅 http(s) 页面可恢复（chrome:// 等内部页浏览器不允许以 URL 创建），其余跳过；
 * 同时记录静音状态与所在原生组标题/颜色，供恢复时还原（旧快照无这些字段则不还原）。
 */
export function collectSnapshotTabs(
  tabs: readonly TabRecord[],
  groups: readonly TabGroupRecord[]
): SnapshotTab[] {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const out: SnapshotTab[] = [];
  for (const tab of tabs) {
    if (!tab.url || !/^https?:\/\//i.test(tab.url)) continue;
    const group = tab.groupId !== NO_GROUP ? groupById.get(tab.groupId) : undefined;
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

/** 恢复快照中「窗口内尚未打开」的条目（web 比较键去重；快照内自身重复也去重）。 */
function missingTabsOf(snapshot: Snapshot, existingKeys: ReadonlySet<string>): SnapshotTab[] {
  const seen = new Set<string>();
  const missing: SnapshotTab[] = [];
  for (const tab of snapshot.tabs) {
    // 仅 http(s) 条目可恢复（chrome:// 等内部页浏览器不允许以 URL 创建，采集端已过滤，
    // 此处兜底旧数据/导入数据）。
    if (!/^https?:\/\//i.test(tab.url)) continue;
    const key = webComparisonKey(tab.url, undefined) ?? tab.url;
    if (existingKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    missing.push(tab);
  }
  return missing;
}

/**
 * 恢复快照（FR-D5.1 完整语义）到当前（或指定）窗口，返回实际新建的标签数。
 *
 * 恢复是纯加法：
 *  - 仅新建缺失标签 —— 与窗口内已打开 URL（web 比较键口径）相同的条目跳过，
 *    已存在的标签一律不动（不关闭、不改状态、不移动）；
 *  - 每个新建标签先发放复用豁免（防止被 uniqueUrlTabs 复用引擎合并）；
 *  - 还原固定（创建时内联）与静音状态（创建后置位）；
 *  - 还原生分组：同组名的新建标签一次成组；窗口已有同名组则并入，
 *    否则按组名重建并还原标题/颜色（与撤销恢复 RestoreEngine 语义一致）。
 *    固定标签不参与分组（Chrome 限制：固定标签不属于组）。
 * 单条创建失败不影响其余条目；分组恢复失败保持未分组（不阻断恢复）。
 */
export async function restoreSnapshot(snapshot: Snapshot, windowId?: number): Promise<number> {
  let target = windowId;
  if (target === undefined) {
    const win = await browser.windows.getLastFocused().catch(() => undefined);
    target = win?.id;
  }
  if (target === undefined) return 0;

  // 1. 目标窗口已打开的 URL 集合（web 比较键）
  const existingTabs = await browser.tabs.query({ windowId: target }).catch(() => []);
  const existingKeys = new Set<string>();
  for (const raw of existingTabs) {
    const key = webComparisonKey(raw.url, raw.pendingUrl);
    if (key) existingKeys.add(key);
  }

  // 2. 仅恢复缺失条目
  const missing = missingTabsOf(snapshot, existingKeys);
  if (missing.length === 0) return 0;

  // 3. 逐条创建：豁免 → 创建（pinned 内联）→ muted 后置
  const created: { id: number; tab: SnapshotTab }[] = [];
  for (const tab of missing) {
    try {
      await grantReuseAllowance(target, tab.url);
      const createdTab = await browser.tabs.create({
        windowId: target,
        url: tab.url,
        active: false,
        pinned: tab.pinned
      });
      const id = createdTab.id;
      if (id === undefined) continue;
      if (tab.muted) {
        await browser.tabs.update(id, { muted: true }).catch(() => {});
      }
      created.push({ id, tab });
    } catch {
      // 单条失败（无效 URL 等）跳过，继续其余条目
    }
  }
  if (created.length === 0) return 0;

  // 4. 分组还原：同组名一次性成组（同名并入 / 缺失重建）
  const groupTabs = new Map<string, number[]>();
  const groupColors = new Map<string, string | undefined>();
  for (const { id, tab } of created) {
    if (tab.pinned || !tab.groupTitle) continue; // 固定标签不进组
    const ids = groupTabs.get(tab.groupTitle) ?? [];
    ids.push(id);
    groupTabs.set(tab.groupTitle, ids);
    if (tab.groupColor) groupColors.set(tab.groupTitle, tab.groupColor);
  }
  if (groupTabs.size > 0) {
    const existingGroups = await tabGroups.query({ windowId: target }).catch(() => []);
    for (const [title, ids] of groupTabs) {
      try {
        const tabIds = [...ids] as [number, ...number[]];
        // 窗口已有同名组则并入；否则 tabs.group 新建（组标题/颜色稍后补写）
        const sameTitle = existingGroups.find((group) => (group.title ?? '') === title);
        const groupId = await browser.tabs.group(
          sameTitle?.id !== undefined ? { tabIds, groupId: sameTitle.id } : { tabIds }
        );
        const color = groupColors.get(title);
        await tabGroups
          .update(groupId, { title, ...(color !== undefined ? { color } : {}) })
          .catch(() => {});
      } catch {
        // 组恢复失败：标签保持未分组，不影响已创建的标签
      }
    }
  }

  return created.length;
}
