import { syncMirror } from '@/platform/storage/SyncMirror';
import { readSession } from '@/platform/storage/session';
import { applyTheme } from '@/platform/theme/ThemeApplier';
import { dedupePins } from '@/core/fixed/FolderOps';
import { FixedFolderSchema, PersistentPinSchema, SettingsSchema } from '@/core/schema/models';
import type { DataContext, DataState } from './types';

/** 页面实例级初始化守卫：StrictMode 双执行 / 多入口重复调用只初始化一次。 */
let initialized = false;

/**
 * 初始化切片：加载全部分区、按 seeded 标志从同步通道镜像恢复（仅首次启动），
 * 订阅设置与分区 watcher。失败时回滚守卫以允许重试。
 */
export function createInitSlice(ctx: DataContext): Partial<DataState> {
  return {
    initialize: async () => {
      if (initialized) return;
      initialized = true;
      ctx.startSettingsWatcher();
      try {
        const [folders, pins, collapsedSites, settings, session, seeded] = await Promise.all([
          ctx.repos.folders.read(),
          ctx.repos.pins.read(),
          ctx.repos.collapse.read(),
          ctx.repos.settings.read(),
          readSession(),
          ctx.repos.seeded.read()
        ]);
        let effectiveFolders = folders;
        let effectivePins = pins;
        let effectiveSettings = settings;
        if (!seeded && settings.syncMirrorEnabled) {
          // 新设备首次启动：从浏览器同步通道镜像恢复（本地有数据时以本地为准）。
          // 开关关闭时不拉取——「不上传」与「不下载」必须同开同关，
          // 否则关掉同步的用户在换机时仍会被旧镜像回灌。
          const mirror = await syncMirror.pull();
          if (mirror) {
            const parsedFolders = FixedFolderSchema.array().safeParse(mirror.folders);
            const parsedPins = PersistentPinSchema.array().safeParse(mirror.pins);
            const parsedSettings = SettingsSchema.safeParse(mirror.settings);
            if (parsedFolders.success && folders.length === 0)
              effectiveFolders = parsedFolders.data;
            if (parsedPins.success && pins.length === 0) effectivePins = parsedPins.data;
            if (parsedSettings.success) effectiveSettings = parsedSettings.data;
          }
          // 镜像恢复写入失败不阻断启动（本地数据仍在），但必须留痕，否则「新设备没恢复出来」无从排查。
          let restoreWritesOk = true;
          if (effectiveFolders !== folders) {
            const ok = await ctx.repos.folders.write(effectiveFolders);
            if (!ok) {
              ctx.reportPersistenceFailure('dataStore', '镜像恢复的固定文件夹写入失败');
              restoreWritesOk = false;
            }
          }
          if (effectivePins !== pins) {
            const ok = await ctx.repos.pins.write(effectivePins);
            if (!ok) {
              ctx.reportPersistenceFailure('dataStore', '镜像恢复的固定图标写入失败');
              restoreWritesOk = false;
            }
          }
          if (effectiveSettings !== settings) {
            const ok = await ctx.repos.settings.write(effectiveSettings);
            if (!ok) {
              ctx.reportPersistenceFailure('dataStore', '镜像恢复的设置写入失败');
              restoreWritesOk = false;
            }
          }
          // seeded 必须在恢复数据全部落盘成功之后写：若先置位而回写失败，
          // 下次启动不再拉取镜像，新设备的恢复数据永久丢失。pull 为 null
          // （通道不可用/镜像损坏）时同样不置位——保持下次启动重试的机会。
          if (mirror && restoreWritesOk) await ctx.repos.seeded.write(true);
        }
        ctx.set({
          folders: effectiveFolders,
          // 必须去重：仓库 read 不做去重，磁盘/同步镜像里的重复身份会直接渲染成两块磁贴
          // （与 pins watcher 路径同口径，见 data/context.ts）。
          pins: dedupePins(effectivePins),
          collapsedSites,
          settings: effectiveSettings,
          boundTabIds: Object.values(session.itemTabBindings),
          ready: true
        });
        // 数据加载后立即同步主题镜像，确保防闪烁初始化与最新设置一致（单一数据源）。
        applyTheme(effectiveSettings.themePreference, effectiveSettings.colorTheme);
        ctx.startValueWatchers();
      } catch (error) {
        // 初始化失败：回滚守卫以允许重试（否则面板永久停在 Loading 骨架屏）。
        initialized = false;
        ctx.set({ ready: false });
        throw error;
      }
    }
  };
}
