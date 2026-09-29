import type { ReadLaterItem } from '@/core/schema/models';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { trimReadLater } from '@/core/readlater/trim';
import { newId } from '@/core/util/id';
import { readLaterRepository } from '@/platform/storage/repositories';
import { withCrossPageLock } from '@/platform/storage/crossPageLock';

/**
 * 稍后读写操作（面板 store 与 background 右键菜单共用）。
 *
 * 必须下沉到 platform：background 的右键入口若直接 `import` 面板 store，
 * 会把 React/zustand 打进 service worker bundle；反过来在 SW 里重写一遍
 * 读写又会造成两条口径（去重/危险 URL 判定各自漂移）。
 */
/** 跨页锁名：导入事务等外部写入方必须用同一把锁，否则会与本层的 RMW 交错互覆。 */
export const READLATER_RMW_LOCK = 'tabs.read-later-rmw';

/** 整表替换（导入事务 / 归档清空等批量场景），走同一把跨页锁。 */
export function replaceReadLater(items: readonly ReadLaterItem[]): Promise<boolean> {
  return withCrossPageLock(READLATER_RMW_LOCK, () =>
    readLaterRepository.write(trimReadLater(items))
  ).then((ok) => ok !== false);
}

/** 锁内「重读 → 合并 → 写」，返回是否落盘成功。 */
export async function mutateReadLater(
  apply: (current: ReadLaterItem[]) => ReadLaterItem[]
): Promise<boolean> {
  const ok = await withCrossPageLock(READLATER_RMW_LOCK, async () => {
    const current = await readLaterRepository.read();
    return readLaterRepository.write(trimReadLater(apply(current)));
  });
  return ok !== false;
}

/** 暂存一个标签：非 http(s) 拒绝；同 URL 去重（重新暂存 = 变未读 + 刷新时间）。 */
export function applyAddItem(
  current: ReadLaterItem[],
  entry: { url: string; title: string; favIconUrl?: string }
): ReadLaterItem[] {
  const key = webComparisonKey(entry.url, undefined);
  if (key === null) return current;
  const existing = current.find((item) => webComparisonKey(item.url, undefined) === key);
  if (existing) {
    return current.map((item) =>
      item.id === existing.id
        ? {
            ...item,
            addedAt: Date.now(),
            readAt: undefined,
            title: entry.title,
            favIconUrl: entry.favIconUrl ?? item.favIconUrl
          }
        : item
    );
  }
  return [
    ...current,
    {
      id: newId('rl'),
      url: key,
      title: entry.title,
      favIconUrl: entry.favIconUrl,
      addedAt: Date.now()
    }
  ];
}
