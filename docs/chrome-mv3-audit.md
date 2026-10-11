# Chrome MV3 合规审计（Tabs v1.0）

> 审计依据：`chrome-extensions` 技能 Part 1 的 20 条强制规则 + `chrome-extension-wxt` 技能 + 本仓库分层/隐私红线。
> 审计日期：2026-10-11 · 范围：`wxt.config.ts` / `src/entrypoints/**` / `src/platform/**` / `src/stores/**`。
> 第二轮在文末「第二轮：WXT 专项 + 兼容性清理」，已按结论实施修改。

## 结论先行

- **必修 1 条**：`contextMenus` 用了 `contexts: ['tab']`，与 `minimum_chrome_version: '114'` 不匹配；一旦内核不支持，`removeAll()` 之后的**全部菜单项都不会被创建**，且失败只进诊断日志、用户无感。
- **应修 3 条**：右键菜单两处动作「点了没反馈」，omnibox 建议无 `.catch`（reject 时地址栏永久空白）。
- **建议修 3 条**：Service Worker 内裸 `setTimeout` 三处 + 纯内存锚点 Map（SW 回收即丢）；`stores` 层直连 `browser.storage.clear()` 破分层红线。
- **已核验无问题**：图标文件、侧边栏打开方式、`chrome.windows` 方法、消息 `return true`、权限请求手势、eval/内联脚本、offscreen/devtools/userScripts/capture/identity 等 12 项。
- 合计工作量约 **1.6 人日**。

## 修复状态（2026-10-11 已实施）

| ID  | 状态              | 落地位置                                                                                                                                                                                                                                                                   |
| --- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-1 | ✅ 已修           | `background/contextMenus.ts` 新增 `createMenuItem`（逐项 try/catch + 留痕），action 菜单前移到 tab 上下文之前；`tests/background/context-menus.test.ts` 断言改为「首项失败后其余菜单照常创建」                                                                             |
| A-2 | ✅ 已修           | `runPanelSearch` 上提到 `background/shared.ts:178`，右键菜单（`background.ts:451`）与 omnibox（`omnibox.ts:132,136`）共用                                                                                                                                                  |
| A-3 | ✅ 已修           | `background.ts:439` 按 `pinsRepository.write` 的真实结果通知成功/失败；新增 `bg.pinDone` / `bg.pinFailed` 中英词条                                                                                                                                                         |
| A-4 | ✅ 已修           | `background.ts` omnibox 建议与回车两条路径均补 `.catch`（失败时 `suggest([])` 不再卡住地址栏）                                                                                                                                                                             |
| A-5 | ✅ 已修           | `badge.ts` 新增带到期时间的 `showBadgeOverride`（替代裸 `setTimeout`）；`windowCache.ts` 关窗标记改为 `Map<windowId, expireAt>` + 读时惰性过期                                                                                                                             |
| A-6 | ⏸ 不改码          | 经核验已被现有逻辑覆盖：`background.ts:192` 每次 SW 启动都跑 `initWindowTabsCache()`，其为所有窗口 `refreshWindowTabs` 并按激活标签补种锚点（`windowCache.ts`）。要跨回收**精确**保留需新增 session 存储键 —— 属新增持久化数据，须先改 `PRIVACY.md` 3.1 节并经批准，故未做 |
| A-7 | ✅ 已修（非本轮） | 工作区并行改动已收口为 `platform/storage/DataRepository.ts` 的 `clearAllStoredData()`，`settingsSlice.ts:141` 调用它，`browser` 直连已移除                                                                                                                                 |
| A-8 | ✅ 已修           | `CHANGELOG.md` 文件名改为 `public/uninstall-backup.html`                                                                                                                                                                                                                   |

> 120ms omnibox 防抖定时器保留：SW 在事件处理期间不会被回收，其唯一可观测失败（建议永不返回）已由 A-4 的 `suggest([])` 兜底。

## 缺陷清单

