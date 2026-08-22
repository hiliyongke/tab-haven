/**
 * 常见问题（7 条）。
 *
 * 答案口径来自 `PRIVACY.md`、`SECURITY.md` 与 `README.md`，只陈述已实现的行为。
 */
export interface FaqItem {
  qKey: string;
  aKey: string;
}

export const FAQ: readonly FaqItem[] = [
  {
    qKey: '它真的不发起任何网络请求吗？我能自己验证吗？',
    aKey: '可以。打开 DevTools 的 Network 面板并观察扩展的 Service Worker 上下文，你会看到零条请求。标签旁的站点图标取自浏览器自己的本地图标库（favicon 权限），不向你访问的站点发起任何请求；扩展的关于页里还给出了完整的自验证步骤。'
  },
  {
    qKey: '我的数据存在哪里？',
    aKey: '以 chrome.storage.local 为主，全部留在本机浏览器里，离线可用，卸载扩展即清除。我们没有服务器，也没有账号，没有别的地方能存放这些数据。'
  },
  {
    qKey: '跨设备同步会不会经过你们的服务器？',
    aKey: '不会。同步默认关闭；开启后文件夹、常驻磁贴与设置经你自己的浏览器账号通道（chrome.storage.sync）镜像，Tabs 不经手也看不到这些数据。关掉开关即删除镜像。'
  },
  {
    qKey: '关错了一批标签还能找回吗？',
    aKey: '能。经本产品执行的关闭都进多层撤销栈（栈深 10），可以一层层撤回来；撤销历史面板支持任意批次恢复，还列出浏览器最近关闭的标签与窗口。恢复失败的条目会留在历史里，可以重试。'
  },
  {
    qKey: '为什么在应用商店里搜不到？',
    aKey: '尚未上架。当前提供打包好的压缩包：下载解压后，打开对应浏览器的扩展管理页（Chrome / Brave 是 chrome://extensions，Edge 是 edge://extensions），开启开发者模式，再「加载已解压的扩展程序」选中文件夹即可使用。'
  },
  {
    qKey: '支持哪些浏览器？',
    aKey: 'Chrome、Edge、Brave 等 Chromium 内核浏览器，版本需 ≥ 114 —— 更低的版本侧边栏 API 不全。'
  },
  {
    qKey: '休眠的标签会不会丢？',
    aKey: '不会。休眠只是释放这个标签占用的内存，标签本身仍在原处（图标置灰），需要时一键唤醒全部即可。'
  }
];
