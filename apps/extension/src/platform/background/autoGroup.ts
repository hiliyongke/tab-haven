import { planAutoGroups } from '@/core/group/AutoGrouping';
import { deriveSections } from '@/core/site/Sections';
import { t } from '@/i18n/headless';
import {
  disbandAutoGroups,
  reconcileAutoGroupDomains,
  syncAutoGroups
} from '@/platform/group/AutoGroupSync';
import { queryWindowGroups, queryWindowTabs } from '@/platform/tabs';
import { settingsRepository } from '@/platform/storage/repositories';
import { logDegraded } from '@/platform/diagnostics';
import { readFixedExcludedTabIds } from '@/platform/background/actionRegroup';
import { listNormalWindowIds } from '@/platform/windows';

/**
 * 自动原生分组的唯一执行者（background SW）。自动分组是「浏览器状态 → 浏览器状态」的
 * 同步，与界面是否挂载无关，故必须在 SW 而非面板：收口到 SW 后单一执行源、事件即触发、
 * 面板只负责渲染。
 *
 * 一次 reconcile 维护的不变量：
 *  1. 自动组内只能有同一站点的标签。Chrome 会把「从组内标签点链接打开的新标签」自动塞进
 *     同一个组，这类标签一出生就带 groupId，planAutoGroups 看不到它，须由
 *     reconcileAutoGroupDomains 移出；
 *  2. 同站点未分组标签达阈值即成组（planAutoGroups）；
 *  3. 开关关闭即解散本功能创建的组（disbandAutoGroups）。
 *
 * 调度模型：事件只登记窗口 + 起一个合并定时器（leading 不抢、trailing 合并），一轮 drain
 * 内按窗口串行；本轮若发生组内移出，说明派生视图已过期，立刻补跑一轮。
 */

/** 合并窗口内连续标签事件的缓冲时长：足以把 onCreated 与随后的 onUpdated(url) 合成一轮。 */
const RECONCILE_DELAY_MS = 120;
/** 单轮 drain 的最大轮数。正常最多两轮（移出 → 重新聚合）；上限是防御病态循环，不是预期路径。 */
const MAX_ROUNDS = 4;

const pendingWindowIds = new Set<number>();
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let rerunRequested = false;
/**
 * 上一次生效的「聚合签名」= 开关 + 模式 + 阈值。三者任一变化都要重新对账。用签名而不是
 * 布尔值，让「阈值 5 → 2」这类纯参数变更也能立刻补组，同时不被无关设置反复触发。
 */
let knownSignature: string | null = null;

function autoGroupSignature(settings: AutoGroupSettingKeys): string {
  return `${settings.autoGroupNative}|${settings.groupMode}|${settings.aggregationThreshold}`;
}

/** applyAutoGroupSetting 关心的设置子集（自动分组不变量的全部输入）。 */
interface AutoGroupSettingKeys {
  autoGroupNative: boolean;
  groupMode: 'site' | 'opener' | 'language';
  aggregationThreshold: number;
}

/** 登记一次自动分组对账（窗口内合并）。调用方是标签事件监听器，必须极轻：只做 Set.add + 起定时器。 */
export function scheduleAutoGroupReconcile(windowId: number | undefined): void {
  if (windowId === undefined) return;
  pendingWindowIds.add(windowId);
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void drainReconcile();
  }, RECONCILE_DELAY_MS);
}

/** 对所有普通窗口调度一次对账（启动 / 开关重新打开时补齐存量标签）。 */
async function reconcileAllWindows(): Promise<void> {
  try {
    // 窗口类型/无痕口径与 windowCache / autoSnapshot 共用 listNormalWindowIds。
    for (const windowId of await listNormalWindowIds()) {
      scheduleAutoGroupReconcile(windowId);
    }
  } catch (error) {
    logDegraded('auto-group', '枚举窗口失败，跳过本轮自动分组', error);
  }
}