| ID  | 问题                                                                                                                                | 位置                                                                            | 优先级 | 工作量 | 改法                                                                                                                                         | 验收标准                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A-1 | `contexts: ['tab']` 需 Chrome M150+，而 manifest 声明 114。create 抛错会中断整批菜单创建（先 removeAll 后 create，失败后 5 项全丢） | `src/platform/background/contextMenus.ts:117,127,132`（`wxt.config.ts:23`）     | P0     | 0.5    | ① 每条 `create` 独立 `try/catch`，失败只丢自身；② tab 上下文三项挪到独立批次、放在 action 菜单之后；③ 首次 create 失败即降级关闭该项并记诊断 | 在 Chrome 114 与最新稳定版分别加载：两处右键菜单项数量符合预期（旧内核仅缺 tab 三项，其余齐全） |
| A-2 | 右键「搜索此域名」只入队不开面板；面板未开时用户零反馈。同语义的 omnibox 路径（先开面板再入队）行为不一致                           | `src/entrypoints/background.ts:440-444`（对照 `background/omnibox.ts:145-148`） | P1     | 0.2    | 把 `omnibox.ts` 的 `runPanelSearch` 上提到 `background/shared.ts`，菜单分支与 omnibox 共用                                                   | 面板关闭时点右键「搜索此域名」：面板自动打开且搜索词已填入                                      |
| A-3 | 右键「固定到图标区」**成功**路径无任何反馈（仅失败才 `notifyUser`），违反「上下文菜单动作必须给反馈」                               | `src/entrypoints/background.ts:414-438`                                         | P1     | 0.1    | 成功分支补 `notifyUser('Tabs', t('bg.addToFolderDone'))`（新增词条需中英双写）                                                               | 成功/失败各有一次通知；`pnpm check:i18n` 通过                                                   |
| A-4 | omnibox 建议与回车两条路径无 `.catch`：`queryOmnibox` reject → `suggest` 永不调用（地址栏永久空白）+ 未捕获 rejection               | `src/entrypoints/background.ts:468,473`                                         | P1     | 0.1    | `.catch(error => { logDegraded('background', '地址栏建议失败', error); suggest([]); })`；回车路径同理                                        | 注入存储读取失败后，地址栏显示空建议而非永久 loading，且诊断区可见一条记录                      |
| A-5 | SW 内裸 `setTimeout`：SW 空闲回收会吞掉定时器，导致角标永久停在 `✓`、`removedWindowIds` 单调增长、omnibox 防抖建议丢失              | `background.ts:497`、`background/windowCache.ts:243`、`background.ts:460-469`   | P2     | 0.5    | 改「时间戳 + 读时惰性判过期」；角标恢复态存 `storage.session`，由 `refreshBadge` 判定                                                        | 手动触发 SW 终止后：角标 1.5s 内恢复正常；关窗标记在 TTL 后自然失效                             |
| A-6 | `windowCache.ts` 的 `lastActiveTabIds` 是纯内存 Map，SW 回收后「新建标签插在激活标签之后」在首次新建时失效                          | `src/platform/background/windowCache.ts:111`                                    | P2     | 0.2    | 随 `memWindowTabs` 一并镜像到 `storage.session`（已有 `flushWindowTabs` 通道可复用）                                                         | SW 重启后首次 Ctrl+T 仍落在上一激活标签之后；session 键变更同步 `PRIVACY.md` 3.1 节             |
| A-7 | `stores` 层直连 `browser.storage.local/session.clear()`，破「存储写入只在 `platform/storage`」红线                                  | `src/stores/data/settingsSlice.ts:141-142`                                      | P2     | 0.2    | 在 `platform/storage` 新增 `clearAllStorage()`（local+session+sync 镜像一并清），store 只调它                                                | 清空数据路径全部经 platform；`pnpm test` 与分层扫描无新增 `browser.storage` 直连                |
| A-8 | 文档口径漂移：CHANGELOG 写 `public/uninstall.html`，实际文件是 `public/uninstall-backup.html`（代码引用正确）                       | `CHANGELOG.md:10`（对照 `background.ts:342`）                                   | P3     | 0.05   | 改 CHANGELOG 文件名                                                                                                                          | 文档中文件名与 `public/` 实际文件一致                                                           |

