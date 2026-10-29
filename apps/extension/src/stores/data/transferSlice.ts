import {
  createFolderItem,
  createFolder as createFolderModel,
  dedupePins
} from '@/core/fixed/FolderOps';
import { DEFAULT_FOLDER_NAMES } from '@/core/snapshot/defaultNames';
import { fixedItemKey } from '@/core/fixed/FolderOps';
import { EXPORT_FILE_VERSION, parseExportFile, type Settings } from '@/core/schema/models';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { logFailure } from '@/platform/diagnostics';
import {
  COLLAPSE_RMW_LOCK,
  FOLDERS_RMW_LOCK,
  PINS_RMW_LOCK,
  SETTINGS_RMW_LOCK,
  SNAPSHOTS_RMW_LOCK,
  withCrossPageLock
} from '@/platform/storage/crossPageLock';
import { mutateSession } from '@/platform/storage/session';
import { applyTheme } from '@/platform/theme/ThemeApplier';
import { isExportableUrl, readBookmarkBar } from '@/platform/bookmarks';
import type { DataContext, DataSlice } from './types';
import type { FixedFolder, FixedFolderItem } from '@/core/schema/models';

/** 按名把条目并入固定空间：同名文件夹追加，否则新建（书签栏与散落条目两处导入共用）。 */
function mergeFolderByName(
  current: readonly FixedFolder[],
  name: string,
  items: readonly FixedFolderItem[]
): { next: FixedFolder[]; created: boolean } {
  const existing = current.find((folder) => folder.name === name);
  if (existing) {
    return {
      next: current.map((folder) =>
        folder.id === existing.id ? { ...folder, items: [...folder.items, ...items] } : folder
      ),
      created: false
    };
  }
  return { next: [...current, { ...createFolderModel(name), items: [...items] }], created: true };
}

/** 单分区回滚：吞掉锁异常（AbortError 等）只回报成败，避免中断整个回滚链留下半套数据。 */
async function safeRollback(step: {
  name: string;
  rollback: () => Promise<boolean>;
}): Promise<boolean> {
  try {
    return await step.rollback();
  } catch (error) {
    // 仅进诊断日志（logFailure），不进界面，故不翻译
    // @i18n-ignore
    logFailure('dataStore', `导入回滚失败：分区 ${step.name} 未还原`, error);
    return false;
  }
}