/**
 * 设置联动（settings watch 与启动读盘共用）。只在聚合签名变化时动作：开启即全窗口对账，
 * 关闭即解散本功能创建的组。knownSignature 初值为 null，SW 重启后的首次调用无论设置是什么
 * 都能正确进入对应分支（关闭时 disband 在无记录时是空操作）。
 */
export function applyAutoGroupSetting(settings: AutoGroupSettingKeys): void {
  const signature = autoGroupSignature(settings);
  if (knownSignature === signature) return;
  knownSignature = signature;
  if (settings.autoGroupNative) {
    void reconcileAllWindows();
    return;
  }
  void disbandAutoGroups();
}

/** 仅测试用：清空调度状态（模块级 timer / 标志不跨用例共享）。 */
export function resetAutoGroupSchedulerForTest(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pendingWindowIds.clear();
  running = false;
  rerunRequested = false;
  knownSignature = null;
}

async function drainReconcile(): Promise<void> {
  if (running) {
    // 执行期间又有事件（tabs.group / ungroup 自身会派发）：本轮结束后补跑，
    // 而不是并发进入 —— 两轮交错会为同一批标签重复建组。
    rerunRequested = true;
    return;
  }
  running = true;
  try {
    let round = 0;
    // 本轮是否还需要再跑（三个来源）：needAnotherRound 某窗口发生组内移出、派生视图已过期；
    // rerunRequested 执行期间又有 drain 被请求；pendingWindowIds 执行期间新登记了窗口。
    // 不复用 rerunRequested 作循环条件：它会被「本轮无需补跑」的结果覆盖，导致第二轮误判已收敛。
    let needAnotherRound = false;
    do {
      needAnotherRound = false;
      rerunRequested = false;
      const windowIds = [...pendingWindowIds];
      pendingWindowIds.clear();
      for (const windowId of windowIds) {
        if (await reconcileWindow(windowId)) {
          // 本轮视图已过期：把窗口重新登记，下一轮用最新状态重新派生。
          needAnotherRound = true;
          pendingWindowIds.add(windowId);
        }
      }
      round += 1;
    } while (
      (needAnotherRound || rerunRequested || pendingWindowIds.size > 0) &&
      round < MAX_ROUNDS
    );
  } finally {
    running = false;
  }
}

/** 对单个窗口执行一轮对账；返回「派生视图已过期，需要补跑」标志。 */
async function reconcileWindow(windowId: number): Promise<boolean> {
  try {
    const settings = await settingsRepository.read();
    // opener（来源树）无法表达为原生组；关闭开关时组生命周期由 applyAutoGroupSetting 负责。
    if (!settings.autoGroupNative || settings.groupMode === 'opener') return false;

    const [tabs, excludedTabIds] = await Promise.all([
      queryWindowTabs(windowId),
      readFixedExcludedTabIds()
    ]);
    // tabGroups 能力缺失的环境返回空数组；查询失败不能拖垮整轮（按无组处理），但必须留痕：
    // 空组表会让本轮把已有分组判为不存在，进而可能重复建组。
    const groups = await queryWindowGroups(windowId).catch((error) => {
      logDegraded('auto-group', `窗口 ${windowId} 原生组查询失败，本轮按无组对账`, error);
      return [];
    });
    if (tabs.length === 0) return false;

    const sections = deriveSections({
      tabs,
      groups,
      excludedTabIds,
      groupMode: settings.groupMode,
      threshold: settings.aggregationThreshold,
      // 与面板同一份词条（语言模式的组标题需要它）；标题不参与任何判定，只是展示。
      translate: t
    });

    // 1) 纠正域名漂移。有移出说明本次派生视图已过期（被移出的标签仍算在组内），
    //    本轮不建组，交给下一轮重新聚合 —— 避免用过期视图产出重复组。
    if ((await reconcileAutoGroupDomains(sections)) > 0) return true;

    // 2) 建组 / 吸收同站点未分组标签。
    const plans = planAutoGroups(sections);
    if (plans.length > 0) await syncAutoGroups(plans);
    return false;
  } catch (error) {
    logDegraded('auto-group', `窗口 ${windowId} 自动分组对账失败`, error);
    return false;
  }
}
