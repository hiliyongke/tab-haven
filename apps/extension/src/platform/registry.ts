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
 * 单槽位时第二轮休眠会整表覆盖第一轮，前一轮被冻结的标签就此失去「全部唤醒」出口；
 * 5 轮远超真实规模，同时把存储面钉死在有界区间。
 */
export const AUTO_DISCARD_BATCHES_LIMIT = 5;

/** 自动组 id 记录上限：无界数组是唯一不受限的存储放大面，500 远超真实规模（组数 ≤ 标签数）。 */
const AUTO_GROUPS_LIMIT = 500;

/**
 * 平台依赖组合根（composition root）：所有持久化仓库在此集中实例化，对外只暴露 getRepositories()。
 * 刻意不提供注入 setter：repositories.ts 在模块加载期就把实例冻结成具名常量导出，任何 import 具名常量的
 * 消费方都会绕开运行时替换，注入只对走 getRepositories() 的一侧生效 —— 半边生效比不提供更容易骗人。
 */

export interface Repositories {
  folders: DataRepository<FixedFolder[]>;
  pins: DataRepository<PersistentPin[]>;
  collapse: DataRepository<SiteCollapseState>;
  settings: DataRepository<Settings>;
  undo: DataRepository<UndoBatch[]>;
  /** 重做栈：撤销成功后压入「本次被恢复回来的批次」供「重做」再次关闭；任何新的关闭批次入栈即清空。 */
  redo: DataRepository<UndoBatch[]>;
  autoGroups: DataRepository<number[]>;
  autoDiscard: DataRepository<AutoDiscardBatch[]>;
  seeded: DataRepository<boolean>;
  snapshots: DataRepository<Snapshot[]>;
}

/**
 * 各分区的 RMW 锁名传给仓库的原因：read() 的「逐元素恢复」在读路径上做一次基于旧快照的整表回写，
 * 锁外执行会覆盖期间另一上下文写入的合法数据。锁名与分区在此一一固定（锁名全集见 crossPageLock.ts）。
 * 未配锁的分区（settings / autoDiscard / seeded）维持锁外回写：settings 与 seeded 不是数组，
 * 恢复分支根本不触发；autoDiscard 由 autoDiscardLedger 自行串行化。
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
    // 撤销栈与重做栈是同一条「整表写」串行链的两个键，共用 UNDO_PERSIST_LOCK。
    undo: new DataRepository<UndoBatch[]>('tabs.undo-stack.v1', UndoBatchSchema.array(), [], {
      rmwLock: UNDO_PERSIST_LOCK
    }),
    // 重做栈（与撤销栈同结构）；不参与备份导出，也不参与同步镜像。
    redo: new DataRepository<UndoBatch[]>('tabs.redo-stack.v1', UndoBatchSchema.array(), [], {
      rmwLock: UNDO_PERSIST_LOCK
    }),
    // 自动组 id 记录只增靠 disband 清理，上限仍须显式（无界数组是唯一不受限的存储放大面）。
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

/** 取用当前仓库集合：只经本访问器暴露，current 是模块私有绑定，消费方拿不到可写引用。 */
export function getRepositories(): Repositories {
  return current;
}
