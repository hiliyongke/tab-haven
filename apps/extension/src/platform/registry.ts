import { z } from 'zod';
import { DataRepository } from '@/platform/storage/DataRepository';
import {
  AUTO_GROUPS_RMW_LOCK,
  COLLAPSE_RMW_LOCK,
  FOLDERS_RMW_LOCK,
  PINS_RMW_LOCK,
  SNAPSHOTS_RMW_LOCK,
  UNDO_PERSIST_LOCK
} from '@/platform/storage/crossPageLock';
import {
  AutoDiscardBatchSchema,
  DEFAULT_SETTINGS,
  FixedFolderSchema,
  PersistentPinSchema,
  SettingsSchema,
  SiteCollapseSchema,
  SnapshotSchema,
  UndoBatchSchema
} from '@/core/schema/models';
import type {
  AutoDiscardBatch,
  FixedFolder,
  PersistentPin,
  Settings,
  SiteCollapseState,
  Snapshot,
  UndoBatch
} from '@/core/schema/models';

/**
 * 自动休眠台账保留的批次数上限（按 at 滚动淘汰最旧的）。
 *
 * 单槽位时第二轮休眠会整表覆盖第一轮 —— 面板只提示「最近一轮」，前一轮被冻结的
 * 标签就此失去「全部唤醒」出口。5 轮远超「连续几轮自动休眠后想一次性找回」的真实
 * 规模，同时把存储面钉死在有界区间（与全项目集合的既定原则一致）。
 */
export const AUTO_DISCARD_BATCHES_LIMIT = 5;

/**
 * 自动组 id 记录上限。500 远超真实规模（组数 ≤ 标签数），
 * 与全项目集合的既定原则一致：无界数组是唯一不受限的存储放大面。
 */
const AUTO_GROUPS_LIMIT = 500;

/**
 * 平台依赖组合根（composition root）。
 *
 * 所有持久化仓库在此集中实例化，对外只暴露 `getRepositories()` 访问器。
 *
 * 刻意**不提供**注入 setter：`platform/storage/repositories.ts` 在模块加载期就把
 * 实例冻结成具名常量导出，任何 import 具名常量的消费方都会绕开运行时替换，
 * 注入只对走 `getRepositories()` 的那一侧生效 —— 半边生效比不提供更容易骗人。
 * 需要脱离浏览器 API 的测试直接对纯函数 / fake browser 下手（见 tests/）。
 */

export interface Repositories {
  folders: DataRepository<FixedFolder[]>;
  pins: DataRepository<PersistentPin[]>;
  collapse: DataRepository<SiteCollapseState>;
  settings: DataRepository<Settings>;
  undo: DataRepository<UndoBatch[]>;
  /**
   * 重做栈：撤销成功后压入「本次被恢复回来的批次」，供「重做」再次关闭。
   * 结构与撤销栈完全相同（复用 UndoBatch），只是生命周期不同：
   * 任何新的关闭批次入栈即清空重做栈（重做只对最近一次撤销有意义）。
   */
  redo: DataRepository<UndoBatch[]>;
  autoGroups: DataRepository<number[]>;
  autoDiscard: DataRepository<AutoDiscardBatch[]>;
  seeded: DataRepository<boolean>;
  snapshots: DataRepository<Snapshot[]>;
}

/**
 * 各分区的 RMW 锁名传给仓库的原因：`read()` 的「逐元素恢复」会在读路径上做一次
 * 整表回写，那次回写基于读到的旧快照，锁外执行会让期间另一上下文写入的合法数据被
 * 整表覆盖。锁名与分区的对应关系在此处一一固定（锁名全集见 `crossPageLock.ts`）。
 *
 * 未配锁的分区（settings / autoDiscard / seeded）维持锁外回写：settings 与 seeded
 * 不是数组，恢复分支根本不会触发；autoDiscard 由 `autoDiscardLedger` 自行串行化。
 */
function createRepositories(): Repositories {
  return {
    folders: new DataRepository<FixedFolder[]>(
      'tabs.fixed-folders.v1',
      FixedFolderSchema.array(),
      [],
      { rmwLock: FOLDERS_RMW_LOCK }
    ),
    pins: new DataRepository<PersistentPin[]>(
      'tabs.persistent-pins.v1',
      PersistentPinSchema.array(),
      [],
      { rmwLock: PINS_RMW_LOCK }
    ),
    collapse: new DataRepository<SiteCollapseState>(
      'tabs.site-collapse.v1',
      SiteCollapseSchema,
      [],
      { rmwLock: COLLAPSE_RMW_LOCK }
    ),
    settings: new DataRepository<Settings>('tabs.settings.v1', SettingsSchema, DEFAULT_SETTINGS),
    // 撤销栈与重做栈是同一条「整表写」串行链的两个键，共用 UNDO_PERSIST_LOCK
    // （跨页并发入栈/出栈时后写覆盖先写会让已撤销批次复活）。
    undo: new DataRepository<UndoBatch[]>('tabs.undo-stack.v1', UndoBatchSchema.array(), [], {
      rmwLock: UNDO_PERSIST_LOCK
    }),
    // 重做栈（与撤销栈同结构）；不参与备份导出，也不参与同步镜像。
    redo: new DataRepository<UndoBatch[]>('tabs.redo-stack.v1', UndoBatchSchema.array(), [], {
      rmwLock: UNDO_PERSIST_LOCK
    }),
    // 自动组 id 记录只增靠 disband 清理，但上限仍须显式（全项目集合的既定原则）：
    // 无界数组是唯一不受限的存储放大面。500 远超真实规模（组数 ≤ 标签数）。
    autoGroups: new DataRepository<number[]>(
      'tabs.auto-groups.v1',
      z.array(z.number()).max(AUTO_GROUPS_LIMIT),
      [],
      { rmwLock: AUTO_GROUPS_RMW_LOCK }
    ),
    autoDiscard: new DataRepository<AutoDiscardBatch[]>(
      'tabs.auto-discard-batch.v1',
      z.array(AutoDiscardBatchSchema).max(AUTO_DISCARD_BATCHES_LIMIT),
      []
    ),
    // 首次启动标志：false 表示新设备（可从浏览器同步通道镜像恢复）。
    seeded: new DataRepository<boolean>('tabs.sync-seeded.v1', z.boolean(), false),
    // 快照列表（命名快照 + 关窗自动保存），本地优先、零账号。
    snapshots: new DataRepository<Snapshot[]>('tabs.snapshots.v1', SnapshotSchema.array(), [], {
      rmwLock: SNAPSHOTS_RMW_LOCK
    })
  };
}

const current: Repositories = createRepositories();

/**
 * 取用当前仓库集合。
 *
 * 只经本访问器对外暴露：`current` 是模块私有绑定，消费方拿不到可写引用，
 * 无法在运行时把仓库偷偷换掉。
 */
export function getRepositories(): Repositories {
  return current;
}
