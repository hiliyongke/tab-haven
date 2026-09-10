import i18n from '@/i18n';
import {
  createFolderItem,
  createFolder as createFolderModel,
  dedupePins
} from '@/core/fixed/FolderOps';
import { fixedItemKey } from '@/core/commands/folderCommands';
import { EXPORT_FILE_VERSION, parseExportFile, type Settings } from '@/core/schema/models';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { logFailure } from '@/platform/diagnostics';
import { SNAPSHOTS_RMW_LOCK } from '@/platform/snapshot/snapshots';
import { withCrossPageLock } from '@/platform/storage/crossPageLock';
import { applyTheme } from '@/platform/theme/ThemeApplier';
import { isExportableUrl, readBookmarkBar } from '@/platform/bookmarks';
import type { DataContext, DataState } from './types';

/** 备份切片：完整导出 / 事务化导入 / 书签栏导入。 */
export function createTransferSlice(ctx: DataContext): Partial<DataState> {
  return {
    /**
     * 导出为完整备份：固定空间 + 设置 + 全部快照族。
     *
     * 快照直读仓库而非内存桥：导出入口在设置页，而设置页从不加载 snapshotStore——
     * 走内存桥会静默导出 `snapshots: []`，用户拿这份备份恢复时快照全丢。
     * 直读仓库同时拿到最新值（面板打开期间 background 可能写入关窗自动快照）。
     */
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

    /**
     * 导入为事务：五个分区（文件夹 / 固定图标 / 折叠态 / 设置 / 快照族）全部落盘成功后才切换内存态。
     *
     * 早期实现用 Promise.all 并发写且只看是否 reject——DataRepository.write 以 boolean
     * 表达失败，于是「部分分区写成功」也会整体提示导入成功，用户以为已完成备份迁移。
     * 现改为串行写 + 失败回滚：任一分区写失败即把已写入的分区还原为导入前的值。
     */
    importData: async (raw) => {
      // 互斥：并发导入（或导入期间拖拽重排走 coalesced 通道）会让分区写交错，
      // 回滚只能回到「对方的中间态」。导入是低频重操作，直接拒绝重入。
      if (ctx.isImporting()) throw new Error('import-in-progress');
      // 与清空事务互斥：清空进行中导入，导入事务会把已清空的存储回填（反之亦然）。
      if (ctx.isClearing()) throw new Error('clear-in-progress');
      const parsed = parseExportFile(raw);
      if (!parsed.success) throw new Error('invalid-tabs-export');
      const data = parsed.data;

      ctx.setImporting(true);
      // 同步到 store 状态：导入期间固定空间写入会被丢弃，UI 必须能看见这个状态，
      // 否则拖拽「没反应」无从解释（见 DataState.importing）。
      ctx.set({ importing: true });
      // 导入期间挂起 watcher 回写：storage.onChanged 在写入方本页同样触发，
      // 若放任其回写内存，会出现「UI 已显示导入后数据、随后写入失败回滚」的窗口。
      ctx.setWatchersSuspended(true);
      try {
        // 丢弃导入开始前已排队/在途的合并写入（携带旧数据），避免其与导入的串行写交错、
        // 把导入结果覆盖回旧值。cancelWrites 返回时写入器已空闲，后续读 before / 串行写均安全。
        await ctx.cancelWrites();
        // 回滚值一律直读磁盘：内存态可能已被 watcher 或另一页面改写，
        // 用内存值回滚会把别人的数据反向覆盖到磁盘（回滚本身变成数据丢失）。
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
        // 备份文件可被任意构造：含重复 identity 的 pin / 重复 URL 条目若原样提交，
        // 会立即渲染出重复磁贴与重复条目（其余路径均做去重，导入必须同口径）。
        // 顺序保持原序，按「全空间首见保留」清理，与固定空间的唯一性不变量一致。
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
        // 同步开关不随备份迁移：备份文件可被任意构造，若其中 syncMirrorEnabled 为 true，
        // 导入即会在 500ms 后把全部固定 URL 推上浏览器账号通道，用户完全无感知。
        // 保留用户当下的选择——要开同步必须是一次显式操作。
        const importedSettings: Settings = {
          ...data.settings,
          syncMirrorEnabled: before.settings.syncMirrorEnabled
        };

        const steps: {
          name: string;
          write: () => Promise<boolean>;
          rollback: () => Promise<boolean>;
        }[] = [
          {
            name: 'folders',
            write: () => ctx.repos.folders.write(importedFolders),
            rollback: () => ctx.repos.folders.write(before.folders)
          },
          {
            name: 'pins',
            write: () => ctx.repos.pins.write(importedPins),
            rollback: () => ctx.repos.pins.write(before.pins)
          },
          {
            name: 'siteCollapse',
            write: () => ctx.repos.collapse.write(data.siteCollapse),
            rollback: () => ctx.repos.collapse.write(before.collapse)
          },
          {
            name: 'settings',
            write: () => ctx.repos.settings.write(importedSettings),
            rollback: () => ctx.repos.settings.write(before.settings)
          },
          // 快照可能体积较大，放在最后：前面任一分区失败时不必先写再回滚大数据块。
          // 快照分区必须走 SNAPSHOTS_RMW_LOCK：导入事务持续数百 ms，期间 background
          // 的关窗自动保存/定时快照在锁内 RMW，锁外整表写会把它们覆盖丢失（反之亦然）。
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
          // 回滚已写入的分区；回滚本身失败仅告警（尽力而为），但必须在错误信息中如实告知。
          const rollbackFailures: string[] = [];
          for (const written of done) {
            const restored = await written.rollback();
            if (!restored) rollbackFailures.push(written.name);
          }
          const message = `导入失败：分区 ${step.name} 写入未成功，已回滚${rollbackFailures.length > 0 ? `；回滚未完成的分区：${rollbackFailures.join(', ')}` : ''}`;
          logFailure('dataStore', message);
          throw new Error(`import-write-failed:${step.name}`);
        }

        ctx.set({
          folders: importedFolders,
          pins: importedPins,
          collapsedSites: data.siteCollapse,
          settings: importedSettings
        });
        // 快照属于 snapshotStore 的内存态：本 store 不持有，交由其自行感知仓库变更
        // （snapshotStore.load 已 watch 仓库，写入后会自动同步列表与角标）。
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
      // updater：readBookmarkBar 的 await 期间基线可能已变（并发文件夹操作），
      // 合并必须以写前一刻的最新 folders 重放，否则整表回写会覆盖那些变更。
      await ctx.writeFolders((current) => {
        const seen = new Set<string>();
        for (const folder of current) {
          for (const item of folder.items) {
            seen.add(webComparisonKey(item.url ?? '', undefined) ?? item.url ?? '');
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
          // 只导入 http(s) 条目：书签栏可能含 javascript:/data: 等书签，
          // 落为固定项后点击即在标签上下文执行脚本（与导出侧白名单同一原则）。
          const leaves = uniqueLeaves(spec.leaves.filter((leaf) => isExportableUrl(leaf.url)));
          if (leaves.length === 0) continue;
          const items = leaves.map((leaf) =>
            createFolderItem({ url: leaf.url, title: leaf.title })
          );
          const existing = next.find((folder) => folder.name === spec.name);
          if (existing) {
            next = next.map((folder) =>
              folder.id === existing.id ? { ...folder, items: [...folder.items, ...items] } : folder
            );
          } else {
            next = [...next, { ...createFolderModel(spec.name), items }];
            foldersCreated += 1;
          }
          itemsImported += items.length;
        }
        if (bar.looseLeaves.length > 0) {
          const leaves = uniqueLeaves(bar.looseLeaves.filter((leaf) => isExportableUrl(leaf.url)));
          if (leaves.length > 0) {
            const name = i18n.t('fixed.bookmarksImportName');
            const items = leaves.map((leaf) =>
              createFolderItem({ url: leaf.url, title: leaf.title })
            );
            const existing = next.find((folder) => folder.name === name);
            if (existing) {
              next = next.map((folder) =>
                folder.id === existing.id
                  ? { ...folder, items: [...folder.items, ...items] }
                  : folder
              );
            } else {
              next = [...next, { ...createFolderModel(name), items }];
              foldersCreated += 1;
            }
            itemsImported += items.length;
          }
        }
        return next;
      });
      return { foldersCreated, itemsImported };
    }
  };
}
