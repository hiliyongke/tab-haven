import type { ReadLaterItem } from '@/core/schema/models';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { trimReadLater, trimReadLaterWithEvicted } from '@/core/readlater/trim';
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

/**
 * 淘汰监听（R18 / S-3）。由 store 注册，用于把「因超限淘汰了 N 条」告知用户。
 * 为什么用回调而不是返回值：mutateReadLater 的布尔签名被 background 与面板共用，
 * 改成对象会波及所有调用方；而淘汰提示只有面板需要。
 */
let onEvicted: ((count: number) => void) | undefined;
export function setReadLaterEvictionListener(fn: (count: number) => void): void {
  onEvicted = fn;
}

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
    const { kept, evicted } = trimReadLaterWithEvicted(apply(current));
    // 淘汰是有信息量的事件：此前用户以为一直在存，实际最早的条目已被静默丢弃。
    // platform 层不做 UI 反馈（那是 store/UI 的职责），只把数字交给注册的监听方。
    if (evicted.length > 0) onEvicted?.(evicted.length);
    return readLaterRepository.write(kept);
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
