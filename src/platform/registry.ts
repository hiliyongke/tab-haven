import { z } from 'zod';
import { DataRepository } from '@/platform/storage/DataRepository';
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
  autoGroups: DataRepository<number[]>;
  autoDiscard: DataRepository<AutoDiscardBatch | null>;
  seeded: DataRepository<boolean>;
  snapshots: DataRepository<Snapshot[]>;
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
    snapshots: new DataRepository<Snapshot[]>('tabs.snapshots.v1', SnapshotSchema.array(), [])
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
