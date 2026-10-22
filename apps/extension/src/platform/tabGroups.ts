import { browser, type Browser } from 'wxt/browser';

/**
 * chrome.tabGroups 类型桥接（全仓唯一事实来源）。
 *
 * wxt 生成的 browser 类型对 tabGroups 的 create 以及 update 的 title/color
 * 属性覆盖不全，桥接本身无法完全避免；但此前 platform/tabs.ts 与
 * platform/snapshot/snapshots.ts **各持一份** `as unknown as` 断言（注释里
 * 互称「同款 workaround」），两份独立字典型声明之间没有任何编译期约束，
 * 改一处必漏另一处 —— 桥接从「受控单点」退化成了复制品。
 * 现收敛到本模块：声明只此一处，两侧 import，任何一侧改签名都由编译器兜住。
 *
 * 注：chrome.tabGroups 没有 remove API（公开方法仅 get/query/update/move），
 * 解散组的标准做法是 tabs.ungroup 成员，见 platform/tabs.ts 的 removeGroup。
 */

/** 组的可写属性（wxt 类型未覆盖 title/color 字面量）。 */
export interface TabGroupMutableProps {
  title?: string;
  color?: string;
  collapsed?: boolean;
}

/**
 * 「组已不存在」的报错文案判定（全仓唯一实现）。
 *
 * Chrome 抛出的是 `No group with id: N`；同时兼容 `group not found` /
 * `no such group` 两种同质文案，避免某处漏判。
 *
 * 注意：这是**文案匹配**，用于决定日志是否 quiet（降噪），不承担
 * 「组是否真的消失」的判定 —— 后者必须走 `groupExists` 的三态返回。
 * 收口在本模块：此前同类正则散落在各调用点，改文案时必然漏改。
 */
export function isMissingGroupErrorMessage(error: unknown): boolean {
  return (
    error instanceof Error && /no group with id|group not found|no such group/i.test(error.message)
  );
}

export const tabGroups = browser.tabGroups as unknown as {
  create: (options: object) => Promise<{ id: number }>;
  update: (groupId: number, updateProperties: TabGroupMutableProps) => Promise<unknown>;
  /**
   * 用于判定组是否仍存在（区分「已解散」与「解散失败」），见 removeGroup。
   * 原生返回类型已足够（含 title），不降级为 unknown —— 否则调用方要再断言一次
   * 才能读 title，等于把桥接省下的断言又还了回去。
   */
  get: (groupId: number) => Promise<Browser.tabGroups.TabGroup>;
  move: (groupId: number, options: { index: number }) => Promise<unknown>;
  /** query 的原生类型已足够（含 title/color/collapsed），无需另立形状。 */
  query: (queryInfo: { windowId?: number }) => Promise<Browser.tabGroups.TabGroup[]>;
};
