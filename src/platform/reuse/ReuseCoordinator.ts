import type { TabRecord } from '@/core/tab-types';
import { rankForKeep } from '@/core/dup/DedupeByUrl';
import { inspectUrl } from '@/core/url/UrlInspector';
import { AllowanceLedger } from '@/platform/reuse/AllowanceLedger';
import { ReusePolicy } from '@/platform/reuse/ReusePolicy';

/**
 * 复用协调器：跟踪新标签生命周期，调度重复检测并以复用结果结算。
 *
 * 并发模型（全新设计）：每个待检标签一个 Task（状态机），
 * 事件到达只更新"最新快照"（latest-wins）；调度器以微任务 drain 串行
 * 处理脏任务，避免并发竞态——任务处理期间到达的更新在下轮循环读取最新快照。
 *
 * Task 状态机：Tracked（事件驱动更新）→ 检查中（drain 内）→ Settled（结算）
 * 结算结果：settle-standalone（保留，完成导航后释放）、reuse（合并）、settle-quiet（豁免放行）。
 */

type TaskStatus = 'tracked' | 'settled';

interface PendingTask {
  latest: TabRecord;
  dirty: boolean;
  status: TaskStatus;
}

export type ReuseOutcome =
  | { action: 'reuse'; targetId: number }
  | { action: 'keep' }
  | { action: 'release' };

export interface ReuseCoordinatorDependencies {
  /** 扫描窗口内全部标签（查询服务注入，便于测试）。 */
  scanWindow: (windowId: number) => Promise<TabRecord[]>;
  /** 激活目标标签。 */
  activate: (tabId: number) => Promise<void>;
  /** 关闭新标签。 */
  close: (tabId: number) => Promise<void>;
  /** 复用发生时通知 UI（状态提示）。 */
  notifyReuse: () => void;
}

export class ReuseCoordinator {
  private readonly tasks = new Map<number, PendingTask>();
  private readonly allowances: AllowanceLedger;
  private readonly policy: ReusePolicy;
  private readonly deps: ReuseCoordinatorDependencies;
  private draining = false;
  /** 是否启用（同 URL 唯一化开关；关闭后停止追踪与合并）。 */
  private enabled: boolean;

  constructor(
    deps: ReuseCoordinatorDependencies,
    options: { allowances?: AllowanceLedger; policy?: ReusePolicy; enabled?: boolean } = {}
  ) {
    this.deps = deps;
    this.allowances = options.allowances ?? new AllowanceLedger();
    this.policy = options.policy ?? new ReusePolicy();
    this.enabled = options.enabled ?? true;
  }

  /** 开关联动（设置变更时调用）。关闭时清空追踪任务，允许同 URL 多开。 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.tasks.clear();
  }

  /** 新标签创建（事件源：tabs.onCreated）。 */
  handleCreated(tab: TabRecord): void {
    if (!this.enabled) return;
    if (tab.incognito) return;
    this.tasks.set(tab.id, { latest: tab, dirty: true, status: 'tracked' });
    this.requestDrain();
  }

  /** 标签导航更新（事件源：tabs.onUpdated，仅 url/status 变化触发）。 */
  handleUpdated(tabId: number, changed: { url?: boolean; status?: boolean }, tab: TabRecord): void {
    if (!this.enabled) return;
    if (!changed.url && !changed.status) return;
    const task = this.tasks.get(tabId);
    if (!task) return;
    task.latest = tab;
    task.dirty = true;
    this.requestDrain();
  }

  /** 标签关闭（事件源：tabs.onRemoved）。 */
  handleRemoved(tabId: number): void {
    this.tasks.delete(tabId);
  }

  /** 为指定窗口/网址发放豁免授权（显式复制/撤销恢复场景）。 */
  grantAllowance(windowId: number, url: string): void {
    this.allowances.grant(windowId, url);
  }

  private requestDrain(): void {
    if (this.draining) return;
    this.draining = true;
    void this.drain()
      .catch(console.error)
      .finally(() => {
        this.draining = false;
      });
  }

  /** 串行处理所有脏任务（latest-wins：每轮读取任务的最新快照）。 */
  private async drain(): Promise<void> {
    for (;;) {
      const entry = this.nextDirty();
      if (!entry) return;
      const { tabId, task } = entry;
      task.dirty = false;
      const outcome = await this.inspect(task.latest);
      if (outcome !== 'wait') this.tasks.delete(tabId);
    }
  }

  private nextDirty(): { tabId: number; task: PendingTask } | undefined {
    for (const [tabId, task] of this.tasks) {
      if (task.dirty) return { tabId, task };
    }
    return undefined;
  }

  /**
   * 单任务检查。返回 'wait' 表示仍需等待后续导航（任务保留）；
   * 其余结果任务结算（从追踪中移除）。
   */
  private async inspect(tab: TabRecord): Promise<ReuseOutcome | 'wait'> {
    const inspection = inspectUrl(tab.url, tab.pendingUrl);

    // 豁免：显式要求保留副本 → 放行并结算
    if (this.allowances.consume(tab.windowId, inspection.comparisonKey)) {
      return { action: 'keep' };
    }

    switch (inspection.category) {
      case 'internal': {
        // 内部页从不参与复用；导航完成即结算，未完成继续等待
        return tab.status === 'complete' ? { action: 'keep' } : 'wait';
      }
      case 'blank-start': {
        // 空白起始页：等待真实导航
        return 'wait';
      }
      case 'web': {
        const windowTabs = await this.deps.scanWindow(tab.windowId);
        const decision = this.policy.decide(tab, windowTabs, new Set(this.tasks.keys()));
        if (decision.kind === 'standalone') {
          return tab.status === 'complete' ? { action: 'keep' } : 'wait';
        }
        // 全量唯一化：保留「最近访问」的既有标签，关闭其余既有 + 新建标签。
        const inspection = inspectUrl(tab.url, tab.pendingUrl);
        const existing = windowTabs.filter(
          (candidate) =>
            candidate.id !== tab.id &&
            inspectUrl(candidate.url, candidate.pendingUrl).comparisonKey ===
              inspection.comparisonKey
        );
        const keep = rankForKeep(existing);
        if (!keep) return { action: 'keep' }; // 防御：既有标签已全部消失
        await this.deps.activate(keep.id);
        for (const candidate of existing) {
          if (candidate.id !== keep.id) await this.deps.close(candidate.id);
        }
        await this.deps.close(tab.id);
        this.deps.notifyReuse();
        return { action: 'reuse', targetId: keep.id };
      }
    }
  }
}
