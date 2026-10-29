import { browser } from 'wxt/browser';

/**
 * 「普通窗口」的唯一判定口径。
 *
 * 三条路径（关窗快照 / 定时快照 / 自动分组）共用此口径，避免同一批窗口被判成不同集合——
 * 否则无痕窗口可能只在某条路径被写进持久快照，与 `PRIVACY.md` 第 3 节「不记录浏览内容」相悖。
 *
 * 判定三条件：`populate:false`（标签另行按窗口查）+ 非无痕 + type 为 normal。
 *
 * 查询失败不在此处兜住：三个调用方后果不同（不建缓存 / 不保存 / 不分组），
 * 统一吞成空数组会让排查停在「查询失败」而看不出哪条能力受影响。
 */

/** `windows.Window` 里本模块关心的字段。 */
interface WindowLike {
  id?: number;
  incognito?: boolean;
  type?: string;
}

/**
 * `type` 缺省按 normal 处理：模拟环境（单测 fake-browser）与部分运行环境的
 * `getAll({populate:false})` 不带该字段，一律排除会一个窗口都枚举不到。
 */
function isNormalWindow(win: WindowLike): boolean {
  return win.incognito !== true && (win.type === undefined || win.type === 'normal');
}

/** 列出当前所有普通（非无痕、非 popup/devtools）窗口的 id。 */
export async function listNormalWindowIds(): Promise<number[]> {
  const wins = (await browser.windows.getAll({ populate: false })) as WindowLike[];
  const ids: number[] = [];
  for (const win of wins) {
    if (typeof win.id === 'number' && isNormalWindow(win)) ids.push(win.id);
  }
  return ids;
}
