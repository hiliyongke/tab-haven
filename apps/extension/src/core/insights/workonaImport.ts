import { z } from 'zod';
import {
  SNAPSHOT_TABS_LIMIT,
  SNAPSHOTS_LIMIT,
  type Snapshot,
  type SnapshotTab
} from '@/core/schema/models';
import { DEFAULT_SNAPSHOT_NAMES } from '@/core/snapshot/defaultNames';

/**
 * Workona 迁移器：Workona 导出 JSON → Tabs 快照族。
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
 *  - tabs 数量受 SNAPSHOT_TABS_LIMIT 约束、快照份数受 SNAPSHOTS_LIMIT 约束；
 *    被丢弃的量一律计入结果（truncatedTabs / truncatedSnapshots），不静默截断。
 */

/**
 * Workona 导出的结构 schema。
 *
 * 解析必须走 zod 而非 `as` 断言：这是**外部文件导入**，与备份导入同属「不信任
 * 任何输入」的边界。用 `JSON.parse(...) as WorkonaExport` + 手写 typeof 守卫时，
 * 字段形态只能靠注释维护，新增字段极易漏判。
 *
 * 一律 `.passthrough()`：只声明消费的字段，第三方导出的多余字段原样忽略
 * （这是刻意的宽松，不是漏校验 —— 真正的安全闸门在 url 的 scheme 白名单）。
 */
const WorkonaTabSchema = z
  .object({ title: z.string().optional(), url: z.string().optional() })
  .passthrough();
const WorkonaResourceSectionSchema = z
  .object({ title: z.string().optional(), resources: z.array(WorkonaTabSchema).optional() })
  .passthrough();
const WorkonaWorkspaceSchema = z
  .object({
    title: z.string().optional(),
    tabs: z.array(WorkonaTabSchema).optional(),
    resources: z.array(WorkonaResourceSectionSchema).optional()
  })
  .passthrough();
const WorkonaGroupSchema = z
  .object({ title: z.string().optional(), workspaces: z.array(WorkonaWorkspaceSchema).optional() })
  .passthrough();
const WorkonaExportSchema = z
  .object({
    /** 官方导出顶层键（大写 W，字段名大小写混合是 Workona 导出的实际形态）。 */
    Workspaces: z.array(WorkonaGroupSchema).optional(),
    /** 小写变体：部分三方工具转换后的文件。 */
    workspaces: z.array(WorkonaGroupSchema).optional(),
    archived_workspaces: z.array(WorkonaWorkspaceSchema).optional(),
    /** 字段名空格变体：不同年份的导出样本存在 "Archived Workspaces" 写法。 */
    'Archived Workspaces': z.array(WorkonaWorkspaceSchema).optional()
  })
  .passthrough();

type WorkonaTab = z.infer<typeof WorkonaTabSchema>;
type WorkonaWorkspace = z.infer<typeof WorkonaWorkspaceSchema>;

/**
 * 解析失败原因。
 *
 * 与备份导入（`parseExportFile` 的 version-mismatch / invalid 分流）同口径：
 * 失败必须**可解释**。三条失败路径（体积超限 / JSON 损坏 / 结构不匹配）
 * 共用同一个空结果时，用户只看到「导入 0 条」，无法区分「文件拿错了」与
 * 「文件对但内容全是内部页」。
 */
type WorkonaImportFailure = 'too-large' | 'invalid-json' | 'unrecognized';

/** 解析结果。 */
interface WorkonaImportResult {
  /** 转换出的快照（待调用方命名后经 persistSnapshot 落盘）。 */
  snapshots: Snapshot[];
  /** 识别出但无可恢复 http(s) 标签的 workspace 数（用于结果反馈）。 */
  skippedWorkspaces: number;
  totalTabs: number;
  /** 因单份快照标签上限（SNAPSHOT_TABS_LIMIT）被丢弃的标签数。 */
  truncatedTabs: number;
  /** 因快照族上限（SNAPSHOTS_LIMIT）被丢弃的快照份数。 */
  truncatedSnapshots: number;
  /** 失败原因；'ok' 表示解析成功（快照仍可能为 0，见 skippedWorkspaces）。 */
  reason: 'ok' | WorkonaImportFailure;
}

/** 成功空结果（无 workspace 命中，但不是失败）。 */
const emptyOk = (): WorkonaImportResult => ({
  snapshots: [],
  skippedWorkspaces: 0,
  totalTabs: 0,
  truncatedTabs: 0,
  truncatedSnapshots: 0,
  reason: 'ok'
});