/** 备份切片：完整导出 / 事务化导入 / 书签栏导入。 */
export function createTransferSlice(
  ctx: DataContext
): DataSlice<'exportData' | 'importData' | 'importBookmarksFromBar'> {
  return {
    /** 导出完整备份。快照直读仓库：设置页不加载 snapshotStore，走内存桥会静默导出空数组。 */
    exportData: async () => ({
      format: 'tabs.export' as const,
      version: EXPORT_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      fixedFolders: ctx.get().folders,
      persistentPins: ctx.get().pins,
      siteCollapse: ctx.get().collapsedSites,
      settings: ctx.get().settings,
      snapshots: await ctx.repos.snapshots.read()
    }),

    /** 事务化导入：五个分区全部落盘成功才切内存态；任一分区写失败即回滚已写入的分区。 */
    importData: async (raw) => {
      // 互斥：并发导入或与清空事务并发会让分区写交错、回滚只能回到对方中间态。
      if (ctx.isImporting()) throw new Error('import-in-progress');
      if (ctx.isClearing()) throw new Error('clear-in-progress');
      const parsed = parseExportFile(raw);
      if (!parsed.success) {
        throw new Error(
          parsed.reason === 'version-mismatch' ? 'export-version-mismatch' : 'invalid-tabs-export'
        );
      }
      const data = parsed.data;

      ctx.setImporting(true);
      ctx.set({ importing: true });
      // 导入期间挂起 watcher 回写：storage.onChanged 会在本页同样触发，避免回滚窗口的内存抖动。
      ctx.setWatchersSuspended(true);
      try {
        // 丢弃已排队/在途的合并写入，避免与导入的串行写交错把结果覆盖回旧值。
        await ctx.cancelWrites();
        // 回滚值直读磁盘：内存态可能已被 watcher 或另一页面改写，用它回滚等于反向丢数据。
        const [beforeFolders, beforePins, beforeCollapse, beforeSettings, beforeSnapshots] =
          await Promise.all([
            ctx.repos.folders.read(),
            ctx.repos.pins.read(),
            ctx.repos.collapse.read(),
            ctx.repos.settings.read(),
            ctx.repos.snapshots.read()
          ]);
        const before = {
          folders: beforeFolders,
          pins: beforePins,
          collapse: beforeCollapse,
          settings: beforeSettings,
          snapshots: beforeSnapshots
        };
        // 备份可被任意构造：重复 identity/URL 按「全空间首见保留」清理，与固定空间唯一性一致。
        const importedPins = dedupePins(data.persistentPins);
        const seenKeys = new Set<string>();
        const importedFolders = data.fixedFolders.map((folder) => ({
          ...folder,
          items: folder.items.filter((item) => {
            const key = fixedItemKey(item.url);
            if (key === null) return true;
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
          })
        }));
        // 会「替用户做出授权动作」的开关不随备份迁移（要开必须显式操作）：
        // syncMirrorEnabled=true 会静默把固定 URL 推上云；noCacheEnabled=true 会让 DNR 规则立即生效。
        // noCachePatterns 列表照常导入（schema 层已归一化，开关关闭时无副作用）。
        const importedSettings: Settings = {
          ...data.settings,
          syncMirrorEnabled: before.settings.syncMirrorEnabled,
          noCacheEnabled: before.settings.noCacheEnabled
        };

        const steps: {
          name: string;
          write: () => Promise<boolean>;
          rollback: () => Promise<boolean>;
        }[] = [
          // 各分区走各自 RMW 锁：导入期间 background 右键写入/面板 coalesced 写都在锁内 RMW。
          {
            name: 'folders',
            write: () =>
              withCrossPageLock(FOLDERS_RMW_LOCK, () => ctx.repos.folders.write(importedFolders)),
            rollback: () =>
              withCrossPageLock(FOLDERS_RMW_LOCK, () => ctx.repos.folders.write(before.folders))
          },
          {
            name: 'pins',
            write: () => withCrossPageLock(PINS_RMW_LOCK, () => ctx.repos.pins.write(importedPins)),
            rollback: () =>
              withCrossPageLock(PINS_RMW_LOCK, () => ctx.repos.pins.write(before.pins))
          },
          {
            name: 'siteCollapse',
            write: () =>
              withCrossPageLock(COLLAPSE_RMW_LOCK, () =>
                ctx.repos.collapse.write(data.siteCollapse)
              ),
            rollback: () =>
              withCrossPageLock(COLLAPSE_RMW_LOCK, () => ctx.repos.collapse.write(before.collapse))
          },
          {
            name: 'settings',
            write: () =>
              withCrossPageLock(SETTINGS_RMW_LOCK, () =>
                ctx.repos.settings.write(importedSettings)
              ),
            rollback: () =>
              withCrossPageLock(SETTINGS_RMW_LOCK, () => ctx.repos.settings.write(before.settings))
          },
          {
            name: 'snapshots',
            write: () =>
              withCrossPageLock(SNAPSHOTS_RMW_LOCK, () =>
                ctx.repos.snapshots.write(data.snapshots)
              ),
            rollback: () =>
              withCrossPageLock(SNAPSHOTS_RMW_LOCK, () =>
                ctx.repos.snapshots.write(before.snapshots)
              )
          }
        ];

        const done: (typeof steps)[number][] = [];
        for (const step of steps) {
          const ok = await step.write();
          if (ok) {
            done.push(step);
            continue;
          }
          // 回滚已写入分区；回滚本身失败仅告警（尽力而为），但须在错误信息中如实告知。
          const rollbackFailures: string[] = [];
          for (const written of done) {
            // 每个 rollback 包异常保护：锁请求在面板关闭时以 AbortError reject，不中断回滚链。
            const restored = await safeRollback(written);
            if (!restored) rollbackFailures.push(written.name);
          }
          // 仅进诊断日志（logFailure），不进界面，故不翻译
          // @i18n-ignore
          const message = `导入失败：分区 ${step.name} 写入未成功，已回滚${rollbackFailures.length > 0 ? `；回滚未完成的分区：${rollbackFailures.join(', ')}` : ''}`;
          logFailure('dataStore', message);
          throw new Error(`import-write-failed:${step.name}`);
        }

        ctx.set({
          folders: importedFolders,
          pins: importedPins,
          collapsedSites: data.siteCollapse,
          settings: importedSettings,
          // 导入替换全部数据分区后，镜像状态由下一次拉取重新判定。
          mirrorIssue: null
        });
        // 备份替换 folders 后，绑定 id 可能指向不同网址；清空绑定并由 reconcileWithTabs 按 URL 重建，
        // 避免无关标签从临时区排除或被条目点击激活。
        const rebound = await mutateSession(() => ({ itemTabBindings: {} }));
        ctx.applyBindings(rebound);
        applyTheme(importedSettings.themePreference, importedSettings.colorTheme);
        ctx.scheduleMirror(ctx.get());
        ctx.broadcastSettingsSynced();
      } finally {
        ctx.setImporting(false);
        ctx.set({ importing: false });
        ctx.setWatchersSuspended(false);
      }
    },

    importBookmarksFromBar: async () => {
      const bar = await readBookmarkBar();
      let foldersCreated = 0;
      let itemsImported = 0;
      // updater：readBookmarkBar 的 await 期间基线可能已变，合并以写前一刻最新 folders 重放。
      await ctx.writeFolders((current) => {
        const seen = new Set<string>();
        for (const folder of current) {
          for (const item of folder.items) {
            // 无 URL 条目（挂起项）没有可比较的键，跳过——空串会让它们共用一个 key 被误判重复。
            const key = item.url ? (webComparisonKey(item.url, undefined) ?? item.url) : undefined;
            if (key) seen.add(key);
          }
        }
        const uniqueLeaves = (
          leaves: { url: string; title: string }[]
        ): { url: string; title: string }[] => {
          const next: { url: string; title: string }[] = [];
          for (const leaf of leaves) {
            const key = webComparisonKey(leaf.url, undefined) ?? leaf.url;
            if (seen.has(key)) continue;
            seen.add(key);
            next.push(leaf);
          }
          return next;
        };
        let next = current;
        for (const spec of bar.folders) {
          // 只导入 http(s)：javascript:/data: 落为固定项后点击即执行脚本（与导出侧白名单同源）。
          const leaves = uniqueLeaves(spec.leaves.filter((leaf) => isExportableUrl(leaf.url)));
          if (leaves.length === 0) continue;
          const items = leaves.map((leaf) =>
            createFolderItem({ url: leaf.url, title: leaf.title })
          );
          const merged = mergeFolderByName(next, spec.name, items);
          next = merged.next;
          if (merged.created) foldersCreated += 1;
          itemsImported += items.length;
        }
        if (bar.looseLeaves.length > 0) {
          const leaves = uniqueLeaves(bar.looseLeaves.filter((leaf) => isExportableUrl(leaf.url)));
          if (leaves.length > 0) {
            const name = DEFAULT_FOLDER_NAMES.bookmarkImport;
            const items = leaves.map((leaf) =>
              createFolderItem({ url: leaf.url, title: leaf.title })
            );
            const merged = mergeFolderByName(next, name, items);
            next = merged.next;
            if (merged.created) foldersCreated += 1;
            itemsImported += items.length;
          }
        }
        return next;
      });
      return { foldersCreated, itemsImported };
    }
  };
}
