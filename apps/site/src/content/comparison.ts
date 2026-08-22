/**
 * 三方对比：Tabs / 浏览器原生标签管理 / 云同步型标签工具。
 *
 * 口径纪律：
 * - 只陈述**可核验**的事实，出处在 README / PRIVACY.md / wxt.config.ts；
 * - **不点名**任何具体产品（第三方栏位写的是这一类工具的普遍做法，拿不准就写
 *   「视产品而定」）；
 * - 不贬低 —— 原生栏位写「不带额外能力」，不写「差」。
 */
export interface ComparisonRow {
  featureKey: string;
  tabsKey: string;
  nativeKey: string;
  cloudKey: string;
}

export const COMPARISON: readonly ComparisonRow[] = [
  {
    featureKey: '数据存放位置',
    tabsKey: '本机 chrome.storage.local，卸载即清除',
    nativeKey: '浏览器自己的会话里，不会额外落成一份数据',
    cloudKey: '服务商的服务器'
  },
  {
    featureKey: '是否需要账号',
    tabsKey: '不需要，也没有注册入口',
    nativeKey: '不需要（用浏览器账号登录是另一回事）',
    cloudKey: '需要注册并登录'
  },
  {
    featureKey: '跨设备',
    tabsKey: '可选；默认关闭，开启后经你自己的浏览器账号通道镜像',
    nativeKey: '由浏览器自己的同步提供',
    cloudKey: '由服务商同步，通常为主要卖点'
  },
  {
    featureKey: '误关找回',
    tabsKey: '10 层撤销栈 + 撤销历史面板，可整批恢复',
    nativeKey: '只能重新打开最近关闭的那一个',
    cloudKey: '视产品而定'
  },
  {
    featureKey: '重复标签治理',
    tabsKey: '一键去重，保留你正在用的那个，可撤销',
    nativeKey: '不提供',
    cloudKey: '视产品而定'
  },
  {
    featureKey: '休眠释放内存',
    tabsKey: '手动 / 批量 / 自动，支持域名白名单',
    nativeKey: '不提供（需另装扩展）',
    cloudKey: '视产品而定'
  },
  {
    featureKey: '权限与数据说明',
    tabsKey: '12 项权限逐条写明用途，零网络请求可自行验证',
    nativeKey: '浏览器自带，无需额外权限',
    cloudKey: '由服务商的隐私政策披露'
  }
];
