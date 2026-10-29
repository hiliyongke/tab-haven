import { syncMirror } from '@/platform/storage/SyncMirror';
import { clearAllStoredData } from '@/platform/storage/DataRepository';
import {
  COLLAPSE_RMW_LOCK,
  SETTINGS_RMW_LOCK,
  withCrossPageLock
} from '@/platform/storage/crossPageLock';
import { applyTheme } from '@/platform/theme/ThemeApplier';
import { DEFAULT_SETTINGS, SITE_COLLAPSE_LIMIT, SettingsSchema } from '@/core/schema/models';
import { createSerialChain } from '@/core/util/concurrency';
import { restoreFromMirrorOnEnable } from './mirrorRestore';
import type { DataContext, DataSlice } from './types';

/** 设置切片：站点折叠、设置读写与重置、清空全部本地数据、跨页设置刷新。 */
export function createSettingsSlice(
  ctx: DataContext
): DataSlice<
  | 'toggleSiteCollapsed'
  | 'updateSettings'
  | 'tryUpdateSettings'
  | 'resetSettings'
  | 'clearAllData'
  | 'refreshSettings'
> {
  /**
   * 设置/折叠写操作串行链。updateSettings 是「写盘成功才 set」，写盘在途期间内存仍是旧值：
   * 快速连改两个开关时后一次基于旧内存合并、写盘完成顺序失控，终态可能丢其中一项。
   * 收口到本链串行后，后一次必读到前一次的内存终态，顺序确定。
   */
  const writeChain = createSerialChain();
  const serialize = <T>(op: () => Promise<T>): Promise<T> => writeChain.enqueue(op);

  return {
    // 折叠是尽力而为的展示态，且 UI 侧 `void` 调用拿不到回执：异常必须就地消化留痕，
    // 否则锁请求在面板关闭时以 AbortError reject 会变成无人接的 rejection。
    toggleSiteCollapsed: (siteKey, collapsed) =>
      serialize(async () => {
        let next: string[] = ctx.get().collapsedSites;
        try {
          // 折叠状态是整表写、各页面内存副本独立。必须「锁内重读磁盘 → 合并 → 写」：
          // 只把内存基线包进锁不构成互斥，另一页刚写的折叠项仍会被本页旧基线整表抹掉。
          const ok = await withCrossPageLock(COLLAPSE_RMW_LOCK, async () => {
            const disk = await ctx.repos.collapse.read();
            const merged = collapsed
              ? disk.includes(siteKey)
                ? disk
                : [...disk, siteKey]
              : disk.filter((key) => key !== siteKey);
            // 折叠记忆是「最近折叠过哪些站点」的滚动记录：满额淘汰最旧的，
            // 否则计数一满整表写就一直失败，还会顶起无关的全局降级横幅。
            next =
              merged.length > SITE_COLLAPSE_LIMIT ? merged.slice(-SITE_COLLAPSE_LIMIT) : merged;
            return ctx.repos.collapse.write(next);
          });
          if (!ok)
            ctx.reportPersistenceFailure('dataStore', '站点折叠状态写入失败（仅影响分组展开状态）');
        } catch {
          ctx.reportPersistenceFailure('dataStore', '站点折叠状态写入失败（仅影响分组展开状态）');
        }
        ctx.set({ collapsedSites: next });
      }),

    updateSettings: (partial) =>
      serialize(async () => {
        let mirrorJustEnabled = false;
        // 跨页锁内「重读 → 合并 → 写」：各页面 dataStore 实例独立，以本页内存为基线整对象写
        // 会覆盖其他页面刚写入的字段（watcher 回放收敛到胜方，败方修改静默消失）。
        await withCrossPageLock(SETTINGS_RMW_LOCK, async () => {
          const disk = await ctx.repos.settings.read();
          const parsed = SettingsSchema.safeParse({ ...disk, ...partial });
          if (!parsed.success) {
            // 校验失败必须与落盘失败同口径留痕：只 throw 会让这条路径在诊断里消失
            // （UI 侧是 `void tryUpdateSettings(...)`），界面却像生效、重启即丢失。
            ctx.reportPersistenceFailure('dataStore', '设置校验失败，本次修改未保存');
            throw new Error('invalid-settings');
          }
          const ok = await ctx.repos.settings.write(parsed.data);
          // 设置是跨会话行为契约：落盘失败必须报错，不能让界面停留在未保存的新值上。
          if (!ok) {
            ctx.reportPersistenceFailure('dataStore', '设置写入失败，本次修改未保存');
            throw new Error('settings-write-failed');
          }
          const wasMirrorEnabled = disk.syncMirrorEnabled;
          mirrorJustEnabled = partial.syncMirrorEnabled === true && !wasMirrorEnabled;
          ctx.set({ settings: parsed.data });
          // 首次开启同步先不镜像：需先在锁外做反向恢复（恢复要取 FOLDERS/PINS 锁，
          // 嵌套在 SETTINGS 锁内有锁序风险），否则本地空态会被推上云覆盖旧设备镜像。
          if (!mirrorJustEnabled) ctx.scheduleMirror(ctx.get());
          ctx.broadcastSettingsSynced();
          // 关闭镜像必须清掉已上传的块：否则账号通道里那份仍在厂商侧、下次开启会被回灌。
          // 必须 await：调用方返回时云端数据已确认删除。
          if (partial.syncMirrorEnabled === false && wasMirrorEnabled) {
            await syncMirror.clearAll();
            ctx.resetMirrorFailure();
          }
        });
        if (mirrorJustEnabled) {
          // 恢复失败（写盘/解析失败/锁 AbortError/读失败）时不得推首次镜像：本地仍是空态，
          // 推上云会覆盖旧设备镜像。此时 seeded 未置位，下次启动由 initSlice 拉取分支重试自愈。
          // 本函数常被 `void updateSettings()` 调用，抛错不接住会变成 unhandled rejection 且失败被当成成功。
          const outcome = await restoreFromMirrorOnEnable(ctx).catch(() => {
            ctx.reportPersistenceFailure(
              'dataStore',
              '从同步镜像恢复失败，本次未推送镜像（下次启动重试）'
            );
            return 'failed' as const;
          });
          if (outcome !== 'failed') ctx.scheduleMirror(ctx.get());
        }
      }),

    tryUpdateSettings: async (partial) => {
      try {
        await ctx.get().updateSettings(partial);
        return true;
      } catch {
        return false;
      }
    },

    resetSettings: () =>
      serialize(async () =>
        // 与 updateSettings 同锁：整对象覆盖写在并发页面前同样需要串行化。
        withCrossPageLock(SETTINGS_RMW_LOCK, async () => {
          // 默认值里同步是关闭的：若当前开着，恢复默认等同「关闭同步」，
          // 必须一并清掉已上传镜像。读取磁盘现值（并发页可能刚改过）。
          const wasMirrorEnabled = (await ctx.repos.settings.read()).syncMirrorEnabled;
          const ok = await ctx.repos.settings.write(DEFAULT_SETTINGS);
          if (!ok) {
            ctx.reportPersistenceFailure('dataStore', '恢复默认设置失败，设置未变更');
            throw new Error('settings-write-failed');
          }
          if (wasMirrorEnabled && !DEFAULT_SETTINGS.syncMirrorEnabled) {
            await syncMirror.clearAll();
            ctx.resetMirrorFailure();
          }
          ctx.set({ settings: DEFAULT_SETTINGS });
          applyTheme(DEFAULT_SETTINGS.themePreference, DEFAULT_SETTINGS.colorTheme);
          ctx.scheduleMirror(ctx.get());
          ctx.broadcastSettingsSynced();
        })
      ),

    /**
     * 清除所有本地数据（不可恢复）：本地仓库 + 会话存储 + 跨设备镜像，内存态重置为默认。
     * 先清 sync 镜像再清 local —— 否则下次初始化（seeded 随 local 清空）会从旧镜像把数据「复活」。
     * 撤销栈持久化随 local.clear 清空，内存栈由 UI 层经 undoStore.clearBatches 同步清空。
     */
    clearAllData: () =>
      serialize(async () => {
        // 与导入事务互斥：导入进行中点清空，后续分区写会回填已清空的存储，「清空」语义被击穿。
        if (ctx.isImporting()) throw new Error('import-in-progress');
        ctx.setClearing(true);
        try {
          // 清空前让在途/排队的合并写入收尾并丢弃旧值，避免随后把旧数据写回已清空的存储。
          // （本函数在串行链上：排队的设置写已在进入前完成。）
          await ctx.cancelWrites();
          // 清空语义（含「先清镜像再清 local」的顺序）收口在 platform：store 不直连 browser.storage，避免漏清。
          await clearAllStoredData(() => syncMirror.clearAll());
          // 清空期间若又排入合并写（极少见），丢弃之，保证最终落盘为空态。
          await ctx.cancelWrites();
          // 整体清空后复位降级记账；失败记录已不再对应现存数据。
          ctx.resetDegraded();
          ctx.set({
            folders: [],
            pins: [],
            collapsedSites: [],
            settings: DEFAULT_SETTINGS,
            boundTabIds: [],
            // clearAllStoredData 同时删除镜像，因此清空写入失败态与拉取分类。
            mirrorWriteFailed: false,
            mirrorQuotaExceeded: false,
            mirrorIssue: null,
            ready: true
          });
          applyTheme(DEFAULT_SETTINGS.themePreference, DEFAULT_SETTINGS.colorTheme);
          // 无需把空态镜像回 sync：此时 syncMirrorEnabled=false，scheduleMirror 是 no-op；
          // 云端镜像已由上面的 syncMirror.clearAll 删除。
          ctx.broadcastSettingsSynced();
        } finally {
          ctx.setClearing(false);
        }
      }),

    refreshSettings: () => ctx.syncSettingsFromStorage()
  };
}
