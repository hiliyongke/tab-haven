import type { UndoTabRecord } from '@/core/schema/models';
import { createUndoBatch, pushBatch } from '@/core/undo/UndoStack';
import {
  redoRepository,
  settingsRepository,
  undoRepository
} from '@/platform/storage/repositories';
import { UNDO_PERSIST_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';

/**
 * 面板未接收 reuse-closed 消息时，由 SW 直接把关闭批次补登记到撤销库。
 * 返回 false 表示读写失败；persistUndo 关闭时按既有设置不写盘并返回 true。
 */
export async function persistReuseClosedBatch(
  windowId: number,
  records: readonly UndoTabRecord[]
): Promise<boolean> {
  if (records.length === 0) return true;
  const settings = await settingsRepository.readStrict();
  if (!settings.persistUndo) return true;
  const batch = createUndoBatch('reuse', [...records], { windowId });
  return withCrossPageLock(UNDO_PERSIST_LOCK, async () => {
    const [disk, redo] = await Promise.all([
      undoRepository.readStrict(),
      redoRepository.readStrict()
    ]);
    // 与面板 appendBatch 同口径：新关闭批次使旧重做目标失效。
    const redoWritten = redo.length === 0 || (await redoRepository.write([]));
    const undoWritten = await undoRepository.write(pushBatch(disk, batch, settings.undoStackLimit));
    return redoWritten && undoWritten;
  });
}
