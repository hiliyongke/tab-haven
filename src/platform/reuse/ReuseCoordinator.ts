import type { TabRecord } from '@/core/tab-types';
import { rankForKeep } from '@/core/dup/DedupeByUrl';
import { inspectUrl, webComparisonKey } from '@/core/url/UrlInspector';
import { AllowanceLedger } from '@/platform/reuse/AllowanceLedger';
import { ReusePolicy } from '@/platform/reuse/ReusePolicy';
import { logDegraded } from '@/platform/diagnostics';

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

type ReuseOutcome =
  { action: 'reuse'; targetId: number } | { action: 'keep' } | { action: 'release' };

interface ReuseCoordinatorDependencies {
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
    options: {
      allowances?: AllowanceLedger;
      policy?: ReusePolicy;
      enabled?: boolean;
      /** 豁免账本持久化恢复信号：首次消费前 await，防止 SW 重启早期令牌尚未恢复被漏判。 */
      allowancesReady?: Promise<void>;
    } = {}
  ) {
    this.deps = deps;
    this.allowances = options.allowances ?? new AllowanceLedger();
    this.policy = options.policy ?? new ReusePolicy();
    // fail-closed：缺省禁用。SW 冷启动时设置尚未读回（调用方异步同步），
    // 若默认开启，用户已关闭「同 URL 唯一化」仍会在该窗口期内被合并标签。
    this.enabled = options.enabled ?? false;
    this.allowancesReady = options.allowancesReady;
  }

  /** 豁免恢复门闩：只在恢复期间生效，恢复完成后置空（后续 drain 零开销）。 */
  private allowancesReady?: Promise<void>;

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
    // 归一化后再入账：消费侧（inspect）永远用 comparisonKey（主机小写/剥离默认端口），
    // 发放侧若直接存原始 URL（导入备份里的 `HTTPS://A.COM`、无尾斜杠写法等），
    // 令牌会失配残留，显式恢复的标签反被合并。非 web URL 归一化返回 null，原样入账兜底。
    this.allowances.grant(windowId, webComparisonKey(url, undefined) ?? url);
  }

  private requestDrain(): void {
    if (this.draining) return;
    this.draining = true;
    void this.drain()
      .catch((error) => {
        logDegraded('reuse-coordinator', '复用调度循环异常', error);
      })
      .finally(() => {
        this.draining = false;
      });
  }

  /** 串行处理所有脏任务（latest-wins：每轮读取任务的最新快照）。 */
  private async drain(): Promise<void> {
    // 首轮处理前等待豁免账本恢复完成（一次性门闩；无持久化时立即通过）。
    if (this.allowancesReady) {
      const ready = this.allowancesReady;
      this.allowancesReady = undefined;
      await ready.catch(() => {});
    }
    for (;;) {
      const entry = this.nextDirty();
      if (!entry) return;
      const { tabId, task } = entry;
      task.dirty = false;
      try {
        const outcome = await this.inspect(task.latest);
        // 结算删除要看 dirty：inspect 内含 await（scanWindow），期间到达的更新
        // 会把 dirty 重新置位（见头部并发模型注释「处理期间到达的更新在下轮
        // 循环读取最新快照」）——不看 dirty 会把这些更新随任务一起丢弃。
        if (outcome !== 'wait' && !task.dirty) this.tasks.delete(tabId);
      } catch (error) {
        // 单任务异常（典型：扫描与结算之间标签被用户关闭）不得中断整个调度循环，
        // 否则队列中其余脏任务会被永久滞留。按结算处理；若处理期间又收到更新则保留任务。
        // 走诊断管道而非 console.warn：SW 内的 console 输出无法被 readAllDiagnostics 导出。
        logDegraded('reuse-coordinator', `复用检查失败（标签 ${tabId}）`, error);
        if (!task.dirty) this.tasks.delete(tabId);
      }
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
        // 开关复核：scanWindow 之前开关可能已被关闭（setEnabled(false) 清空了
        // tasks，但在途 inspect 不受影响），继续结算会把用户明确要求保留的
        // 副本关闭——结算前再确认一次开关状态。
        if (!this.enabled) return { action: 'keep' };
        const windowTabs = await this.deps.scanWindow(tab.windowId);
        const decision = this.policy.decide(tab, windowTabs, new Set(this.tasks.keys()));
        if (decision.kind === 'standalone') {
          return tab.status === 'complete' ? { action: 'keep' } : 'wait';
        }
        // 全量唯一化：保留「最近访问」的既有标签，关闭其余既有 + 新建标签。
        const key = inspection.comparisonKey;
        const existing = windowTabs.filter(
          (candidate) =>
            candidate.id !== tab.id && webComparisonKey(candidate.url, candidate.pendingUrl) === key
        );
        const keep = rankForKeep(existing);
        if (!keep) return { action: 'keep' }; // 防御：既有标签已全部消失
        // 关闭前复核：scanWindow 是异步全窗口查询，在途期间用户可能已把新标签
        // 导航到别的页面（handleUpdated 已更新 latest）。仍按旧快照关闭会误关
        // 用户正在浏览的标签——结算前用最新快照的 URL 复核一次，不一致即放弃。
        const latest = this.tasks.get(tab.id)?.latest;
        if (latest && webComparisonKey(latest.url, latest.pendingUrl) !== key) {
          return { action: 'keep' };
        }
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
