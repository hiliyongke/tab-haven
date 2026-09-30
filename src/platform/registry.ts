import { z } from 'zod';
import { DataRepository } from '@/platform/storage/DataRepository';
import {
  AutoDiscardBatchSchema,
  DEFAULT_SETTINGS,
  FixedFolderSchema,
  PersistentPinSchema,
  READLATER_LIMIT,
  ReadLaterItemSchema,
  SettingsSchema,
  SiteCollapseSchema,
  SnapshotSchema,
  UndoBatchSchema
} from '@/core/schema/models';
import type {
  AutoDiscardBatch,
  FixedFolder,
  PersistentPin,
  ReadLaterItem,
  Settings,
  SiteCollapseState,
  Snapshot,
  UndoBatch
} from '@/core/schema/models';

/**
 * 平台依赖组合根（composition root）。
 *
 * 所有持久化仓库在此集中实例化，对外只暴露 `getRepositories()` 访问器，
 * 不直接导出可变单例。测试时用 `setRepositoriesForTest()` 注入内存假实现，
 * 使 stores 可脱离浏览器 API 单测。
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
  autoDiscard: DataRepository<AutoDiscardBatch | null>;
  seeded: DataRepository<boolean>;
  snapshots: DataRepository<Snapshot[]>;
  readLater: DataRepository<ReadLaterItem[]>;
}

function createRepositories(): Repositories {
  return {
    folders: new DataRepository<FixedFolder[]>(
      'tabs.fixed-folders.v1',
      FixedFolderSchema.array(),
      []
    ),
    pins: new DataRepository<PersistentPin[]>(
      'tabs.persistent-pins.v1',
      PersistentPinSchema.array(),
      []
    ),
    collapse: new DataRepository<SiteCollapseState>(
      'tabs.site-collapse.v1',
      SiteCollapseSchema,
      []
    ),
    settings: new DataRepository<Settings>('tabs.settings.v1', SettingsSchema, DEFAULT_SETTINGS),
    undo: new DataRepository<UndoBatch[]>('tabs.undo-stack.v1', UndoBatchSchema.array(), []),
    // 重做栈（与撤销栈同结构）；不参与备份导出，也不参与同步镜像。
    redo: new DataRepository<UndoBatch[]>('tabs.redo-stack.v1', UndoBatchSchema.array(), []),
    // 自动组 id 记录只增靠 disband 清理，但上限仍须显式（全项目集合的既定原则）：
    // 无界数组是唯一不受限的存储放大面。500 远超真实规模（组数 ≤ 标签数）。
    autoGroups: new DataRepository<number[]>(
      'tabs.auto-groups.v1',
      z.array(z.number()).max(500),
      []
    ),
    autoDiscard: new DataRepository<AutoDiscardBatch | null>(
      'tabs.auto-discard-batch.v1',
      AutoDiscardBatchSchema.nullable(),
      null
    ),
    // 首次启动标志：false 表示新设备（可从浏览器同步通道镜像恢复）。
    seeded: new DataRepository<boolean>('tabs.sync-seeded.v1', z.boolean(), false),
    // 会话快照列表（命名快照 + 关窗自动保存），本地优先、零账号。
    snapshots: new DataRepository<Snapshot[]>('tabs.snapshots.v1', SnapshotSchema.array(), []),
    // 稍后读分区：独立于固定文件夹的「一次性消费」暂存区，不参与同步镜像。
    readLater: new DataRepository<ReadLaterItem[]>(
      'tabs.read-later.v1',
      ReadLaterItemSchema.array().max(READLATER_LIMIT),
      []
    )
  };
}

let current: Repositories = createRepositories();

/** 取用当前仓库集合（默认实现，或测试注入的假实现）。 */
export function getRepositories(): Repositories {
  return current;
}

/** 测试/注入用：整体替换为自定义仓库实现。 */
export function setRepositoriesForTest(next: Repositories): void {
  current = next;
}
