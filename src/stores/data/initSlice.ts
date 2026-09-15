import { syncMirror } from '@/platform/storage/SyncMirror';
import { readSession } from '@/platform/storage/session';
import {
  FOLDERS_RMW_LOCK,
  PINS_RMW_LOCK,
  SETTINGS_RMW_LOCK,
  withCrossPageLock
} from '@/platform/storage/crossPageLock';
import { applyTheme } from '@/platform/theme/ThemeApplier';
import { dedupePins } from '@/core/fixed/FolderOps';
import {
  FOLDERS_LIMIT,
  FixedFolderSchema,
  PINS_LIMIT,
  PersistentPinSchema,
  SettingsSchema
} from '@/core/schema/models';
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
            // 镜像来自浏览器账号通道，属外部可控输入（与备份文件同级）：集合必须
            // 带体积上限，否则一份异常镜像就能把本地库撑到远超正常使用规模。
            // 注意口径：上限只加在「外部输入」侧，不加进 registry 的仓库 schema ——
            // 后者一旦收紧，存量超限用户的真实数据会在读盘时被判为坏数据而清空。
            const parsedFolders = FixedFolderSchema.array()
              .max(FOLDERS_LIMIT)
              .safeParse(mirror.folders);
            const parsedPins = PersistentPinSchema.array().max(PINS_LIMIT).safeParse(mirror.pins);
            const parsedSettings = SettingsSchema.safeParse(mirror.settings);
            if (parsedFolders.success && folders.length === 0)
              effectiveFolders = parsedFolders.data;
            if (parsedPins.success && pins.length === 0) effectivePins = parsedPins.data;
            if (parsedSettings.success) effectiveSettings = parsedSettings.data;
          }
          // 镜像恢复写入失败不阻断启动（本地数据仍在），但必须留痕，否则「新设备没恢复出来」无从排查。
          let restoreWritesOk = true;
          if (effectiveFolders !== folders) {
            // 跨页锁 + 锁内重读：镜像恢复是整表写，与另一上下文（另一侧边栏窗口 /
            // background 右键写入）并发时锁外写会互相覆盖；锁内发现本地已有数据
            // 说明并发上下文刚写过，以本地为准放弃覆盖（内存同步为读到的值）。
            const ok = await withCrossPageLock(FOLDERS_RMW_LOCK, async () => {
              const disk = await ctx.repos.folders.read();
              if (disk.length > 0) {
                effectiveFolders = disk;
                return true;
              }
              return ctx.repos.folders.write(effectiveFolders);
            });
            if (!ok) {
              ctx.reportPersistenceFailure('dataStore', '镜像恢复的固定文件夹写入失败');
              restoreWritesOk = false;
            }
          }
          if (effectivePins !== pins) {
            const ok = await withCrossPageLock(PINS_RMW_LOCK, async () => {
              const disk = await ctx.repos.pins.read();
              if (disk.length > 0) {
                effectivePins = disk;
                return true;
              }
              return ctx.repos.pins.write(effectivePins);
            });
            if (!ok) {
              ctx.reportPersistenceFailure('dataStore', '镜像恢复的固定图标写入失败');
              restoreWritesOk = false;
            }
          }
          if (effectiveSettings !== settings) {
            // settings 没有「本地为空」判据（默认值恒存在）：只做跨页串行化，
            // 保证与并发页的 settings 写入不交错。
            const ok = await withCrossPageLock(SETTINGS_RMW_LOCK, () =>
              ctx.repos.settings.write(effectiveSettings)
            );
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