/** 失败结果（按原因可解释）。 */
const failure = (reason: WorkonaImportFailure): WorkonaImportResult => ({
  ...emptyOk(),
  reason
});

/** 输入体积上限（1MB，与 core/snapshot/oneTabImport 的 ONE_TAB_INPUT_LIMIT 同口径）。 */
export const WORKONA_INPUT_LIMIT = 1024 * 1024;

/**
 * 单个 workspace → 快照条目列表。
 *
 * 返回 `[tabs, dropped]`：dropped 是被丢弃的条目数（超出单份上限，或非
 * http(s) / 非 URL 的条目）。超限与非 http(s) 都只是 `return` 时，用户看到
 * 「导入了 N 条」而无从知道少了多少 —— 与「坏数据不静默丢弃」的既定口径冲突。
 */
function tabsOfWorkspace(workspace: WorkonaWorkspace): { tabs: SnapshotTab[]; dropped: number } {
  const out: SnapshotTab[] = [];
  let dropped = 0;
  const push = (entry: WorkonaTab): void => {
    if (out.length >= SNAPSHOT_TABS_LIMIT) {
      dropped += 1;
      return;
    }
    const url = entry.url?.trim();
    if (!url) {
      dropped += 1;
      return;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        out.push({
          url: parsed.href,
          title: entry.title?.trim() ?? '',
          pinned: false,
          muted: false
        });
        return;
      }
    } catch {
      // 非 URL：落入下方 dropped
    }
    // 非 http(s) / 解析失败：浏览器不允许以这些 URL 建标签，计入丢弃量。
    dropped += 1;
  };
  for (const tab of workspace.tabs ?? []) push(tab);
  for (const section of workspace.resources ?? []) {
    for (const resource of section.resources ?? []) push(resource);
  }
  return { tabs: out, dropped };
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
  if (rawText.length > WORKONA_INPUT_LIMIT) return failure('too-large');
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawText);
  } catch {
    return failure('invalid-json');
  }
  const parsedExport = WorkonaExportSchema.safeParse(rawJson);
  if (!parsedExport.success) return failure('unrecognized');
  const data = parsedExport.data;

  const snapshots: Snapshot[] = [];
  let skippedWorkspaces = 0;
  /**
   * 被标签上限截断的标签数。
   *
   * 口径与 `totalTabs` **不同源**：这里累加的是「工作区内超出上限而被丢弃」的
   * 标签（含那些整份被快照数上限截断的工作区），`totalTabs` 只统计最终落盘的
   * 快照里的标签。两者并列展示时含义是「落盘 N / 丢弃 M」，不是同一分母的分配。
   */
  let truncatedTabs = 0;

  const emit = (workspace: WorkonaWorkspace, origin: Snapshot['origin']): void => {
    const { tabs, dropped } = tabsOfWorkspace(workspace);
    truncatedTabs += dropped;
    if (tabs.length === 0) {
      // workspace 存在但无可恢复标签：不是错误（可能全是不支持协议的条目），
      // 计数反馈给用户「识别了但跳过」。
      skippedWorkspaces += 1;
      return;
    }
    snapshots.push({
      id: newSnapshotId(),
      // 落盘默认名走常量（不按界面语言生成）：与 OneTab 导入侧的
      // DEFAULT_SNAPSHOT_NAMES.oneTab 同口径，避免中英文界面产出两套名字。
      name: workspace.title?.trim() || DEFAULT_SNAPSHOT_NAMES.workona,
      origin,
      createdAt: fallbackTime,
      windowId: undefined,
      tabCount: tabs.length,
      tabs
    });
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

  // 快照族上限：备份导入侧由 schema 的 `.max(SNAPSHOTS_LIMIT)` 把住，Workona
  // 导入同样按此上限收敛 —— 否则 1MB 输入可产出任意份快照，远超落盘裁剪能收敛的范围。
  // 丢弃的份数如实回传（不静默丢量）。
  const kept = snapshots.slice(0, SNAPSHOTS_LIMIT);
  const truncatedSnapshots = snapshots.length - kept.length;
  // totalTabs 按**实际落盘的份**重算：在 emit 阶段累加会把被截断掉的快照的标签数
  // 也算进来，UI 报「导入 N 条」大于真实落盘数 —— 正是要消除的「不知少了多少」。
  const totalTabs = kept.reduce((sum, snapshot) => sum + snapshot.tabs.length, 0);
  return {
    snapshots: kept,
    skippedWorkspaces,
    totalTabs,
    truncatedTabs,
    truncatedSnapshots,
    reason: 'ok'
  };
}
