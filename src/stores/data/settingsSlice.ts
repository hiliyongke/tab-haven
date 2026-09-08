import { browser } from 'wxt/browser';
import { syncMirror } from '@/platform/storage/SyncMirror';
import { applyTheme } from '@/platform/theme/ThemeApplier';
import { DEFAULT_SETTINGS, SettingsSchema } from '@/core/schema/models';
import type { DataContext, DataState } from './types';

/** 设置切片：站点折叠、设置读写与重置、清空全部本地数据、跨页设置刷新。 */
export function createSettingsSlice(ctx: DataContext): Partial<DataState> {
  return {
    toggleSiteCollapsed: async (siteKey, collapsed) => {
      const next = collapsed
        ? ctx.get().collapsedSites.includes(siteKey)
          ? ctx.get().collapsedSites
          : [...ctx.get().collapsedSites, siteKey]
        : ctx.get().collapsedSites.filter((key) => key !== siteKey);
      const ok = await ctx.repos.collapse.write(next);
      if (!ok)
        ctx.reportPersistenceFailure('dataStore', '站点折叠状态写入失败（仅影响分组展开状态）');
      ctx.set({ collapsedSites: next });
    },

    updateSettings: async (partial) => {
      const parsed = SettingsSchema.safeParse({ ...ctx.get().settings, ...partial });
      if (!parsed.success) throw new Error('invalid-settings');
      const ok = await ctx.repos.settings.write(parsed.data);
      // 设置是跨会话行为契约：落盘失败时必须报错，不能让界面停留在未保存的新值上。
      if (!ok) {
        ctx.reportPersistenceFailure('dataStore', '设置写入失败，本次修改未保存');
        throw new Error('settings-write-failed');
      }
      const wasMirrorEnabled = ctx.get().settings.syncMirrorEnabled;
      ctx.set({ settings: parsed.data });
      ctx.scheduleMirror(ctx.get());
      ctx.broadcastSettingsSynced();
      // 关闭镜像时必须清掉已上传的块：否则浏览器账号通道里那份会一直留着，
      // 用户以为「关了同步」，数据其实仍在厂商侧，且下次开启会被回灌。
      if (partial.syncMirrorEnabled === false && wasMirrorEnabled) {
        void syncMirror.clearAll();
      }
    },

    tryUpdateSettings: async (partial) => {
      try {
        await ctx.get().updateSettings(partial);
        return true;
      } catch {
        return false;
      }
    },

    resetSettings: async () => {
      // 默认值里同步是关闭的：若当前开着，恢复默认等同于「关闭同步」，
      // 必须一并按 updateSettings 的口径清掉已上传镜像，否则用户以为关了、
      // 数据其实还在浏览器账号通道里。
      const wasMirrorEnabled = ctx.get().settings.syncMirrorEnabled;
      const ok = await ctx.repos.settings.write(DEFAULT_SETTINGS);
      if (!ok) {
        ctx.reportPersistenceFailure('dataStore', '恢复默认设置失败，设置未变更');
        throw new Error('settings-write-failed');
      }
      if (wasMirrorEnabled && !DEFAULT_SETTINGS.syncMirrorEnabled) {
        await syncMirror.clearAll();
      }
      ctx.set({ settings: DEFAULT_SETTINGS });
      applyTheme(DEFAULT_SETTINGS.themePreference, DEFAULT_SETTINGS.colorTheme);
      ctx.scheduleMirror(ctx.get());
      ctx.broadcastSettingsSynced();
    },

    /**
     * 清除所有本地数据（不可恢复）：本地仓库 + 会话存储 + 跨设备镜像，内存态重置为默认。
     *
     * 顺序有讲究：先清 sync 镜像再清 local —— 否则下次初始化（seeded 标志随 local
     * 清空）会从旧镜像把数据「复活」。撤销栈的持久化随 local.clear 一并清空；
     * 内存栈由调用方（UI 层）经 undoStore.clearBatches 同步清空。
     */
    clearAllData: async () => {
      // 清空前先让在途/排队的合并写入收尾并丢弃旧值，避免其随后把旧数据写回已清空的存储，
      // 使「清空」失效。
      await ctx.cancelWrites();
      await syncMirror.clearAll();
      await browser.storage.local.clear();
      await browser.storage.session.clear();
      // 清空期间若又排入了合并写（极少见），丢弃之，保证最终落盘为空态。
      await ctx.cancelWrites();
      // 存储刚被整体清空：此前累积的降级记账已无对应数据，若不重置，
      // 「数据可能未保存」横幅会在清空之后永久驻留（用户恰恰是刚清干净的状态）。
      ctx.resetDegraded();
      ctx.set({
        folders: [],
        pins: [],
        collapsedSites: [],
        settings: DEFAULT_SETTINGS,
        boundTabIds: [],
        ready: true
      });
      applyTheme(DEFAULT_SETTINGS.themePreference, DEFAULT_SETTINGS.colorTheme);
      // 把「空态」镜像回 sync（去抖落盘），保持 local/sync 终态一致。
      ctx.scheduleMirror(ctx.get());
      ctx.broadcastSettingsSynced();
    },

    refreshSettings: () => ctx.syncSettingsFromStorage()
  };
}
