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
  InboundFixedFolderSchema,
  InboundPersistentPinListSchema,
  SettingsSchema
} from '@/core/schema/models';
import type { DataContext, DataSlice } from './types';
import type { MirrorSyncIssue } from '@/platform/storage/SyncMirror';

/**
 * 页面实例级初始化守卫：StrictMode 双执行 / 多入口重复调用只初始化一次。
 * 与 `ready` 不是同一件事：本标志在 initialize 开头（await 前）置起＝「已开始」，
 * ready 在全部加载完成后置起＝「已完成」。若用 ready 当入口守卫，在途重入会再发起一轮并发加载。
 * 失败分支必须把二者一并复位（initialized=false + ready:false），否则面板永久停在 Loading 骨架屏。
 */
let initialized = false;

/**
 * 按**原始对象**的键集合，从已解析值里挑出对应字段。
 * 镜像设置是外部输入，缺失字段不该参与覆盖（保持本地现值）。而 SettingsSchema 每字段带
 * `.default()`，safeParse 恒产出全字段对象，无法据此判断「镜像给了哪些键」，只能回看原始载荷。
 */
function pickExplicitKeys<T extends object>(raw: unknown, parsed: T): Partial<T> {
  if (raw === null || typeof raw !== 'object') return {};
  // 遍历 parsed 的键（受 `keyof T` 约束）而非降格成 Record<string, unknown> 再索引：
  // 后者用 `as unknown as` 抹掉「键 ↔ T 字段」关联，字段名写错检查不出来。
  // 外部键名无法被证明属于 T，故只放宽键名这一处。
  const given = new Set(Object.keys(raw));
  // 以 `Partial<T>` 为目标类型，保留字段键与值类型的关联。
  const out: Partial<T> = {};
  for (const key of Object.keys(parsed) as Array<keyof T>) {
    if (given.has(String(key))) out[key] = parsed[key];
  }
  return out;
}

