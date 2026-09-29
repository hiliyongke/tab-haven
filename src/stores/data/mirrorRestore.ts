import { syncMirror } from '@/platform/storage/SyncMirror';
import {
  FOLDERS_RMW_LOCK,
  PINS_RMW_LOCK,
  withCrossPageLock
} from '@/platform/storage/crossPageLock';
import { dedupePins } from '@/core/fixed/FolderOps';
import {
  FOLDERS_LIMIT,
  FixedFolderSchema,
  PINS_LIMIT,
  PersistentPinSchema
} from '@/core/schema/models';
import type { DataContext } from './types';

/**
 * 「开启同步」时的反向恢复。
 *
 * 背景：新设备本地设置是默认值（syncMirrorEnabled=false），初始化时的镜像拉取
 * 分支（initSlice）不会命中；用户在设置页首次开启同步时，若本地尚未 seeded，
 * 必须先从镜像恢复、置 seeded，再由调用方做首次镜像 —— 否则紧随其后的
 * scheduleMirror 会把本地空态推上云，覆盖旧设备留下的镜像（换机恢复不可用，
 * 且云端副本被销毁）。
 *
 * 与 initSlice 恢复路径的口径差异：这里只恢复 folders/pins，不回灌 settings ——
 * 本路径由一次设置写触发，立刻用旧镜像整表覆盖用户刚写入的设置会让操作语义
 * 变得不可解释。settings 的镜像恢复只发生在初始化路径。
 *
 * seeded 置位口径与 initSlice 一致：镜像存在且恢复写全部落盘成功后才置位；
 * pull 为 null（通道不可用 / 镜像损坏）时不置位，保留下次重试的机会。
 */
/**
 * 恢复结果。调用方据此决定是否做首次镜像：
 * 仅非 'failed' 时才允许 scheduleMirror——失败路径下本地仍是空态，
 * 推镜像会把空数据推上云、覆盖旧设备的镜像（本函数要防的数据丢失）。
 */
export type MirrorRestoreOutcome =
  /** 老设备（已 seeded）：无需恢复，直接镜像本地即可。 */
  | 'already-seeded'
  /** 通道无镜像（损坏/过期/从未同步）：本地即首份镜像。 */
  | 'no-mirror'
  /** 恢复成功（含「本地非空以本地为准」），已置 seeded。 */
  | 'restored'
  /** 写盘失败或镜像解析失败：不置 seeded，留给下次启动 initSlice 拉取分支重试。 */
  | 'failed';

export async function restoreFromMirrorOnEnable(ctx: DataContext): Promise<MirrorRestoreOutcome> {
  const seeded = await ctx.repos.seeded.read();
  if (seeded) return 'already-seeded';
  const mirror = await syncMirror.pull();
  if (!mirror) return 'no-mirror';

  // 镜像来自浏览器账号通道，属外部可控输入（与备份文件同级）：集合必须带体积
  // 上限（与 initSlice 同口径），否则一份异常镜像就能把本地库撑到远超正常使用规模。
  const parsedFolders = FixedFolderSchema.array().max(FOLDERS_LIMIT).safeParse(mirror.folders);
  const parsedPins = PersistentPinSchema.array().max(PINS_LIMIT).safeParse(mirror.pins);
  // 单边解析失败（如未来版本 schema 偏斜）：不恢复、不置 seeded、不推镜像——
  // 任何一边落不了本地时推镜像都会把本地空值覆盖云端对应分区，且永久失去恢复机会。
  if (!parsedFolders.success || !parsedPins.success) {
    ctx.reportPersistenceFailure('dataStore', '同步镜像数据异常，已跳过恢复（下次启动重试）');
    return 'failed';
  }

  let writesOk = true;

  // 跨页锁 + 锁内重读：并发上下文刚写过本地数据时以本地为准（内存同步为读到的值）。
  let nextFolders = ctx.get().folders;
  const foldersOk = await withCrossPageLock(FOLDERS_RMW_LOCK, async () => {
    const disk = await ctx.repos.folders.read();
    if (disk.length > 0) {
      nextFolders = disk;
      return true;
    }
    nextFolders = parsedFolders.data;
    return ctx.repos.folders.write(nextFolders);
  });
  if (foldersOk) {
    ctx.set({ folders: nextFolders });
  } else {
    ctx.reportPersistenceFailure('dataStore', '镜像恢复的固定文件夹写入失败');
    writesOk = false;
  }

  let nextPins = ctx.get().pins;
  const pinsOk = await withCrossPageLock(PINS_RMW_LOCK, async () => {
    const disk = await ctx.repos.pins.read();
    if (disk.length > 0) {
      nextPins = disk;
      return true;
    }
    nextPins = parsedPins.data;
    return ctx.repos.pins.write(nextPins);
  });
  if (pinsOk) {
    // 必须去重：仓库 read 不做去重（与 initSlice / pins watcher 同口径）。
    ctx.set({ pins: dedupePins(nextPins) });
  } else {
    ctx.reportPersistenceFailure('dataStore', '镜像恢复的固定图标写入失败');
    writesOk = false;
  }

  if (!writesOk) return 'failed';
  await ctx.repos.seeded.write(true);
  return 'restored';
}