## 已核验：未发现问题

| 规则                                                                                        | 核验结论                                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 图标引用真实存在                                                                            | `public/icon/{16,32,48,128}.png` 齐备；通知走 `runtime.getURL('/icon/128.png')`（`background/shared.ts:87`），非虚构路径                                        |
| 侧边栏必须有打开方式                                                                        | `background.ts:137` 用 `openPanelOnActionClick`（拼写正确）；`wxt.config.ts:79` 标准版删 `default_popup`；另有 commands / 右键 / `shared.ts:151-170` 同步栈降级 |
| `chrome.windows.query` 不存在                                                               | 未发现；全部为 `getAll`（`windowCache.ts:220`）/ `getLastFocused`（`shared.ts:165`）/ `getCurrent`（`platform/sidePanel.ts:33`）                                |
| `onMessage` 异步需 `return true`                                                            | `background.ts:291-292` 唯一异步分支已 `return true`；其余为同步 `sendResponse`                                                                                 |
| `permissions.request` 手势                                                                  | 唯一调用点在设置页 Toggle 的用户手势内（`entrypoints/options/settingControls.tsx:279`），不在 SW `onMessage`                                                    |
| 无 `eval` / `new Function` / 内联脚本                                                       | `src/` 与 `public/*.html` 均未发现                                                                                                                              |
| 无 activeTab 误用 / 无 content script                                                       | 未发现；读取标签走 `tabs` 权限 + optional host                                                                                                                  |
| 无 offscreen / devtools / userScripts / tabCapture / desktopCapture / identity / Prompt API | 均未发现                                                                                                                                                        |
| `declarativeNetRequest` 用法                                                                | 动态规则 + `hasPermissions` 前置 + catch 记诊断 + 设置页 denied/permissionLost/regrant 三条回退（`platform/nocache/noCache.ts:42-57`）                          |
| `action` 已声明                                                                             | WXT 检测 popup 入口自动生成；`chrome.action.setBadgeText` 调用点在 `background.ts:487,495` 与 `background/badge.ts:11-57`                                       |
| 异步错误处理                                                                                | `platform/**` 抽查（tabs / permissions / noCache / windowCache / shared）均有 `try/catch` + `logDegraded`                                                       |
| 无 `setInterval` 在 SW                                                                      | 未发现（`sync/TabSyncService.ts:155` 的定时器运行在侧边栏 DOM 上下文）                                                                                          |

## 需实测确认（不可凭代码判定）

1. **A-1 的实际影响面**：`contexts: ['tab']` 在当前稳定版 Chrome 是否已支持。若已支持（M150+），A-1 降级为 P2 防御性加固；若不支持，是 P0 功能失效。建议在 `chrome://extensions` 加载后打开诊断区看是否有「右键菜单写入失败」。
2. **`chrome.commands` 的 `suggested_key` 数量约束**：当前声明 4 条（`wxt.config.ts:46-63`），再新增快捷键前需实测确认 Chrome 的自动分配上限。

---

## 第二轮：WXT 专项 + 兼容性清理（2026-10-11）

> 前提：Tabs **尚未发布正式版**，任何「兼容旧版本 / 迁移旧数据」的代码都是过度工程化，应清除。

### 版本兼容逻辑盘点（结论：**无遗留兼容代码**）

| 面                  | 结论                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 备份/导出格式       | 单一格式：`EXPORT_FILE_VERSION = 1`（`core/schema/models.ts:337`），`z.literal` 校验，**版本不同即拒绝**，无跨版本解析函数                                           |
| 存储键              | 全部为 `.v1` 首版键，无 v1→v2 迁移函数、无旧键回读                                                                                                                   |
| 设置                | `DEFAULT_SETTINGS = SettingsSchema.parse({})` 单点派生（`core/schema/models.ts:252`），无「合并旧值」逻辑                                                            |
| 浏览器/内核兼容分支 | 兼容变体构建管道已清除（见下）；保留的 `browser.sidePanel?.` / `omnibox?.` / `action?.` 可选链是**真环境需要**（基线 114 低于 sidePanel 所需 116），不是版本兼容代码 |

