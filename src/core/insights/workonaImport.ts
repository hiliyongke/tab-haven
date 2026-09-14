import { SNAPSHOT_TABS_LIMIT, type Snapshot, type SnapshotTab } from '@/core/schema/models';

/**
 * Workona 迁移器（P-09）：Workona 导出 JSON → Tabs 快照族。
 *
 * 外部格式 → 内部 schema 的纯转换函数，零 chrome 依赖，恰好落在 core 层的
 * 单测主场。与 OneTab 导入（文本解析）互补，共同构成「迁移矩阵」的入口面。
 *
 * Workona 导出结构（workona.com/export/mydata 产出，字段名大小写混合）：
 *  {
 *    "Workspaces": [ { "title": "分组名", "workspaces": [ { "title": "...",
 *      "tabs": [ { "title": "...", "url": "..." } ],
 *      "resources": [ { "title": "...", "resources": [...] } ] } ] } ],
 *    "Archived Workspaces": [ ...同结构... ]
 *  }
 *
 * 转换规则：
 *  - 每个带标签的 workspace → 一份快照；
 *  - 归档 workspace 的快照 origin 为 'archive'，其余为 'manual'；
 *  - resources（站点收藏）并入同一份快照（条目级 url 字段同构）；
 *  - 仅 http(s) URL 可恢复（chrome:// 等内部页浏览器不允许以 URL 创建）；
 *  - tabs 数量受 SNAPSHOT_TABS_LIMIT 约束（超出静默截断，与 parseOneTab 同口径）。
 */

/** Workona 导出中的最小条目结构。 */
interface WorkonaTab {
  title?: string;
  url?: string;
}

/** Workona 导出中的资源区段（与 tabs 同构的 url 列表容器）。 */
interface WorkonaResourceSection {
  title?: string;
  resources?: WorkonaTab[];
}

/** Workona 导出中的单个 workspace。 */
interface WorkonaWorkspace {
  title?: string;
  tabs?: WorkonaTab[];
  resources?: WorkonaResourceSection[];
}

/** Workona 导出顶层结构（仅声明消费的字段，多余字段忽略）。 */
interface WorkonaExport {
  /** 官方导出顶层键（大写 W，字段名大小写混合是 Workona 导出的实际形态）。 */
  Workspaces?: Array<{ title?: string; workspaces?: WorkonaWorkspace[] }>;
  /** 小写变体：部分三方工具转换后的文件。 */
  workspaces?: Array<{ title?: string; workspaces?: WorkonaWorkspace[] }>;
  archived_workspaces?: WorkonaWorkspace[];
  /** 字段名空格变体：不同年份的导出样本存在 "Archived Workspaces" 写法。 */
  'Archived Workspaces'?: WorkonaWorkspace[];
}

/** 解析结果。 */
export interface WorkonaImportResult {
  /** 转换出的快照（待调用方命名后经 persistSnapshot 落盘）。 */
  snapshots: Snapshot[];
  /** 识别出但无可恢复 http(s) 标签的 workspace 数（用于结果反馈）。 */
  skippedWorkspaces: number;
  /** 全部快照的标签总数。 */
  totalTabs: number;
}

/** 输入体积上限（1MB，与 parseOneTab 的 ONE_TAB_INPUT_LIMIT 同口径）。 */
export const WORKONA_INPUT_LIMIT = 1024 * 1024;

/** 单个 workspace → 快照条目列表（仅 http(s)，SNAPSHOT_TABS_LIMIT 截断）。 */
function tabsOfWorkspace(workspace: WorkonaWorkspace): SnapshotTab[] {
  const out: SnapshotTab[] = [];
  const push = (entry: WorkonaTab): void => {
    if (out.length >= SNAPSHOT_TABS_LIMIT) return;
    const url = entry.url?.trim();
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        out.push({
          url: parsed.href,
          title: entry.title?.trim() ?? '',
          pinned: false,
          muted: false
        });
      }
    } catch {
      // 非 URL / 内部页：跳过
    }
  };
  for (const tab of workspace.tabs ?? []) push(tab);
  for (const section of workspace.resources ?? []) {
    for (const resource of section.resources ?? []) push(resource);
  }
  return out;
}

/**
 * 解析 Workona 导出 JSON 为快照族（不含 id —— 快照 id 由调用方 newId 生成，
 * 保持本函数零依赖、可注入确定性 id 的可测性）。
 * @param rawText 导出文件全文（JSON 字符串）
 * @param newSnapshotId 快照 id 生成器（生产传 () => newId('snap')，测试可注入固定值）
 * @param fallbackTime 快照创建时间（生产传 Date.now()，测试可注入固定值）
 */
export function parseWorkona(
  rawText: string,
  newSnapshotId: () => string,
  fallbackTime: number = Date.now()
): WorkonaImportResult {
  const empty: WorkonaImportResult = { snapshots: [], skippedWorkspaces: 0, totalTabs: 0 };
  if (rawText.length > WORKONA_INPUT_LIMIT) return empty;
  let data: WorkonaExport;
  try {
    data = JSON.parse(rawText) as WorkonaExport;
  } catch {
    return empty;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return empty;

  const snapshots: Snapshot[] = [];
  let skippedWorkspaces = 0;
  let totalTabs = 0;

  const emit = (workspace: WorkonaWorkspace, origin: Snapshot['origin']): void => {
    const tabs = tabsOfWorkspace(workspace);
    if (tabs.length === 0) {
      // workspace 存在但无可恢复标签：不是错误（可能全是不支持协议的条目），
      // 计数反馈给用户「识别了但跳过」。
      skippedWorkspaces += 1;
      return;
    }
    snapshots.push({
      id: newSnapshotId(),
      name: workspace.title?.trim() || 'Workona import',
      origin,
      createdAt: fallbackTime,
      windowId: undefined,
      tabCount: tabs.length,
      tabs
    });
    totalTabs += tabs.length;
  };

  // 顶层键大小写混合：官方导出为大写 Workspaces，三方转换文件可能是小写。
  const rawGroups = Array.isArray(data.Workspaces)
    ? data.Workspaces
    : Array.isArray(data.workspaces)
      ? data.workspaces
      : [];
  for (const group of rawGroups) {
    for (const workspace of group?.workspaces ?? []) emit(workspace, 'manual');
  }
  const archived = Array.isArray(data.archived_workspaces)
    ? data.archived_workspaces
    : Array.isArray(data['Archived Workspaces'])
      ? data['Archived Workspaces']
      : [];
  for (const workspace of archived) emit(workspace, 'archive');

  return { snapshots, skippedWorkspaces, totalTabs };
}
