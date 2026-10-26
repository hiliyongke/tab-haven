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
   * 设置/折叠写操作串行链。
   *
   * updateSettings 的语义是「写盘成功才 set」（失败时界面不能停留在未保存的新值上），
   * 代价是写盘在途期间内存仍是旧值：快速连改两个开关时，后一次基于旧内存合并，
   * 两次写盘完成顺序也不受控 —— 内存/磁盘终态都可能丢其中一项。
   * 全部写操作收口到本链串行执行后，后一次必读到前一次的内存终态，顺序确定。
   */
  const writeChain = createSerialChain();
  const serialize = <T>(op: () => Promise<T>): Promise<T> => writeChain.enqueue(op);

  return {
    // 折叠是尽力而为的展示态（丢了只影响分组展开与否），且 UI 侧是 `void` 调用
    // （拿不到 promise 回执）：异常必须就地消化并留痕，否则锁请求在面板关闭时
    // 以 AbortError reject 会变成一条无人接的 rejection。
    toggleSiteCollapsed: (siteKey, collapsed) =>
      serialize(async () => {
        let next: string[] = ctx.get().collapsedSites;
        try {
          // 与 updateSettings 同口径：折叠状态是整表写，options / sidepanel 各有独立
          // 内存副本。必须「锁内重读磁盘 → 合并 → 写」—— 只把内存基线包进锁不构成
          // 互斥，另一页刚写入的折叠项仍会被本页的旧基线整表抹掉。
          const ok = await withCrossPageLock(COLLAPSE_RMW_LOCK, async () => {
            const disk = await ctx.repos.collapse.read();
            const merged = collapsed
              ? disk.includes(siteKey)
                ? disk
                : [...disk, siteKey]
              : disk.filter((key) => key !== siteKey);
            // 折叠记忆是「最近折叠过哪些站点」的滚动记录：满额时淘汰最旧的。
            // 不淘汰则计数一满整表写就一直失败，并顶起与折叠毫无关系的
            // 全局「存储降级」横幅 —— 用户看到的是一个无关的告警，而旧记录
            // 永久占着名额不再释放。
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
        // 跨页锁内「重读 → 合并 → 写」：各页面 dataStore 实例独立，以本页内存为
        // 基线整对象写会覆盖其他页面刚写入的字段（watcher 回放收敛到胜方，
        // 败方修改静默消失）。磁盘基线保证并发页的字段级更新互存。
        await withCrossPageLock(SETTINGS_RMW_LOCK, async () => {
          const disk = await ctx.repos.settings.read();
          const parsed = SettingsSchema.safeParse({ ...disk, ...partial });
          if (!parsed.success) {
            // 校验失败必须与落盘失败同口径留痕：只 throw 会让这条路径在诊断里
            // 完全消失（UI 侧又是 `void tryUpdateSettings(...)`，连 false 都丢掉），
            // 界面靠乐观渲染看起来像生效、重启即丢失，且无从排查。
            ctx.reportPersistenceFailure('dataStore', '设置校验失败，本次修改未保存');
            throw new Error('invalid-settings');
          }
          const ok = await ctx.repos.settings.write(parsed.data);
          // 设置是跨会话行为契约：落盘失败时必须报错，不能让界面停留在未保存的新值上。
          if (!ok) {
            ctx.reportPersistenceFailure('dataStore', '设置写入失败，本次修改未保存');
            throw new Error('settings-write-failed');
          }
          const wasMirrorEnabled = disk.syncMirrorEnabled;
          mirrorJustEnabled = partial.syncMirrorEnabled === true && !wasMirrorEnabled;
          ctx.set({ settings: parsed.data });
          // 首次开启同步的路径先不镜像：需先在锁外做反向恢复（恢复要取
          // FOLDERS/PINS 锁，嵌套在 SETTINGS 锁内有锁序风险），否则本地空态
          // 会被推上云，覆盖旧设备的镜像。
          if (!mirrorJustEnabled) ctx.scheduleMirror(ctx.get());
          ctx.broadcastSettingsSynced();
          // 关闭镜像时必须清掉已上传的块：否则浏览器账号通道里那份会一直留着，
          // 用户以为「关了同步」，数据其实仍在厂商侧，且下次开启会被回灌。
          // 必须 await：与 resetSettings 同口径，调用方返回时云端数据已确认删除。
          if (partial.syncMirrorEnabled === false && wasMirrorEnabled) {
            await syncMirror.clearAll();
            ctx.resetMirrorFailure();
          }
        });
        if (mirrorJustEnabled) {
          // 恢复失败（写盘/镜像解析失败）时不得推首次镜像：本地仍是空态，
          // 推上云会覆盖旧设备的镜像。此时 seeded 未置位，下次启动由
          // initSlice 的镜像拉取分支重试自愈。
          //
          // 抛错同样按 failed 处理：跨页锁拿不到（AbortError）、存储读失败都会让
          // 它 reject，而本函数是 `void updateSettings()` 的常见调用路径——
          // 不接住就是一次 unhandled rejection，且失败被当成成功去推镜像。
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
          // 默认值里同步是关闭的：若当前开着，恢复默认等同于「关闭同步」，
          // 必须一并按 updateSettings 的口径清掉已上传镜像，否则用户以为关了、
          // 数据其实还在浏览器账号通道里。读取磁盘现值（并发页可能刚改过）。
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
     *
     * 顺序有讲究：先清 sync 镜像再清 local —— 否则下次初始化（seeded 标志随 local
     * 清空）会从旧镜像把数据「复活」。撤销栈的持久化随 local.clear 一并清空；
     * 内存栈由调用方（UI 层）经 undoStore.clearBatches 同步清空。
     */
    clearAllData: () =>
      serialize(async () => {
        // 与导入事务互斥：导入进行中点清空，导入事务的后续分区写会对已清空的
        // 存储继续写成功并回填内存——「清空」语义被击穿。拒绝并交由 UI 提示。
        if (ctx.isImporting()) throw new Error('import-in-progress');
        ctx.setClearing(true);
        try {
          // 清空前先让在途/排队的合并写入收尾并丢弃旧值，避免其随后把旧数据写回已清空的存储，
          // 使「清空」失效。（本函数也在串行链上：排队的设置写已在进入本函数前完成。）
          await ctx.cancelWrites();
          // 清空语义（含「先清镜像再清 local」的顺序）收口在 platform：
          // store 不直连 browser.storage，避免新增存储分区时漏清。
          await clearAllStoredData(() => syncMirror.clearAll());
          // 清空期间若又排入了合并写（极少见），丢弃之，保证最终落盘为空态。
          await ctx.cancelWrites();
          // 存储刚被整体清空：已累积的降级记账已无对应数据，若不重置，
          // 「数据可能未保存」横幅会在清空之后永久驻留（用户恰恰是刚清干净的状态）。
          ctx.resetDegraded();
          ctx.set({
            folders: [],
            pins: [],
            collapsedSites: [],
            settings: DEFAULT_SETTINGS,
            boundTabIds: [],
            // 镜像已随 clearAllStoredData 一并删除：写失败态与拉取分类同样不再有
            // 对应数据（后者不清会带着清空前的结论，等用户重新开启同步时才显示）。
            mirrorWriteFailed: false,
            mirrorQuotaExceeded: false,
            mirrorIssue: null,
            ready: true
          });
          applyTheme(DEFAULT_SETTINGS.themePreference, DEFAULT_SETTINGS.colorTheme);
          // 无需把空态镜像回 sync：此时设置已是默认值（syncMirrorEnabled=false），
          // scheduleMirror 是 no-op；云端镜像已由上面的 syncMirror.clearAll 删除。
          ctx.broadcastSettingsSynced();
        } finally {
          ctx.setClearing(false);
        }
      }),

    refreshSettings: () => ctx.syncSettingsFromStorage()
  };
}