### 本轮已清理

| ID  | 项                                                                                                                  | 处理                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-1 | 兼容变体构建管道（`TABS_VARIANT=compat`）                                                                           | `wxt.config.ts` 的 `isCompatVariant` 与 hook 分支已由并行改动清除；本轮删掉 `package.json` 的 `cross-env` 残留依赖与 README 的 `build:compat` / 「兼容变体随 V2.0 交付」文案                                                                      |
| W-2 | 空入口目录 `src/entrypoints/bookmarks/`                                                                             | 已删除（无实现、无引用）                                                                                                                                                                                                                          |
| W-3 | 17 个 i18n 死键（稍后读下线遗留：`readlater.*`、`tabs.addToReadLater`、`bg.readLaterFailed`、`about.domContext3*`） | 已从 zh-CN / en 删除，`pnpm check:i18n` 由失败转为「各 766 键、死键 0」                                                                                                                                                                           |
| W-4 | 「旧版本 / 未来版本 schema 偏斜 / 兼容变体」类失效注释 12 处                                                        | 已改写为中性表述（`sidePanel.ts:7`、`session.ts:11`、`windowCache.ts:13`、`models.ts:98,271,299,301`、`initSlice.ts:61`、`mirrorRestore.ts:57`、`UndoHistoryPanel.tsx:28`、`snapshots.ts:222,252`、`snapshotDiff.ts:59`、`RestoreEngine.ts:128`） |
| W-5 | 三个文档残留的 `</content>` / `</invoke>` 多余行                                                                    | 已删除                                                                                                                                                                                                                                            |

### WXT 产物核对（`pnpm build` 后读 `.output/chrome-mv3/manifest.json`）

- `icons` 四个尺寸均指向真实文件 ✅
- `background.service_worker: background.js` —— 产物为 **IIFE**（无顶层 `import`），因此**不需要** `type: 'module'` ✅
- `action: { default_title: 'Tabs' }` 存在（`chrome.action.setBadgeText` 依赖它）且**无 `default_popup`** ✅
- `optional_host_permissions: ['<all_urls>']`、`host_permissions` 缺省 ✅；CSP 用 WXT 默认值 ✅
- `commands` 4 条、`omnibox.keyword: 't'`、`options_ui.open_in_tab: true` 均生效 ✅
- SW 全部 20+ 个 `addListener` 均在 `defineBackground` 主流程**同步**注册（无 await 之后再注册） ✅
- `alarms` 周期：自动休眠固定 `periodInMinutes: 1`；定时快照取 `autoSnapshotIntervalMin`（schema 下限 5 分钟，`models.ts:152`）→ 无「低于 1 分钟被拒」风险 ✅

### 待你拍板 / 需实测

| ID  | 项                                                  | 说明                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-6 | `popup.html` 打进产物但**不可达**                   | 标准版 manifest 无 `default_popup`，代码里也没有 `openPopup`（全库零命中）。它是「快速切换器」形态，此前归在兼容变体下交付。删它会连带清 `src/entrypoints/popup/`（4 文件）、`tests/ui/popup-app.test.tsx`、i18n `popup.*`，并需给 manifest 补 `action: {}`（badge 依赖 action）。**建议保留并单独立项**，与 `docs/v1-acceptance-review.md:122` 的「延后至 V2.0」一致 |
| W-7 | `setUninstallURL('uninstall-backup.html')` 相对路径 | `background.ts:343`。Chrome 是否接受相对/`chrome-extension://` 卸载 URL 需实测；不接受则「卸载挽留页」永不出现（失败被 catch 静默吞掉）                                                                                                                                                                                                                               |
| W-8 | `contexts: ['tab']`（即 A-1）                       | 同文首「需实测确认」第 1 条                                                                                                                                                                                                                                                                                                                                           |
| W-9 | `public/icon/logo.svg`、`logo-light.svg`            | 误报已更正：两者被关于页引用（`entrypoints/about/AboutPage.tsx:247-248`，明暗两版按主题切换），**必须随包**，不清理                                                                                                                                                                                                                                                   |
