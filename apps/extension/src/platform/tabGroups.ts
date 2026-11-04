import { browser, type Browser } from 'wxt/browser';

/**
 * chrome.tabGroups 类型桥接（全仓唯一事实来源）。
 *
 * wxt 生成的类型对 tabGroups.create 及 update 的 title/color 覆盖不全；改签名收敛到本模块
 * 单一定义，由编译器兜住。运行时对象保持原样（能力缺失环境中可能为 undefined）。
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

/**
 * 消费侧依赖的 tabGroups 形状：以原生类型为底，只覆盖签名不全的三个方法。
 * query 必须显式写成单签名——原生类型还带 callback 重载，`ReturnType` 会取到
 * `void`，让 `Awaited<ReturnType<typeof tabGroups.query>>` 退化成 void。
 * 交集使下方单次向下收窄成立，避免绕过类型检查的双重断言。
 */
type TabGroupsBridge = Omit<typeof browser.tabGroups, 'query' | 'update'> & {
  query: (queryInfo: object) => Promise<Browser.tabGroups.TabGroup[]>;
  create: (options: object) => Promise<{ id: number }>;
  update: (groupId: number, updateProperties: TabGroupMutableProps) => Promise<unknown>;
};

/** 全仓唯一事实来源：运行时对象保持原样，仅在类型层补齐消费侧形状。 */
export const tabGroups = browser.tabGroups as TabGroupsBridge;
