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

export const tabGroups = browser.tabGroups as unknown as {
  create: (options: object) => Promise<{ id: number }>;
  update: (groupId: number, updateProperties: TabGroupMutableProps) => Promise<unknown>;
  /** 用于判定组是否仍存在（区分「已解散」与「解散失败」），见 removeGroup。 */
  get: (groupId: number) => Promise<unknown>;
  move: (groupId: number, options: { index: number }) => Promise<unknown>;
  /** query 的原生类型已足够（含 title/color/collapsed），无需另立形状。 */
  query: (queryInfo: { windowId?: number }) => Promise<Browser.tabGroups.TabGroup[]>;
};