/** 初始化切片：加载全部分区、按 seeded 标志从同步镜像恢复（仅首次启动）、订阅 watcher；失败回滚守卫以允许重试。 */
export function createInitSlice(ctx: DataContext): DataSlice<'initialize'> {
  return {
    initialize: async () => {
      if (initialized) return;
      initialized = true;
      ctx.startSettingsWatcher();
      // 先注册全部 watcher 再读盘；最终提交按分区保留读取期间回放的新值。
      ctx.startValueWatchers();
      const before = {
        folders: ctx.get().folders,
        pins: ctx.get().pins,
        collapsedSites: ctx.get().collapsedSites,
        settings: ctx.get().settings
      };
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
        ctx.setMirrorRestorePending(!seeded && settings.syncMirrorEnabled);
        if (!seeded && settings.syncMirrorEnabled) {
          // 新设备首次启动：从同步通道镜像恢复（本地有数据以本地为准）。
          // 开关关闭时不拉取——「不上传」与「不下载」必须同开同关，否则关同步的用户换机仍被旧镜像回灌。
          let mirrorParseOk = true;
          const mirror = await syncMirror.pull();
          // 拉取为空不等于「从未同步」：分块超限、镜像损坏同样返回空，但换机恢复不到，须让设置页呈现。
          // 记下分类（ok/none/chunk-limit/unreadable）随最终态一起落地，避免「只有状态没数据」的中间态；
          // 分类本身即复位机制：成功时是 'ok'，提示不会永久粘住。
          mirrorIssue = syncMirror.readLastPullIssue();
          if (mirror) {
            // 镜像是外部可控输入（与备份文件同级），集合须带体积上限，否则异常镜像会撑爆本地库。
            // 上限只加在外部输入侧，不加进 registry 仓库 schema——否则存量超限用户读盘时会被判坏数据清空。
            // 同理用 Inbound* schema：url / favIconUrl 与备份入口同款收紧，堵住「备份被拒内容经镜像落盘」的绕行通道。
            const parsedFolders = InboundFixedFolderSchema.array()
              .max(FOLDERS_LIMIT)
              .safeParse(mirror.folders);
            const parsedPins = InboundPersistentPinListSchema.safeParse(mirror.pins);
            const parsedSettings = SettingsSchema.safeParse(mirror.settings);
            /**
             * 只取镜像**显式给出**的设置键。SettingsSchema 每字段带 `.default()`，safeParse 恒产出全字段对象，
             * 直接展开到磁盘等于整表覆盖：并发页刚写入、而镜像里没有的字段会被默认值抹掉。
             */
            if (parsedSettings.success) {
              settingsPatch = pickExplicitKeys(mirror.settings, parsedSettings.data);
            }
            // 单边解析失败：该分区跳过恢复且不置 seeded（置位会永久失去重试机会）。
            mirrorParseOk = parsedFolders.success && parsedPins.success && parsedSettings.success;
            if (parsedFolders.success && folders.length === 0)
              effectiveFolders = parsedFolders.data;
            if (parsedPins.success && pins.length === 0) effectivePins = parsedPins.data;
            if (parsedSettings.success) effectiveSettings = parsedSettings.data;
          }
          // 镜像恢复写失败不阻断启动（本地数据仍在），但必须留痕，否则「新设备没恢复出来」无从排查。
          let restoreWritesOk = true;
          if (effectiveFolders !== folders) {
            // 跨页锁 + 锁内重读：整表写与另一上下文并发时锁外会互相覆盖；
            // 锁内发现本地已有数据说明并发上下文刚写过，以本地为准放弃覆盖。
            const ok = await withCrossPageLock(FOLDERS_RMW_LOCK, async () => {
              const disk = await ctx.repos.folders.readStrict();
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
              const disk = await ctx.repos.pins.readStrict();
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
          // 结构签名而非引用比较：safeParse 恒产出新对象，内容相同也会走进写盘，平白多一次 storage 写与主题重放。
          if (structuralSignature(effectiveSettings) !== structuralSignature(settings)) {
            // settings 无「本地为空」判据，须与 settingsSlice 同口径「锁内重读 → 合并 → 写」，
            // 否则整对象覆盖会抹掉并发页刚写入、而镜像里没有的字段。
            const ok = await withCrossPageLock(SETTINGS_RMW_LOCK, async () => {
              const disk = await ctx.repos.settings.readStrict();
              // 以磁盘为基线、只覆盖镜像显式给出的字段。
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
          // 恢复失败必须同时降级分类：pull 分类只说明「镜像读得到」，解析/落盘失败时镜像同样没生效，
          // 沿用 'ok' 会显示「已生效」而本地一条未恢复（失效被当成生效）。
          if (mirror && (!mirrorParseOk || !restoreWritesOk)) mirrorIssue = 'unreadable';
          // 本地 folders/pins 均非空 → 镜像数据未恢复（以本地为准放弃覆盖）。归类 'local' 而非 'none'：
          // 云端镜像确实存在（只是本机以本地为准），'none' 的「尚未生成镜像」与事实相反。
          if (
            mirror &&
            mirrorParseOk &&
            restoreWritesOk &&
            effectiveFolders === folders &&
            effectivePins === pins
          )
            mirrorIssue = 'local';
          // 仅在镜像数据全部解析并成功落盘后写入 seeded；pull 为空或解析失败时保留下次重试机会。
          if (mirror && restoreWritesOk && mirrorParseOk) {
            const seededOk = await ctx.repos.seeded.write(true);
            if (seededOk) {
              ctx.setMirrorRestorePending(false);
            } else {
              ctx.reportPersistenceFailure('dataStore', '镜像恢复完成标记写入失败（下次启动重试）');
              mirrorIssue = 'unreadable';
            }
          } else if (!mirror && mirrorIssue !== 'chunk-limit') {
            // 确无镜像（或按既定策略自愈 unreadable）时，本地可成为首份镜像。
            ctx.setMirrorRestorePending(false);
          }
        }
        const current = ctx.get();
        // 读盘期间 watcher 已回放的分区以内存新值为准，不能用本次旧 read 结果收尾。
        if (current.folders !== before.folders) effectiveFolders = current.folders;
        if (current.pins !== before.pins) effectivePins = current.pins;
        if (current.settings !== before.settings) effectiveSettings = current.settings;
        ctx.set({
          folders: effectiveFolders,
          // 仓库 read 不去重，磁盘/镜像里的重复身份会直接渲染成两块磁贴（与 pins watcher 同口径）。
          pins: dedupePins(effectivePins),
          collapsedSites:
            current.collapsedSites !== before.collapsedSites
              ? current.collapsedSites
              : collapsedSites,
          settings: effectiveSettings,
          boundTabIds: Object.values(session.itemTabBindings),
          mirrorIssue,
          ready: true
        });
        // 数据加载后立即同步主题镜像，确保防闪烁初始化与最新设置一致（单一数据源）。
        applyTheme(effectiveSettings.themePreference, effectiveSettings.colorTheme);
      } catch (error) {
        // 初始化失败：回滚守卫以允许重试（否则面板永久停在 Loading 骨架屏）。
        initialized = false;
        ctx.set({ ready: false });
        throw error;
      }
    }
  };
}
