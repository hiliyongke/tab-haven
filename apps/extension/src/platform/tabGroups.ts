import { browser, type Browser } from 'wxt/browser';

/**
 * chrome.tabGroups 类型桥接（全仓唯一事实来源）。
 *
 * wxt 生成的类型对 tabGroups.create 及 update 的 title/color 覆盖不全，断言无法完全避免；
 * 故收敛到本模块单一定义，改签名由编译器兜住。
 *
 * 注：chrome.tabGroups 没有 remove API（公开方法仅 get/query/update/move），
 * 解散组的标准做法是 tabs.ungroup 成员，见 platform/tabs.ts 的 removeGroup。
 */

/** 组的可写属性（wxt 类型未覆盖 title/color 字面量）。 */
interface TabGroupMutableProps {
  title?: string;
  color?: string;
  collapsed?: boolean;
}

/**
 * 「组已不存在」的报错文案判定（全仓唯一实现）。
 * 兼容 `No group with id: N` / `group not found` / `no such group`，避免某处漏判。
 *
 * 这是文案匹配，只用于决定日志是否 quiet（降噪），不承担「组是否真的消失」的判定——
 * 后者必须走 groupExists 的三态返回。
 */
export function isMissingGroupErrorMessage(error: unknown): boolean {
  return (
    error instanceof Error && /no group with id|group not found|no such group/i.test(error.message)
  );
}

export const tabGroups = browser.tabGroups as unknown as {
  create: (options: object) => Promise<{ id: number }>;
  update: (groupId: number, updateProperties: TabGroupMutableProps) => Promise<unknown>;
  /** 判定组是否仍存在（区分「已解散」与「解散失败」），见 removeGroup。原生返回类型已足够。 */
  get: (groupId: number) => Promise<Browser.tabGroups.TabGroup>;
  move: (groupId: number, options: { index: number }) => Promise<unknown>;
  /** query 原生类型已足够（含 title/color/collapsed），无需另立形状。 */
  query: (queryInfo: { windowId?: number }) => Promise<Browser.tabGroups.TabGroup[]>;
};
