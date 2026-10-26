import { browser } from 'wxt/browser';
import { type Snapshot, type SnapshotTab } from '@/core/schema/models';
import { toGroupColor } from '@/core/group/groupColors';
import { NO_GROUP, type TabGroupRecord, type TabRecord } from '@/core/tab-types';
import { isHttpUrl, webComparisonKey } from '@/core/url/UrlInspector';
import { missingTabsOf } from '@/core/snapshot/missingTabs';
import { trimSnapshotsWithEvicted } from '@/core/snapshot/trimSnapshots';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from '@/core/util/concurrency';
import { newId } from '@/core/util/id';
import { settingsRepository, snapshotsRepository } from '@/platform/storage/repositories';
import { SNAPSHOTS_RMW_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';
import { grantReuseAllowance } from '@/platform/reuse/reuseAllowance';
import { logDegraded } from '@/platform/diagnostics';
import { tabGroups } from '@/platform/tabGroups';

// 快照库 RMW 用 `@/platform/storage/crossPageLock` 的 SNAPSHOTS_RMW_LOCK（**全仓锁名
// 的唯一声明处**）：快照的写入方不止面板，background SW（关窗自动保存 / 定时自动
// 快照）也直写同一仓库，裸 read → trim → write 交错时是 last-writer-wins。
/** 生成快照 id（SW / 面板统一走 core 的 id 口径，含非安全上下文的退化路径）。 */
function newSnapshotId(): string {
  return newId('snap');
}

/** 由窗口标签构建一条快照的输入。 */
interface BuildSnapshotInput {
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
 * 淘汰监听。由 store 注册，用于把「因超限淘汰了 N 份」告知用户。
 *
 * 为什么用回调而不是改返回值：persistSnapshot 返回 `Snapshot[]` 是既有公开契约
 * （store 直接 `set({ snapshots: next })`，测试也有桩），改成对象会波及全部调用方；
 * 而淘汰提示只有面板需要。
 */
let onEvicted: ((count: number) => void) | undefined;
export function setSnapshotEvictionListener(fn: (count: number) => void): void {
  onEvicted = fn;
}

/**
 * 写入一条快照（与现有列表合并、裁剪后落盘）。返回落盘后的快照列表。
 * 写盘失败（quota 超限/存储不可用）显式抛错：快照是「恢复入口」，
 * 静默丢失会被用户误认为已保存，必须由调用方提示。
 */
export async function persistSnapshot(snapshot: Snapshot): Promise<Snapshot[]> {
  // 跨页串行化：面板（保存/归档/导入）与 background（关窗自动保存/定时快照）
  // 可能并发走本函数，锁外交错会让后写覆盖先写（见 SNAPSHOTS_RMW_LOCK）。
  return withCrossPageLock(SNAPSHOTS_RMW_LOCK, async () => {
    const settings = await settingsRepository.read();
    const existing = await snapshotsRepository.read();
    // 走 WithEvicted 变体：裁剪会静默丢掉最旧的快照（自动快照超 maxAutoSnapshots、
    // 总数超 snapshotLimit），必须把数字交出去，否则用户只在列表里发现旧快照不见了。
    // platform 层不做 UI 反馈（那是 store/UI 的职责），只把数字交给注册的监听方。
    const { kept, evicted } = trimSnapshotsWithEvicted([snapshot, ...existing], settings);
    const ok = await snapshotsRepository.write(kept);
    if (!ok) throw new Error('persistSnapshot: storage write failed');
    if (evicted.length > 0) onEvicted?.(evicted.length);
    return kept;
  });
}

/**
 * 把最新现场写回既有空间快照（原地更新，不新增条目）。
 *
 * 空间切换的高频路径：若每次「存回」都走 persistSnapshot 新建，SNAPSHOTS_LIMIT
 * 会被反复切换迅速耗尽（裁剪语义按「保留最新」会挤掉真正的历史快照）。
 *
 * 两种「不写」的情形由 `replaced` 告知调用方，调用方必须据此决定后续步骤：
 *  - 目标空间已不存在（被删除）或不是 space 快照；
 *  - **现场为空**：用户手工关光标签后切空间会把它抹成空现场，且这次覆盖
 *    不在撤销批次里——宁可保留旧内容。
 */
export async function replaceSpaceSnapshot(
  id: string,
  snapTabs: readonly SnapshotTab[],
  windowId: number | undefined
): Promise<{ replaced: boolean; snapshots: Snapshot[] }> {
  return withCrossPageLock(SNAPSHOTS_RMW_LOCK, async () => {
    const existing = await snapshotsRepository.read();
    if (snapTabs.length === 0) return { replaced: false, snapshots: existing };
    let replaced = false;
    const next = existing.map((snapshot) => {
      if (snapshot.id !== id || snapshot.origin !== 'space') return snapshot;
      replaced = true;
      return {
        ...snapshot,
        tabs: [...snapTabs],
        tabCount: snapTabs.length,
        createdAt: Date.now(),
        windowId
      };
    });
    if (!replaced) return { replaced: false, snapshots: existing };
    const ok = await snapshotsRepository.write(next);
    if (!ok) throw new Error('replaceSpaceSnapshot: storage write failed');
    return { replaced: true, snapshots: next };
  });
}

/**
 * 由窗口标签 + 原生组构建快照条目列表（UI 与 SW 关窗自动保存共用的采集端）。
 * 仅 http(s) 页面可恢复（chrome:// 等内部页浏览器不允许以 URL 创建），其余跳过；
 * 同时记录静音状态与所在原生组标题/颜色，供恢复时还原（缺省则不还原）。
 */
export function collectSnapshotTabs(
  tabs: readonly TabRecord[],
  groups: readonly TabGroupRecord[]
): SnapshotTab[] {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const out: SnapshotTab[] = [];
  for (const tab of tabs) {
    if (!isHttpUrl(tab.url)) continue;
    const group = tab.groupId !== NO_GROUP ? groupById.get(tab.groupId) : undefined;
    out.push({
      url: tab.url,
      title: tab.title || '',
      favIconUrl: tab.favIconUrl,
      pinned: tab.pinned,
      muted: tab.muted ?? false,
      groupTitle: group?.title || undefined,
      groupColor: toGroupColor(group?.color)
    });
  }
  return out;
}

/** 恢复结果：新建标签数 + 是否按降级口径执行（查询目标窗口失败）。 */
export interface RestoreSnapshotResult {
  /** 本次实际新建的标签数。 */
  count: number;
  /**
   * 查询目标窗口失败，本次按「无重复」继续（宁多建不缺建，且恢复可撤销）。
   * 置起即意味着**可能多建了副本**，由调用方补一句提示 —— 不阻断流程。
   */
  degraded: boolean;
}

/**
 * 恢复快照到当前（或指定）窗口，返回实际新建的标签数与降级标志。
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
export async function restoreSnapshot(
  snapshot: Snapshot,
  windowId?: number
): Promise<RestoreSnapshotResult> {
  let target = windowId;
  if (target === undefined) {
    const win = await browser.windows.getLastFocused().catch(() => undefined);
    target = win?.id;
  }
  if (target === undefined) return { count: 0, degraded: false };

  // 1. 目标窗口已打开的 URL 集合（web 比较键）
  let degraded = false;
  const existingTabs = await browser.tabs.query({ windowId: target }).catch((error) => {
    // 查询失败不得静默按空集合处理：恢复会为窗口内已打开的 URL 重复新建标签。
    // 留痕后仍按空集继续（恢复是显式用户操作，宁多建不缺建，且用户可撤销），
    // 但必须把降级事实交回调用方 —— 否则「恢复出来一堆重复标签」无从解释。
    logDegraded('snapshots', `快照恢复：查询目标窗口 ${target} 标签失败，按无重复处理`, error);
    degraded = true;
    return [];
  });
  const existingKeys = new Set<string>();
  for (const raw of existingTabs) {
    const key = webComparisonKey(raw.url, raw.pendingUrl);
    if (key) existingKeys.add(key);
  }

  // 2. 仅恢复缺失条目
  const missing = missingTabsOf(snapshot, existingKeys);
  if (missing.length === 0) return { count: 0, degraded };

  // 3. 有限并发创建：豁免 → 创建（pinned 内联）→ muted 后置
  //
  // 与 RestoreEngine 同口径：每条都要「发放豁免（一次 runtime 往返）→ create →
  // 静音」，严格串行的总耗时随条目数线性放大。限流后约为 1/并发度。
  // 结果按 missing 顺序收集（mapWithConcurrency 保证），第 4 步的分组还原依赖
  // 该顺序 —— 组内标签的排列由 tabIds 顺序决定，乱序会让恢复出的组与原快照不符。
  const created = (
    await mapWithConcurrency(missing, DEFAULT_CONCURRENCY, async (tab) => {
      try {
        // 返回值 = 是否获确认（契约见 reuseAllowance）：未获确认时恢复出来的标签
        // 可能被复用引擎合并掉，必须传导为 degraded，否则界面报「已恢复」而标签
        // 随即消失，且诊断里只有 reuse 侧一条留痕、快照侧看起来一切正常。
        const granted = await grantReuseAllowance(target, tab.url);
        if (!granted) degraded = true;
        const createdTab = await browser.tabs.create({
          windowId: target,
          url: tab.url,
          active: false,
          pinned: tab.pinned
        });
        const id = createdTab.id;
        if (id === undefined) return null;
        if (tab.muted) {
          // 静音回写失败 = 恢复出的标签丢了静音状态，而用户看到的是「恢复成功」。
          await browser.tabs.update(id, { muted: true }).catch((error) => {
            logDegraded('snapshots', `快照恢复：标签 ${id} 静音状态回写失败`, error);
            degraded = true;
          });
        }
        return { id, tab };
      } catch (error) {
        // 单条失败（无效 URL 等）跳过，继续其余条目；但必须留痕并传导降级，
        // 否则「快照里 20 条只恢复出 18 条」在调用方无解释。
        logDegraded('snapshots', '快照恢复：单条标签创建失败，已跳过', error);
        degraded = true;
        return null;
      }
    })
  ).filter((entry): entry is { id: number; tab: SnapshotTab } => entry !== null);
  if (created.length === 0) return { count: 0, degraded };

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
    // 与第 1 步同口径：查询失败**不能**伪装成「窗口里没有同名组」——那会让每个
    // 组都被判为缺失并无条件新建，一次恢复产出一批同名重复组。
    const existingGroups = await tabGroups.query({ windowId: target }).catch((error) => {
      logDegraded(
        'snapshots',
        `快照恢复：查询目标窗口 ${target} 原生组失败，按无同名组处理`,
        error
      );
      degraded = true;
      return [];
    });
    for (const [title, ids] of groupTabs) {
      try {
        const tabIds = [...ids] as [number, ...number[]];
        // 窗口已有同名组则并入；否则 tabs.group 新建（组标题/颜色稍后补写）
        const sameTitle = existingGroups.find((group) => (group.title ?? '') === title);
        const groupId = await browser.tabs.group(
          sameTitle?.id !== undefined ? { tabIds, groupId: sameTitle.id } : { tabIds }
        );
        // 并入既有同名组时跳过 meta 回写：用户可能在快照之后改过该组的标题/颜色，
        // 无条件 update 会用快照里的旧值覆盖用户的后续修改。
        if (sameTitle === undefined) {
          const color = groupColors.get(title);
          await tabGroups
            .update(groupId, { title, ...(color !== undefined ? { color } : {}) })
            .catch((error) => {
              // 组标题/颜色回写失败的可见后果：恢复出一个**无名空组**，
              // 用户会以为快照数据本身坏了。
              logDegraded('snapshots', `快照恢复：组 ${groupId} 标题/颜色回写失败`, error);
              degraded = true;
            });
        }
      } catch (error) {
        // 组恢复失败：标签保持未分组，不影响已创建的标签。
        // 「恢复了但分组没了」必须留痕并传导，否则调用方无从告知用户。
        logDegraded('snapshots', `快照恢复：组「${title}」还原失败，标签保持未分组`, error);
        degraded = true;
      }
    }
  }

  return { count: created.length, degraded };
}
