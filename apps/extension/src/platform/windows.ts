import { browser } from 'wxt/browser';

/**
 * 「普通窗口」的唯一判定口径。
 *
 * 关窗自动快照（windowCache）、定时自动快照（autoSnapshot）与自动分组（autoGroup）
 * 此前各写一份窗口枚举：一处 `getAll({populate:false})` 全量收、一处只排除
 * `incognito`、一处只限定 `windowTypes:['normal']`。三份互斥口径的直接后果是
 * **同一台机器上的同一批窗口，在三条快照路径里被判成不同集合**：无痕窗口的
 * URL 与标题只会在「关窗」这一条路径上被写进持久快照，而定时快照刻意排除了它
 * （`PRIVACY.md` 第 3 节「不记录浏览内容」的承诺因此只兑现了一半）。
 *
 * 判定三条件：`populate:false`（标签另行按窗口查，不必回传整树）+ 非无痕 +
 * 窗口类型为 normal（popup / devtools 不是用户的工作窗口）。
 *
 * 查询失败**不在此处兜住**：三个调用方的后果各不相同（本轮不建缓存 / 不保存快照 /
 * 不自动分组），留痕文案只有调用方写得出来，统一吞成「返回空数组」会让排查停在
 * 「窗口列表查询失败」而看不出到底哪条能力受了影响。
 */

/** `windows.Window` 里本模块关心的字段（其余字段不参与判定，也不必声明）。 */
interface WindowLike {
  id?: number;
  incognito?: boolean;
  type?: string;
}

/**
 * `type` 缺省时按 normal 处理。
 *
 * Chrome 恒返回该字段；但模拟环境（单测 fake-browser）与部分运行环境的
 * `getAll({populate:false})` 不带它 —— 一律按「非 normal」排除会让这些环境里
 * **一个窗口都枚举不到**，表现为整个功能静默停摆。
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
