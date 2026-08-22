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
import { structuralSignature } from '@/core/util/signature';
import {
  FOLDERS_LIMIT,
  FixedFolderSchema,
  PINS_LIMIT,
  PersistentPinSchema,
  SettingsSchema
} from '@/core/schema/models';
import type { DataContext, DataState } from './types';
import type { MirrorSyncIssue } from '@/platform/storage/SyncMirror';

/** 页面实例级初始化守卫：StrictMode 双执行 / 多入口重复调用只初始化一次。 */
let initialized = false;

/**
 * 按**原始对象**的键集合，从已解析值里挑出对应字段。
 *
 * 用途：镜像里的设置是外部输入，缺失的字段不该参与覆盖（保持本地现值）。
 * 而 `SettingsSchema` 每个字段都带 `.default()`，safeParse 的产出恒为全字段对象，
 * 无法从它本身判断「镜像到底给了哪些键」，只能回看原始载荷。
 */
function pickExplicitKeys<T extends object>(raw: unknown, parsed: T): Partial<T> {
  if (raw === null || typeof raw !== 'object') return {};
  const source = parsed as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (key in source) out[key] = source[key];
  }
  return out as Partial<T>;
}

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
        /** 镜像显式给出的设置键（用于锁内「以磁盘为基线」的局部覆盖）。 */
        let settingsPatch: Record<string, unknown> = {};
        /** 最近一次镜像拉取的分类；未拉取（已 seeded / 开关关闭）时为 null。 */
        let mirrorIssue: MirrorSyncIssue | null = null;
        if (!seeded && settings.syncMirrorEnabled) {
          // 新设备首次启动：从浏览器同步通道镜像恢复（本地有数据时以本地为准）。
          // 开关关闭时不拉取——「不上传」与「不下载」必须同开同关，
          // 否则关掉同步的用户在换机时仍会被旧镜像回灌。
          let mirrorParseOk = true;
          const mirror = await syncMirror.pull();
          // 拉取为空不等于「从未同步过」：分块数超限、镜像损坏同样返回空，
          // 但它们意味着换机恢复不到数据 —— 必须让设置页呈现出来。
          // 记下 pull 的分类（ok / none / chunk-limit / unreadable）随最终状态一起落地：
          // 单独先 set 一次会让 store 出现一次「只有状态、没有数据」的中间态。
          // 分类本身即复位机制：成功时是 'ok'，不会出现「提示永久粘住」。
          mirrorIssue = syncMirror.readLastPullIssue();
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
            /**
             * 只取镜像**显式给出**的设置键。
             *
             * `SettingsSchema` 每个字段都带 `.default()`，因此 safeParse 的产出
             * **恒为全字段对象** —— 直接把它展开到磁盘值上，等于整表覆盖：并发页
             * 刚写入、而镜像里没有的字段会被镜像的默认值悄悄抹掉。
             * （`settingsSlice` 的 `{ ...disk, ...partial }` 之所以成立，是因为那里的
             * partial 是真·局部更新；这里的 parsed 不是。）
             */
            if (parsedSettings.success) {
              settingsPatch = pickExplicitKeys(mirror.settings, parsedSettings.data);
            }
            // 单边解析失败：该分区跳过恢复，且不置 seeded ——
            // 置位会让它永久失去重试机会（与 stores/data/mirrorRestore 同口径）。
            mirrorParseOk = parsedFolders.success && parsedPins.success && parsedSettings.success;
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
          // 结构签名而非引用比较：`SettingsSchema.safeParse` 恒产出新对象，
          // 内容相同也会走进写盘分支 —— 平白多一次 storage 写与主题重放。
          if (structuralSignature(effectiveSettings) !== structuralSignature(settings)) {
            // settings 没有「本地为空」判据（默认值恒存在），且必须与 settingsSlice
            // 的「锁内重读 → 合并 → 写」同口径：否则本分支的整对象覆盖会抹掉并发页
            // 刚写入、而镜像里没有的字段。
            const ok = await withCrossPageLock(SETTINGS_RMW_LOCK, async () => {
              const disk = await ctx.repos.settings.read();
              // 以磁盘为基线、只覆盖镜像**显式给出**的字段（镜像里缺的保持本地现值）。
              const merged = SettingsSchema.safeParse({ ...disk, ...settingsPatch });
              if (!merged.success) return false;
              const written = await ctx.repos.settings.write(merged.data);
              if (written) effectiveSettings = merged.data;
              return written;
            });
            if (!ok) {
              ctx.reportPersistenceFailure('dataStore', '镜像恢复的设置写入失败');
              restoreWritesOk = false;
            }
          }
          // 恢复失败必须**同时**降级状态分类：pull 的分类只说明「镜像读得到」，
          // 而用户关心的是「换机能不能恢复」。解析失败或落盘失败时镜像同样没生效，
          // 若仍沿用 pull 给的 'ok'，设置页会显示「已生效」而本地一条都没恢复 ——
          // 正是本次要消除的「失效被当成生效」。
          if (mirror && (!mirrorParseOk || !restoreWritesOk)) mirrorIssue = 'unreadable';
          // 本地 folders/pins 均非空 → 本轮一条数据都没恢复出来（本地为准放弃覆盖）。
          // 此时 pull 的 'ok' 只说明「镜像读得到」，沿用它会让设置页显示「已生效」，
          // 而用户关心的是「换机能不能恢复」。
          // 归为 'local' 而不是 'none'：'none' 的文案是「尚未生成镜像」，而此处云端
          // 镜像**确实存在**（只是本机以本地为准），说「尚未生成」与事实相反。
          if (
            mirror &&
            mirrorParseOk &&
            restoreWritesOk &&
            effectiveFolders === folders &&
            effectivePins === pins
          )
            mirrorIssue = 'local';
          // seeded 必须在恢复数据全部落盘成功之后写：若先置位而回写失败，
          // 下次启动不再拉取镜像，新设备的恢复数据永久丢失。pull 为 null
          // （通道不可用/镜像损坏）或镜像解析失败时同样不置位——保持下次
          // 启动重试的机会。
          if (mirror && restoreWritesOk && mirrorParseOk) await ctx.repos.seeded.write(true);
        }
        ctx.set({
          folders: effectiveFolders,
          // 必须去重：仓库 read 不做去重，磁盘/同步镜像里的重复身份会直接渲染成两块磁贴
          // （与 pins watcher 路径同口径，见 data/context.ts）。
          pins: dedupePins(effectivePins),
          collapsedSites,
          settings: effectiveSettings,
          boundTabIds: Object.values(session.itemTabBindings),
          mirrorIssue,
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
