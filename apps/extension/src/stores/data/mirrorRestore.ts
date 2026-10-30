import { syncMirror } from '@/platform/storage/SyncMirror';
import {
  FOLDERS_RMW_LOCK,
  PINS_RMW_LOCK,
  withCrossPageLock
} from '@/platform/storage/crossPageLock';
import { dedupePins } from '@/core/fixed/FolderOps';
import {
  FOLDERS_LIMIT,
  InboundFixedFolderSchema,
  InboundPersistentPinListSchema
} from '@/core/schema/models';
import type { DataContext } from './types';

/**
 * 首次开启同步且尚未 seeded 时，先从镜像恢复 folders/pins，再由调用方执行首次镜像，
 * 避免本地默认空态覆盖已有镜像。此入口不恢复 settings：它由用户刚写入同步设置触发，
 * 应保留该次设置；settings 仅在初始化恢复路径载入。镜像存在且数据全部成功落盘后才置 seeded，
 * pull 未返回镜像时保留下次重试机会。
 */
/**
 * 恢复结果。仅非 'failed' 时才允许 scheduleMirror——失败路径下本地仍是空态，
 * 推镜像会把空数据推上云、覆盖旧设备的镜像（本函数要防的数据丢失）。
 */
type MirrorRestoreOutcome =
  /** 老设备（已 seeded）：无需恢复，直接镜像本地即可。 */
  | 'already-seeded'
  /** 通道无镜像（损坏/过期/从未同步）：本地即首份镜像。 */
  | 'no-mirror'
  /** 恢复成功（含「本地非空以本地为准」），已置 seeded。 */
  | 'restored'
  /** 写盘失败或镜像解析失败：不置 seeded，留给下次启动 initSlice 拉取分支重试。 */
  | 'failed';

export async function restoreFromMirrorOnEnable(ctx: DataContext): Promise<MirrorRestoreOutcome> {
  const seeded = await ctx.repos.seeded.readStrict();
  if (seeded) return 'already-seeded';
  const mirror = await syncMirror.pull();
  // 落地 pull 分类（ok/none/chunk-limit/unreadable），区分成因并让成功路径复位上次降级提示。
  // 存局部变量：并发页已置 seeded 时（见锁内复核）本次拉取不算本页结论，不得覆盖本页已呈现的分类。
  const pullIssue = syncMirror.readLastPullIssue();
  if (!mirror) {
    ctx.set({ mirrorIssue: pullIssue });
    // 'none'（确无镜像）→ 本地即首份，允许推；'chunk-limit'（镜像存在但超配额）→ 绝不能推：
    // 本地此刻是空态，一推就把云端副本覆盖成空，换机恢复永久失效，归为 failed 留下次重试。
    // 'unreadable' 维持 no-mirror：否则一份无关残留数据就能让同步永久停在「未生效」且无法自愈。
    return pullIssue === 'chunk-limit' ? 'failed' : 'no-mirror';
  }

  // 镜像来自账号通道，属外部可控输入（与备份文件同级），集合须带体积上限，否则异常镜像会撑爆本地库。
  // 用 Inbound* schema 而非基础 schema：url / favIconUrl 的收紧只在外部输入侧生效，
  // 镜像入口若原样落盘等于给备份侧的收紧留了绕行通道（加进基础 schema 会误伤运行时读盘）。
  const parsedFolders = InboundFixedFolderSchema.array()
    .max(FOLDERS_LIMIT)
    .safeParse(mirror.folders);
  const parsedPins = InboundPersistentPinListSchema.safeParse(mirror.pins);
  // 单边解析失败：不恢复、不置 seeded、不推镜像——推了会把本地空值覆盖云端对应分区，永久失去恢复机会。
  if (!parsedFolders.success || !parsedPins.success) {
    ctx.reportPersistenceFailure('dataStore', '同步镜像数据异常，已跳过恢复（下次启动重试）');
    // 镜像读得到但内容非法时，状态行不能停在「已生效」。
    ctx.set({ mirrorIssue: 'unreadable' });
    return 'failed';
  }

  let writesOk = true;

  /**
   * 锁内复核 seeded（TOCTOU）：入口读到的 false 可能是并发页置位前的旧值。
   * 置位意味着另一上下文已完成恢复、本地即权威 —— 本页不得再以镜像覆盖
   * （写侧 `disk.length > 0` 兜底），这次 pull 的分类也不属于本页结论、不得落地。
   */
  let seededInLock = false;
  // 跨页锁 + 锁内重读：并发上下文刚写过本地数据时以本地为准。
  let nextFolders = ctx.get().folders;
  const foldersOk = await withCrossPageLock(FOLDERS_RMW_LOCK, async () => {
    if (await ctx.repos.seeded.readStrict()) {
      seededInLock = true;
      return true;
    }
    const disk = await ctx.repos.folders.readStrict();
    if (disk.length > 0) {
      nextFolders = disk;
      return true;
    }
    nextFolders = parsedFolders.data;
    return ctx.repos.folders.write(nextFolders);
  });
  // 并发上下文已完成恢复并置 seeded：本页这次拉取不作为本页结论落地。
  if (seededInLock) return 'already-seeded';
  ctx.set({ mirrorIssue: pullIssue });

  if (foldersOk) {
    ctx.set({ folders: nextFolders });
  } else {
    ctx.reportPersistenceFailure('dataStore', '镜像恢复的固定文件夹写入失败');
    writesOk = false;
  }

  let nextPins = ctx.get().pins;
  const pinsOk = await withCrossPageLock(PINS_RMW_LOCK, async () => {
    const disk = await ctx.repos.pins.readStrict();
    if (disk.length > 0) {
      nextPins = disk;
      return true;
    }
    nextPins = parsedPins.data;
    return ctx.repos.pins.write(nextPins);
  });
  if (pinsOk) {
    // 仓库 read 不去重，此处必须去重（与 initSlice / pins watcher 同口径）。
    ctx.set({ pins: dedupePins(nextPins) });
  } else {
    ctx.reportPersistenceFailure('dataStore', '镜像恢复的固定图标写入失败');
    writesOk = false;
  }

  // 写盘失败同样降级状态：镜像读到了但一条都没落盘，「已生效」是假象。
  if (!writesOk) {
    ctx.set({ mirrorIssue: 'unreadable' });
    return 'failed';
  }
  const seededOk = await ctx.repos.seeded.write(true);
  if (!seededOk) {
    ctx.reportPersistenceFailure('dataStore', '镜像恢复完成标记写入失败（下次启动重试）');
    ctx.set({ mirrorIssue: 'unreadable' });
    return 'failed';
  }
  return 'restored';
}
