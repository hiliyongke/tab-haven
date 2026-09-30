# Tabs 产品设计文档

**版本**：v1.0（依据 `package.json:6`；对外版本口径统一为 v1.0，见优化计划 §9 决策 D1）｜**日期**：2026-09-30｜**状态**：现状描述（As-Is）
**证据口径**：本文所有结论均来自本仓库代码/文档，附 `file:line`；无出处的推断一律标「推断」或「待确认」。
**仓库**：本仓库根目录（路径一律相对引用）— Chrome / Edge Manifest V3 侧边栏扩展。

> **⚠️ 同步范围口径提示（2026-09-30 补记）**：本文成文早于同步镜像范围的口径统一，文中若出现「文件夹与设置」一类表述，**实际同步范围为「文件夹 + 常驻磁贴（pins）+ 设置」**（`MirrorPayloadSchema = { at, folders, pins, settings }`，见 `src/platform/storage/SyncMirror.ts`）。本文 §4.13 与 §6.4 两处已按实际范围更正，其余位置若有遗漏，一律以 [PRIVACY.md](../PRIVACY.md) 第 4 节为准。

---

## 0. 阅读须知（本文边界 / 什么是已实现、什么是不确定）

**本文是什么**：对当前代码库「已实现成什么样」的逆向规格化描述（As-Is），用于给后续的路线图、竞品对比、度量方案提供**同一份事实底座**。它不是需求提案，也不含排期。

**判定口径（三档）**：

| 档位   | 含义                                               | 本文写法                                           |
| ------ | -------------------------------------------------- | -------------------------------------------------- |
| 已实现 | 代码/文档中有可指认的实现，行号可查                | 直接陈述 + `file:line`                             |
| 推断   | 代码未明说，但由已实现的功能、预设、文案可合理反推 | 显式标注「（推断）」并给出推断所依据的 `file:line` |
| 不确定 | 无处可查，或两处证据互相打架                       | 不写结论，进 §11 待确认清单                        |

**代码规模基线（本文实测，2026-09-30）**：`src/` 下 `.ts` 102 个 + `.tsx` 59 个 = **24 909 行**；另 `.html` 4、`.json` 2、`.css` 1，全量合计 28 528 行（含两份 `translation.json` 各 813 行）。与团队口径「24 905 行」差 4 行，见文末「自检记录」。

**已知边界**：

- 本文不描述构建/发布流程的操作步骤（见 `README.md:27-43`、`CODEBUDDY.md:29-37`），只描述它们所约束的产品行为。
- 本文不涉及任何商业化收入的测算；商业模式仅复述 `README.md:159-167` 的承诺文本。
- 「兼容变体（compat）」的构建管道已建成但**尚未交付产品行为**（`README.md:78`、wxt.config.ts:65-91 的变体 hook），本文只记录其存在与降级形态，不描述其最终形态。

---

## 1. 产品定位与产品宪法

### 1.1 一句话定位

> **本地优先、无自有账号、无自有服务器的标签工作台**：把散乱的标签组织成有秩序的空间，并通过撤销、快照与归档降低误操作风险。（`README.md:3`）

补充约束：它**只管理当前窗口的标签页**（`README.md:5`），数据以浏览器本地存储为主，扩展本身不发起任何网络请求（`README.md:5,7`）。

### 1.2 四条不可妥协底线

| #   | 底线                         | 陈述                                                                                                               | 代码 / 文档依据                                                                        |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 1   | **零网络**                   | 不引入任何出站请求（埋点、CDN、上报均禁止）                                                                        | `CODEBUDDY.md:24`；`CONTRIBUTING.md:89-94`（「不会接受的改动」首条）；`PRIVACY.md:100` |
| 2   | **权限冻结**                 | 新增权限必须**同时**改 `wxt.config.ts` 与 `PRIVACY.md`，否则 `check:privacy` 失败；主机权限同样在冻结清单内        | `CONTRIBUTING.md:52-55`；`README.md:126`；`wxt.config.ts:27-41`                        |
| 3   | **本地优先 + 校验唯 schema** | 主存储 `chrome.storage.local`；所有持久化数据经 `core/schema` 的 zod schema 校验，坏数据隔离而非静默丢弃           | `README.md:124,155`；`CODEBUDDY.md:18,26`；`CONTRIBUTING.md:44-50`                     |
| 4   | **永久免费核心**             | 「永久免费核心」是宪法级承诺；组织 / 固定 / 归档 / 快照 / 撤销安全网等核心能力永远免费，扩展本身不发起任何网络请求 | `README.md:159-167`                                                                    |

**第 3 条的历史事故（决定了这条底线的形状）**：`noCachePatterns` 曾只在设置页编辑器归一化，导致一份含 `https://*` 的备份文件就能生成覆盖全部 HTTP(S) 流量的 DNR 规则——因此校验口径被强制上收到 schema 层，「不能只做在 UI 输入处——备份导入会绕过 UI」（`CONTRIBUTING.md:46-50`）。

**第 4 条对商业模式的硬约束**：可持续路径只允许在「开源 + 社区赞助 / 一次性买断 Pro（仅本地高级能力，不破隐私、不联网、不订阅）/ 完全社区驱动」三者中取舍（`README.md:163-165`）。

### 1.3 目标平台与形态矩阵

**平台基线**：`minimum_chrome_version: '114'`（`wxt.config.ts:23`）；`default_locale: 'en'`（`wxt.config.ts:22`）；地址栏关键字 `t`（`wxt.config.ts:24`）；设置页以独立标签打开（`options_ui: { open_in_tab: true }`，`wxt.config.ts:26`）。构建变体：`pnpm build`（标准版，含侧边栏）/ `pnpm build:compat`（兼容版，降级为弹窗形态）（`README.md:35-36`）。

| 形态                 | 入口                                                                           | 定位                | 能力边界（代码事实）                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **侧边栏（主形态）** | `src/entrypoints/sidepanel/`                                                   | 完整工作台          | 搜索、分区列表、固定空间、磁贴、稍后读、其他窗口、快照面板、撤销历史、命令面板、底部工具栏、首启引导（App.tsx:997-1269 全量渲染树）                   |
| **弹窗（降级形态）** | `src/entrypoints/popup/App.tsx`                                                | 快速切换器          | 只做「搜索当前窗口标签并切换」；命中上限 20（`popup/App.tsx:106`）；Esc/↑↓/Enter（166-181）；跨窗口激活（129-136）；无组织/快照/撤销能力              |
| **设置页**           | `src/entrypoints/options/`                                                     | 配置 + 数据生命周期 | 分区设置 + 搜索 + 预设 + 导入导出 + 清除数据（`SettingsPage.tsx`）；导入上限 5 MB（`SettingsPage.tsx:34`）                                            |
| **关于页**           | `src/entrypoints/about/AboutPage.tsx`                                          | 能力总览 + 信任面板 | 12 个能力域（30-145）、入口清单（152-158）、面板内快捷键 7 项（161-169）、浏览器级 4 项（176-181）、隐私徽章（184-189）、12 项权限逐条说明（206-219） |
| **后台 SW**          | `src/entrypoints/background.ts`（484 行）+ `background/`（9 个模块共 1328 行） | 无界面编排          | 右键菜单、地址栏、角标、自动休眠闹钟、自动快照闹钟、关窗缓存、同 URL 唯一化、标签事件转发                                                             |

后台 SW 实际挂载的浏览器事件（逐项 `file:line`）：`tabs.onCreated/onActivated/onUpdated/onRemoved/onAttached/onDetached/onReplaced`（`background.ts:181,187,192,215,220,223,228`）、`windows.onCreated/onRemoved`（245,248）、`runtime.onMessage`（252，且校验 `sender.id !== browser.runtime.id` 即拒绝跨扩展消息，260）、`runtime.onInstalled`（309）、`runtime.onStartup`（313）、`omnibox.setDefaultSuggestion`（442）、`action.setBadgeText`（460）、`alarms.onAlarm`（468）、`sidePanel.setPanelBehavior`（121）。

---

## 2. 目标用户与场景

### 2.1 用户画像（推断）

> **本节全部为推断。** 推断依据不是外部调研，而是产品自己定义的三套设置预设（researcher / saver / efficiency，`settingPresets.tsx:25-55`）与关于页的 12 个能力域（`AboutPage.tsx:30-145`）——它们是团队对用户分层的内部表达。

| 画像（推断）   | 一句话                                      | 推断依据（代码里对应什么）                                                                                                                                     | 主要痛点                 |
| -------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **资料研究员** | 一次开几十个资料页，需要「找得到 + 存得住」 | `presets.researcher`（`settingPresets.tsx:25-55`）；时间线搜索（最近 20 份快照与归档条目，`useSearchController.ts`）；稍后读独立分区（`ReadLaterSection.tsx`） | 标签太多找不到；关窗即失 |
| **内存节省者** | 机器内存吃紧，容忍休眠换流畅                | `presets.saver`，其描述明确指向「自动休眠闲置标签、固定项默认豁免」（`settingPresets.tsx:25-55` 的 saver 段）                                                  | 卡、风扇响；不敢关标签   |
| **键盘效率党** | 不愿碰鼠标，要求全链路可键盘完成            | 面板内快捷键 7 项（`AboutPage.tsx:161-169`）+ 命令面板 ⌘P（`CommandPalette.tsx`）+ 地址栏 `t`（`wxt.config.ts:24`）                                            | 鼠标定位慢               |
| **整理强迫者** | 要按项目/主题成组，并希望结构可持久化       | 固定空间（文件夹 + 常驻磁贴，`FixedArea.tsx` / `PinnedStrip.tsx`）+ 工作空间切换（`useSpaces.ts`）+ 一键清理重复（`FooterToolbar.tsx:123-131`）                | 标签散乱、重复堆积       |

### 2.2 核心用户链路（5 条）

每条链路的每一步都对应真实组件与动作。

**L1 — 键盘找标签并切换**
`⌘K` 聚焦搜索框（`useGlobalHotkeys.ts`）→ 输入（标题 / 网址 / 拼音首字母，`SearchEngine` + pinyin-pro）→ 拼音异步就绪用递增 tick 重算（`useSearchController.ts:168-185`）→ `↑↓` 漫游（`useListNavigation.ts:65` 循环取模；48-52 收缩钳制）→ `Enter` 激活（`useListNavigation.ts:68-75`，索引缺省取 0）→ 命中数经 `<output aria-live="polite">` 播报（`App.tsx:1017-1019`）。

**L2 — 一键清重复并可反悔**
底部工具栏出现「清理重复」徽章（条件 `duplicateCount > 0`，`FooterToolbar.tsx:123-131`；计数与动作共用 `planDuplicateCleanup`，`App.tsx:74-91`）→ 点击后按 `KeeperPolicy.default.select` 选 keeper（激活 > 固定 > index 最小，`DuplicateIndex.ts:69-92`）→ 固定空间绑定标签豁免（`App.tsx:87`）→ 关闭走 `closeWithUndo`（`undoStore.ts:271-329`）→ toast 带「撤销」按钮（`StatusToast.tsx:28-32`）。

**L3 — 把当前现场固化成一个「空间」**
拖标签入固定空间（`FixedArea.tsx:44-47,60-72` 空白处 `useDroppable` 触发建文件夹；`PinnedStrip.tsx:30-33`）→ 或从原生标签组一键建文件夹（`App.tsx:105`）→ 需要专注时 `saveAsSpace` 把现场存为 `origin='space'` 快照（`useSpaces.ts:131-147`）→ 之后用 `SpaceStrip` chip 切换（`SpaceStrip.tsx:40-51`）。

**L4 — 关窗前留档，回头精确恢复**
命名保存 / 归档当前窗口（`SnapshotsPanel.tsx:139-162` 生命周期分组 named/archive/auto）→ 恢复前先出 diff 预览，三分类 create / existing / skipped（`snapshotDiff.ts:18,49-84`）→ 可勾选部分条目做选择性恢复（`SnapshotsPanel.tsx:109-129`，键为 `${index}-${tab.url}`）→ 恢复是「仅新建缺失标签并还原固定/静音/分组」（`README.md:71`）。

**L5 — 换机迁移 / 备份**
设置页导出 JSON（`format` 固定 `tabs.export`，`models.ts:348`；`PRIVACY.md:79`）→ 新设备导入：先本地校验格式，任一分区写入失败**整体回滚**（`PRIVACY.md:80`）；或开启「跨设备同步」走浏览器账号通道镜像（默认关闭，`models.ts:220`；`PRIVACY.md:69`）。

### 2.3 场景—能力映射表

| 场景               | 触发入口                                           | 使用能力                                                                                  | 兜底 / 反馈                                                                                                              |
| ------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 标签太多找不到     | ⌘K / 地址栏 `t` / 弹窗                             | 模糊搜索（标题·URL·拼音）、命令面板、时间线搜索                                           | 搜索无结果有专门空态 `NoSearchResults`（`ListStates.tsx`；`App.tsx:1131`）                                               |
| 误关了标签         | ⌘Z / 底部「历史」                                  | 撤销栈（默认深 10）、撤销历史面板 + 浏览器最近关闭（`sessions`）                          | 恢复失败条目回填栈顶可重试（`undoStore.ts:164-217`）；崩溃场景有专门引导（`UndoHistoryPanel.tsx:106-119`）               |
| 内存告急           | 底部「休眠非激活」/ 快捷键 Ctrl+Shift+U / 自动闹钟 | 手动 / 批量 / 自动休眠 + 白名单                                                           | 自动休眠写台账（可撤销）；台账落盘失败则**不发**带 tabIds 的可撤销消息，避免「全部唤醒」点不动（`autoDiscard.ts:21-27`） |
| 重复标签堆积       | 底部徽章 / 习惯洞察直达                            | 重复索引 + KeeperPolicy + 一键清理                                                        | 可撤销；固定项与固定空间内条目豁免                                                                                       |
| 要按项目分组       | 拖拽 / 右键菜单 / 命令面板                         | 固定文件夹、常驻磁贴、工作空间、原生标签组同步                                            | 同名 URL 自动去重；导出到书签 / 从书签栏导入（`bookmarks` 权限，`PRIVACY.md:33`）                                        |
| 浏览器重启 / 崩溃  | 冷启动                                             | 自动快照（滚动保留 10）、关窗自动快照                                                     | 撤销历史面板内嵌「崩溃引导」（`UndoHistoryPanel.tsx:106-119`）                                                           |
| 想看自己的使用习惯 | 快照面板周报                                       | 习惯洞察三类：重复重灾区 Top5 / 休眠候选 / 7 天滞留 Top5（`tabInsights.ts:19-26,91-153`） | 纯本地计算零上报（`README.md:72`）                                                                                       |
| 开发调试要禁缓存   | 设置页「禁用缓存」开关                             | declarativeNetRequest 改 `Cache-Control` 等头为 no-store                                  | 需按需请求 `<all_urls>`，拒绝则功能保持关闭（`PRIVACY.md:36`；`settingControls.tsx:245-317`）                            |

---

## 3. 信息架构

### 3.1 全局 IA 图（文字树）

```
浏览器（Chrome / Edge MV3）
├── 侧边栏面板 sidepanel【主形态】
│   ├── 顶部常驻：搜索框（⌘K）+ 命中数 sr-only 播报
│   ├── 状态横幅：存储降级告警 / 一次性能力发现 Tip
│   ├── 工作空间切换条 SpaceStrip
│   ├── 常驻磁贴条 PinnedStrip（固定空间内的持久化入口）
│   ├── 浏览器原生固定标签区（受 showPinnedStrip 联动）
│   ├── 固定空间 FixedArea（文件夹 CRUD / 拖放 / 挂起转正）
│   ├── 滚动主体
│   │   ├── 稍后读分区 ReadLaterSection
│   │   ├── 标签分区列表 SectionList（固定 → 原生组 → 站点聚合 → 未分组）
│   │   └── 其他窗口分段 OtherWindowsSection
│   ├── 时间线命中区 HistoryHitsSection（仅过滤态）
│   ├── 新建标签条
│   ├── 底部工具栏 FooterToolbar（视图组织 / 内存管理 / 记录恢复 / 设置）
│   └── 浮层：撤销历史 / 快照面板 / 恢复确认 / 首启引导 / 命令面板
├── 弹窗 popup【降级形态】——仅搜索 + 切换
├── 设置页 options（open_in_tab）
│   ├── 目录大纲 + 搜索 + 预设
│   ├── 分区：外观 / 行为 / 内存 / 分组搜索 / 高级
│   └── 数据：导入 / 导出 / 诊断导出 / 恢复默认 / 清除数据
├── 关于页 about——能力总览 + 信任面板 + 快捷键帮助
└── 后台 SW background
    ├── 右键菜单（页面 / 链接 / 标签栏 / 工具栏图标）
    ├── 地址栏 omnibox（关键字 t）
    ├── 工具栏角标 badge
    ├── 闹钟：自动休眠 / 自动快照
    └── 关窗缓存 + 同 URL 唯一化
```

### 3.2 侧边栏首屏垂直模块顺序（按 `App.tsx:997-1269` 实际渲染顺序）

| #   | 模块                                                                         | 行号      | 出现条件（代码事实）                                                                                                              |
| --- | ---------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `<main class="app flex h-full flex-col">` 容器                               | 998       | 常驻                                                                                                                              |
| 2   | `<h1 class="sr-only">` 面板标题                                              | 1002      | 常驻；视觉隐藏，仅给读屏提供标题层级（注释 999-1001 明说是补此前「标题层级断裂」）                                                |
| 3   | `DndRoot`（dnd-kit 根）                                                      | 1003      | 常驻，包裹全部内容                                                                                                                |
| 4   | `SettingsSync`                                                               | 1004      | 常驻（无渲染输出，负责设置跨页同步）                                                                                              |
| 5   | `SearchBar`                                                                  | 1005-1015 | 常驻；`showKeyboardHint` 需有可选项（过滤态看命中数，否则看标签数，1011）；历史开关常显                                           |
| 6   | `<output aria-live="polite">` 命中数播报                                     | 1017-1019 | 视觉隐藏；仅过滤态有文本                                                                                                          |
| 7   | 存储降级横幅 `role="alert"`                                                  | 1023-1033 | `storageDegraded === true`（表示「此刻存储可能不可写」，注释 1020-1022）                                                          |
| 8   | 一次性「能力发现」Tip                                                        | 1036-1053 | `!settings.tipSeen`；刻意排在搜索框之后（注释 1034-1035）                                                                         |
| 9   | `SpaceStrip` 工作空间条                                                      | 1055-1062 | 组件内 `spaces.length === 0` 时整条隐藏（`SpaceStrip.tsx:32`）；有激活空间时首项是「全部标签」出口（40-51）                       |
| 10  | `PinnedStrip` 常驻磁贴条                                                     | 1063      | `settings.showPinnedStrip`；组件内 `pins.length === 0` 时 `return null`（`PinnedStrip.tsx:43`）                                   |
| 11  | 浏览器原生固定标签区（`CategoryModule` + `SortableContext` + `pinned-grid`） | 1067-1099 | `settings.showPinnedStrip && pinnedSection`；与磁贴条联动隐藏（注释 1064-1066）                                                   |
| 12  | `FixedArea` 固定空间                                                         | 1100-1102 | 常驻（内部自管空态与折叠）                                                                                                        |
| 13  | `StatusToast`                                                                | 1103      | 常驻（无消息时不渲染内容）                                                                                                        |
| 14  | 滚动主体 `div.flex-1.overflow-y-auto`                                        | 1104-1164 | 常驻；`onWheel/onTouchMove` 标记用户滚动（1106-1107）                                                                             |
| 14a | ↳ `ReadLaterSection` 稍后读                                                  | 1111-1119 | `dataReady && !isFiltering`；组件内 `items.length === 0` 时 `return null`（`ReadLaterSection.tsx:59`）                            |
| 14b | ↳ 三态之一：`LoadErrorState`                                                 | 1123      | `!dataReady && loadFailed`（自动重试仍失败，给手动出口）                                                                          |
| 14c | ↳ 三态之一：`LoadingSkeleton`                                                | 1126      | `!dataReady && !loadFailed`                                                                                                       |
| 14d | ↳ `EmptyTabs`                                                                | 1129      | `dataReady && tabs.length === 0`                                                                                                  |
| 14e | ↳ `NoSearchResults`                                                          | 1131      | `isFiltering && filteredTabs.length === 0`                                                                                        |
| 14f | ↳ `SectionList` 分区列表                                                     | 1134-1152 | 其余情况；`reorderEnabled` 受 `settings.tabOrderSync` 控制（1141）                                                                |
| 14g | ↳ `OtherWindowsSection`                                                      | 1157-1163 | `!isFiltering && settings.showOtherWindows`                                                                                       |
| 15  | `HistoryHitsSection` 时间线命中                                              | 1168-1174 | `isFiltering && settings.searchHistory && historyHits.length > 0`；刻意放在列表之后（注释 1166-1167）                             |
| 16  | 新建标签条 `add-tab-bar`                                                     | 1176-1181 | 常驻                                                                                                                              |
| 17  | `FooterToolbar` 底部工具栏                                                   | 1183-1206 | 常驻                                                                                                                              |
| 18  | `UndoHistoryPanel`                                                           | 1207-1216 | `showHistory === true`                                                                                                            |
| 19  | `RestoreConfirmDialog`                                                       | 1217-1231 | `pendingHistoryRestore !== null`（时间线恢复闸门）                                                                                |
| 20  | `SnapshotsPanel`                                                             | 1232-1245 | `showSnapshots === true`                                                                                                          |
| 21  | `OnboardingTour` 首启引导                                                    | 1246-1257 | `!settings.onboarded && dataReady && showTour`；完成时一并写回 `onboarded/tipSeen/conceptsSeen`（1253），避免「关完一层还有一层」 |
| 22  | `CommandPalette` 命令面板                                                    | 1258-1265 | `showPalette === true`                                                                                                            |

**排序设计意图（代码注释里写明的）**：① 教学性内容不得把搜索框挤出首屏顶部（1034-1035）；② 稍后读与「当前有几个标签」正交，且位置在主体列表之前——「先把存的看了」（1109-1110）；③ 历史是回溯补充，刻意放列表之后（1166-1167）；④ 其他窗口在主体列表之下、新增标签条之上（1155-1156）。

### 3.3 设置页 IA

- **分区（`buildSections` 五组）**：外观 / 行为 / 内存 / 分组搜索 / 高级（`settingSections.tsx:180-618`）。
- **暴露的设置项**：`settingSections.tsx` 声明布尔设置键白名单（26-47），另 `syncMirrorEnabled` 的开关直接编排在 `SettingsPage.tsx:364-370`（不在分区声明里）。
- **搜索**：`settingsSearch` 过滤（`SettingsPage.tsx:216-233`）+ 目录锚点 `outlineItems`（236-249）。
- **预设**：researcher / saver / efficiency 三套（`settingPresets.tsx:25-55`），并配 `CAPABILITIES` 能力发现 + `replayTour` 重播引导（162-217）。
- **数据生命周期**：导入（上限 `MAX_IMPORT_BYTES = 5 MB`，`SettingsPage.tsx:34`）/ 导出 / 诊断导出 / 恢复默认 / 清除数据（`ClearDataDialog.tsx`）。
- **快捷键说明区**：`ShortcutsSection.tsx` 按平台渲染修饰键（Mac 显示 `⌃⇧`，其余显示 `Ctrl+Shift`，`ShortcutsSection.tsx:10,29`），浏览器级 4 项 + 面板内 ⌘K/⌘P/⌘J 三项 + 「去浏览器设置里自定义」跳转按钮。

---

## 4. 功能规格

### 4.1 标签视图

**能力定义**：把当前窗口标签按「来源」切成若干临时分区展示，支持折叠、计数、状态徽章、密度与网址显示等呈现开关。

**触发入口**：侧边栏打开即呈现（`App.tsx:1134`）。

**关键规则与阈值**：

- 分区派生顺序为 **固定标签区 → 原生组 → 网站聚合组（含同站点归并）→ 未分组**（`core/site/Sections.ts:355-492`）。
- 聚合模式 `groupMode = site / opener / language`（`Sections.ts:458-476`；opener 树构建在 102-145）。
- 仅 `native` / `site` 两类分区参与 dnd 排序（`SectionList.tsx:105-108`）。
- 渲染开关全部来自设置：`reorderEnabled`（`tabOrderSync`）、`showUrl`、`autoScrollActive`、`closeOnMiddleClick`、`density`、`rowActionsVisible`、`showSplitBadges`（`App.tsx:1141-1147`）。
- 自动滚入可视区在用户手动滚动后让位（`autoScrollActive && !userScrollActive`，`App.tsx:1143`）。

**反馈机制**：分区折叠记忆（`collapsedSites`，上限 2000，`models.ts:34`）；「全部折叠/展开」由 `handleToggleAllSections` 统一切换（`useSectionDerivation.ts:135-144`）；过滤态强制展开折叠，用模块级空常量避免无谓重算（111-120）。

**已知限制（代码证实）**：

- 只管理**当前窗口**标签（`README.md:5`）；其他窗口只能查看/聚焦/关闭（`OtherWindowsSection.tsx`，`App.tsx:1157-1163`）。
- 其他窗口排除隐身窗口（`useOtherWindows.ts:63`），刷新有 500 ms 节流（40-48），有激活标签的窗口排前（76）。

### 4.2 组织与固定空间

**能力定义**：持久化两类资产——**固定文件夹**（条目可包含 URL 或原生组）与**常驻磁贴**（identity 归一化的快捷入口）。

**触发入口**：拖拽到 `FixedArea` / `PinnedStrip`；右键菜单「加入文件夹」（`contextMenus.ts:89-99` 页面、110-120 链接）；原生组「保存为固定文件夹」（`App.tsx:105`）；从书签栏导入 / 导出到书签（`bookmarks` 权限，`PRIVACY.md:33`）。

**关键规则与阈值**：

- 单文件夹条目上限 500、文件夹数上限 200、磁贴上限 200（`models.ts:28,30,32`）。
- 磁贴身份归一化 + 中键只关页面、入口保留（`PinnedStrip.tsx:17-22`；`makePinMiddleClickHandler`，45）。
- **挂起转正**：文件夹条目可处于「挂起」态（待导航），标签事件后由 `reconcilePendingItems` 转正（`folderSlice.ts:358-362`）；条目↔标签的绑定存于 session（`itemTabBindings`），绑定维护见 `folderSlice.ts:364-374`。
- 固定空间默认折叠条件 `folders.length > 5`（`FixedArea.tsx:37`）；空白拖入触发新建文件夹 `PromptDialog`（135-150）；空态在 `!settings.conceptsSeen` 时展示概念地图（109-125）。
- 绑定的标签在三处被豁免：重复清理（`App.tsx:87`）、自动休眠（`autoDiscard.ts:63,114`）、休眠候选洞察（`tabInsights.ts:124`）。

**反馈机制**：落盘失败按分区记账并上抛为「存储降级」横幅（`folderSlice.ts:375-384`；`App.tsx:1023-1033`）——注释明确「一次成功的绑定写不能把其它分区的告警连坐抹掉」。

**已知限制**：会话绑定若未能持久化，面板重启后挂起条目绑定会丢失（`folderSlice.ts:380` 的降级文案原文）。

### 4.3 搜索与时间线

**能力定义**：`SearchEngine`（fuzzysort + pinyin-pro）对标题 / 网址 / 拼音首字母做模糊匹配，并可选把检索范围扩展到「最近快照与归档条目」。

**触发入口**：⌘K 聚焦（`useGlobalHotkeys.ts`）；地址栏 `t`（`wxt.config.ts:24`）；弹窗（`popup/App.tsx`）；命令面板 ⌘P（`CommandPalette.tsx`）。

**关键规则与阈值**：

- 拼音词典异步就绪后用**递增 tick 触发重算**（`useSearchController.ts:168-185`）。
- 时间线搜索命中上限为最近 20 份快照（`HISTORY_SNAPSHOT_LIMIT`），合成负 id 与当前标签区分（`useSearchController.ts`）。
- 命令面板空查询时最多列 20 个标签（`CommandPalette.tsx:53`）；扁平漫游顺序为 folder → command → recent → tab（372）。
- 弹窗命中上限 20（`popup/App.tsx:106`）。
- **性能基线（测试即规格）**：150 标签单次查询中位数 < 100 ms；150 标签索引构建 < 1000 ms；500 标签单次查询中位数 < 300 ms（`tests/perf/search-perf.test.ts:81-109`；其中 81-92 为 150 标签查询、94-101 为索引构建、103-109 为 500 标签）。测试内还加了「查询确实命中」的附加断言，防止「快是因为啥都没做」的假通过（88-90）。

**反馈机制**：命中数 `sr-only` `<output aria-live="polite">`（`App.tsx:1017-1019`）；`NoSearchResults` 空态带「清空」出口（`App.tsx:1131`）；弹窗同样有 `sr-only` output（`popup/App.tsx:210-212`）。

**已知限制**：时间线命中区只在过滤态且开关打开时展示（`App.tsx:1168`）。

### 4.4 拖拽整理

**能力定义**：dnd-kit 驱动的标签 / 常驻磁贴 / 分组头 / 文件夹条目排序，跨容器投放由全局 `onDragEnd` 分派。

**证据**：`DndRoot`（`App.tsx:1003`）、`SortableContext` + `rectSortingStrategy`（磁贴，`App.tsx:1074`；`PinnedStrip.tsx:49`）、`verticalListSortingStrategy`（分区列表）、`useDroppable`（固定空间空白建文件夹 `FixedArea.tsx:44-47`；磁贴条 `PinnedStrip.tsx:30-33`）、`useSortable`（`TabRow.tsx:11`）、拖拽处理器 `useTabDragHandlers`（`App.tsx:64`）。

**关键规则**：`SortableContext items` 必须 memo，内联新数组会让 context value 每轮变更、导致全部子项强制重渲染（`PinnedStrip.tsx:38-41` 注释原文）。

**反馈机制**：拖入目标区高亮 `is-drop-target`（`PinnedStrip.tsx:52`）；拖入固定空间时重复 URL 自动去重（`README.md:67`）。

**已知限制**：只有 `native` / `site` 分区可排序（`SectionList.tsx:105-108`）；Partition（分屏伙伴）行被拆出单独处理（`splitPartnerIds`，`SectionList.tsx:166-178`）。

### 4.5 快捷入口

| 入口                                          | 实现                                                                                                                                                                                                                                                             | 证据                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 右键菜单（页面 / 链接 / 标签栏 / 工具栏图标） | 12 个菜单 id：`th:page:discard` / `page:pin` / `page:search-site` / `page:folder-parent` / `link:folder-parent` / `page:read-later` / `tab:discard` / `tab:search-site` / `tab:read-later` / `action:open-panel` / `action:discard-inactive` / `action:settings` | `contextMenus.ts:14-27`；创建 73-132                                       |
| 地址栏                                        | 关键字 `t`，`omnibox.setDefaultSuggestion`                                                                                                                                                                                                                       | `wxt.config.ts:24`；`background.ts:442`；`background/omnibox.ts`（150 行） |
| 工具栏角标                                    | 三种模式：标签数 / 重复组数 / 休眠数；成功反馈 `✓` + 绿色 `#16a34a`                                                                                                                                                                                              | `background.ts:460-461`；`README.md:68`；`background/badge.ts`（75 行）    |
| 浏览器级快捷键                                | 4 个：`focus-search`(Ctrl+Shift+F) / `open-panel`(Ctrl+Shift+O) / `locate-active`(Ctrl+Shift+L) / `discard-inactive`(Ctrl+Shift+U)                                                                                                                               | `wxt.config.ts:42-59`；`PRIVACY.md:40`（说明快捷键不是权限）               |
| 面板内快捷键                                  | 7 项：⌘K 搜索 / ⌘P 命令面板 / ⌘J 定位激活 / ⌘Z 撤销 / ↑↓+Enter 漫游 / Alt+↑↓ 重排 / Space 拖拽                                                                                                                                                                   | `AboutPage.tsx:161-169`                                                    |

**关键规则**：菜单写操作走串行队列 `menuWriteChain`，因为 `rebuild/removeAll` 可由 folders watch、settings watch、`setupMenus` 并发触发，交错会产生重复 id 的 rejection（`contextMenus.ts:45-58`）。SW 上下文的失败走诊断管道而非 `console.warn`（54-56）。

### 4.6 重复治理

**能力定义**：按 URL 归一化分组，每组保留一个 keeper，其余可一键关闭，可撤销。

**关键规则**：

- 分组键为 `webComparisonKey`（`DuplicateIndex.ts:26-36`）。
- `KeeperPolicy`（69-92）保留优先级：**激活 > 固定 > index 最小**；固定标签豁免（`pinnedExempt` 默认 true）。
- 徽章计数与实际清理动作**共用同一份计算** `planDuplicateCleanup`（`App.tsx:74-91`），避免「徽章显示 3 个，点下去说没有」。
- 固定空间绑定的标签额外豁免（`App.tsx:87`）。
- 阈值：重复组判定阈值 2（`tabInsights.ts:19`）；关闭走撤销（`undoStore.ts:271-329`）。

**反馈机制**：底部徽章（`FooterToolbar.tsx:123-131`）；清理后对保留项做脉冲高亮，让「保留了谁」可见（`App.tsx:70-71` 注释）；toast 可撤销。

### 4.7 撤销安全网

**能力定义**：操作记录制（非状态快照）的多层撤销栈。

**关键规则**：

- 结构：`toUndoTabRecord`（`UndoStack.ts:17-29`）、`pushBatch`（FIFO 淘汰，32-40）、`popBatch`（43-46）、`createUndoBatch`（63-75）。
- 栈深默认 10，可调 5 / 10 / 20 / 50（`models.ts:42,137`）；单批次条目上限 1000（`models.ts:40`）。
- **恢复成功才出栈**；失败项 `retryBatch` 回填栈顶可重试（`undoStore.ts:164-217`）。
- 跨页锁：`UNDO_EXEC_LOCK`（`undoStore.ts:92`）/ `UNDO_PERSIST_LOCK`；`persistUndo` 控制是否跨重启持久化。
- 跨页消息去重双通道 `handledAtsRef`，Set 上限 32（`usePendingActions.ts:59-62`）；消息类型 6 种：focus-search / search-domain / locate-active / auto-discarded / duplicate-reused / settings-synced（83-108）。
- toast 时长来自 `settings.toastDurationSec`（`undoStore.ts:145-152`）。

**覆盖范围**：**经本产品执行的关闭路径可撤销**（`README.md:70`）——`closeWithUndo`（`undoStore.ts:271-329`）、`recordClosedBatch`（归档进撤销栈，411-419）、自动休眠批次（`autoDiscard.ts:13-28`，带台账）。

**不覆盖范围**：

- 用户直接在浏览器里关闭的标签不走撤销栈，改由撤销历史面板里的「浏览器最近关闭」（`sessions` 权限）承接（`UndoHistoryPanel.tsx`；`PRIVACY.md:32`）。
- 自动休眠台账**落盘失败时**不发带 `tabIds` 的「可撤销」消息——否则「全部唤醒」会点不动（`autoDiscard.ts:21-27`）。

**反馈机制**：toast 带撤销按钮（`StatusToast.tsx:28-32`）；底部「历史」徽章显示可撤销批次数（`FooterToolbar.tsx` `undoBatchCount`）；崩溃场景引导（`UndoHistoryPanel.tsx:106-119`）。

### 4.8 快照与归档

**能力定义**：把现场（当前窗口标签集合）保存为可回放的快照。

**关键规则与阈值**：

- `Snapshot.origin` 四值：`manual / auto / archive / space`（`useSpaces.ts` 的 `origin='space'` 即工作空间；Workona 导入归为 `archive`，`workonaImport.ts`）。
- 上限：单快照 1000 个标签（`models.ts:44`）、快照族 200（`models.ts:46`）、自动快照滚动保留默认 10（可调 1-50，`models.ts:149`）、命名快照上限默认 30（可调 1-100，`models.ts:151`）。
- 自动快照开关 `autoSaveSnapshots`（`models.ts:145`），间隔默认 30 分钟（可调 5-720，`models.ts:147`），闹钟 `tabs-auto-snapshot` 用 `delayInMinutes`（`autoSnapshot.ts:20,120-127`）。
- 恢复语义：**仅新建缺失标签**并还原固定/静音/分组（`README.md:71`）。
- 恢复前 diff 三分类 `create / existing / skipped`（`snapshotDiff.ts:18,49-84`），支持 `buildPartialSnapshot` 选择性恢复（92-101）。
- 关窗自动快照：默认开启，滚动保留（`README.md:71`）；关窗时 `markSkipAutoSave` 可跳过（`windowCache.ts`）。

**触发入口**：快照面板三视图 list / import / report（`SnapshotsPanel.tsx:54`）；底部工具栏「快照」按钮（`App.tsx:1202`）；命令面板；生命周期分组 named / archive / auto（139-162）。

**反馈机制**：恢复前 `RestoreConfirmDialog` 闸门（`CommandPalette.tsx:570-590`；`App.tsx:1217-1231`）；删除需二次确认（`SnapshotsPanel.tsx:61,323-327`）；恢复/归档结果 toast 计数（`App.tsx:1226,1241`）。

**已知限制**：导入 Workona JSON 有 1 MB 上限、仅 http(s)、`resources` 并入、按 `SNAPSHOT_TABS_LIMIT` 截断（`workonaImport.ts:66,103-159`）。

### 4.9 工作空间

**能力定义**：把一个标签集合存为 `origin='space'` 的快照，并可在「空间」之间切换现场。

**切换流程（四步，`useSpaces.ts:53-104`）**：

1. **写回现场**：把当前窗口状态写回当前空间；
2. **关闭**：过滤 `!tab.pinned && !tab.incognito && /^https?:\/\//i` 后 `closeWithUndo`（81-89）——固定、隐身、非 http(s) 标签不动；
3. **恢复**：显式指定同一 `windowId` 恢复目标空间（90-91）；
4. **落标**：写入 `activeSpaceId`（`models.ts:225`）。

**其他动作**：`exitSpace`（109-129）、`saveAsSpace`（131-147）。

**反馈机制**：切换中 chip 禁用并置 `aria-busy`（`SpaceStrip.tsx:38`）；有激活空间时首项提供「全部标签」出口（40-51）。

**已知限制**：切换会真实关闭标签（走撤销栈），不是隐藏；隐身与非 http(s) 标签不在切换范围内（`useSpaces.ts:81-89`）。

### 4.10 稍后读

**能力定义**：独立于当前标签集合的阅读队列分区。

**关键规则**：上限 200（`models.ts:48`）；7 天未读判过期（`READLATER_STALE_MS = 7×24×60×60×1000`，`staleness.ts:6`；判定 12-15）；超限按 `addedAt` 升序淘汰**最旧**、保留最新（`trim.ts:10-17`）。

**触发入口**：右键菜单「加入稍后读」（`contextMenus.ts:103-106` 页面、`tabReadLater` 标签）；面板内分区操作。

**反馈机制**：未读数与过期项在分区内可见（35-39）；提供一键归档过期项入口 `onArchiveStale`（78-89）；点击条目走「新建标签改 URL + 标记已读」（41-57）。

**已知限制**：空列表整区不渲染（`ReadLaterSection.tsx:59`）；过滤态不展示（`App.tsx:1111`）。

### 4.11 习惯洞察

**能力定义**：纯本地计算、零上报的三类使用洞察，内嵌在快照周报里。

**关键规则**（`tabInsights.ts`）：

- 重复重灾区：按站点聚合、www 归一化、阈值 2、**Top 5**（`DUPLICATE_THRESHOLD=19`，`INSIGHT_TOP_N=26`）；
- 休眠候选：`canSafelyDiscardTab` 且**排除绑定**标签（`tabInsights.ts:124`）；
- 7 天滞留预警：`STALE_TAB_DAYS=7` / `STALE_TAB_MS`（22-23），排除 pinned / 活跃 / 已休眠 / 绑定（135），Top 5（26）。
- 计算入口 `computeInsights`（91-153）。

**反馈机制**：周报内嵌（`SnapshotsPanel.tsx:329-341,446-516`）；三类洞察一键直达既有动作（清理重复 / 一键休眠 / 归档窗口，`README.md:72`）。

### 4.12 休眠与资源

**能力定义**：手动 / 批量 / 自动把标签交还给浏览器（discard）以释放内存，并保留一键唤醒。

**关键规则**：

- 安全判定统一走 `canSafelyDiscardTab`（`core/tab-types.ts`），自动休眠、快捷键休眠、洞察候选共用同一安全集（`autoDiscard.ts:65,118`；`tabInsights.ts:124`）。
- 固定空间绑定的标签**永不休眠**（`autoDiscard.ts:63,114` 注释原文）。
- 自动休眠：开关 `autoDiscardEnabled`；阈值 `autoDiscardMinutes` 默认 30 分钟（可调 5-240，`models.ts:129`）；闹钟 `tabs-auto-discard` `periodInMinutes: 1`（`autoDiscard.ts:96`，关闭即清除，避免每分钟空跑唤醒 SW，91-99）。
- 白名单上限 500（`models.ts:36`），归一化匹配器只构建一次（`autoDiscard.ts:56`）。
- 有限并发执行，避免数百次串行 IPC 把 SW 占满（`autoDiscard.ts:74-81`）。

**反馈机制**：台账 `autoDiscardRepository` + 可选本机通知（`autoDiscard.ts:16-20`）；底部「唤醒全部」在 `discardedCount > 0` 时出现（`FooterToolbar.tsx:151-158`）。

### 4.13 数据导入导出与同步镜像

**备份格式**：

- `format` 固定为 `'tabs.export'`；`EXPORT_FILE_VERSION = 2`（`models.ts:348`）；schema 用 `z.literal(EXPORT_FILE_VERSION)` 校验（`models.ts:360-372`），**版本不同即拒绝导入，不做跨版本兼容**（`CONTRIBUTING.md:68-70`；`parseExportFile` 区分 `version-mismatch` / `invalid`，`models.ts:384-395`）。
- 导入是**事务**：任一分区写入失败整体回滚并提示，不留半套数据（`PRIVACY.md:80`）；导入期间挂起 watcher 回写与落盘（`context.ts:102,140`；`transferSlice.ts:74`）。
- 导入不自动打开、关闭或修改当前标签（`PRIVACY.md:80`）。
- 导出内容包含：文件夹、常驻磁贴、折叠状态、设置、全部快照与归档；**不含**当前打开的标签与撤销栈（`PRIVACY.md:79`）。

**同步镜像（`SyncMirror`）**：

- 键前缀 `tabs.sync.v1.`（`SyncMirror.ts:17`）；分块 6000 字节（21）；TTL 30 天（22）。
- 默认**关闭**（`syncMirrorEnabled: false`，`models.ts:220`；开关在 `SettingsPage.tsx:364-370`）；关闭即 `clearAll` 删除已上传镜像块（`SyncMirror.ts:185-193`；`PRIVACY.md:73`）。
- 范围：**文件夹、常驻磁贴与设置**（`MirrorPayloadSchema = { at, folders, pins, settings }`，`SyncMirror.ts:25-30`）；撤销栈、休眠台账、折叠状态、当前打开标签不参与（`PRIVACY.md:70`）。
- 降级：超出浏览器同步配额时镜像静默失效，不影响本地数据（`PRIVACY.md:72`）。
- 工程：写操作走串行链（119-123），失败指数退避重试，上限 5 次（`MAX_RETRY_ATTEMPTS=5`，46；退避 `30_000 * 2**(n-1)`，111）。
- 首次启动：新设备且已开启同步、本机无本地数据时自动恢复镜像；此后以本机为准（`PRIVACY.md:71`）。

### 4.14 外观与可达性

- 主题三态：跟随系统 / 亮 / 暗（`README.md:75`）；中英双语（`README.md:75`；i18n 744 键零漂移，见 §8.1）。
- 列表密度三档：compact / cozy / large（`TabRow.tsx:74`）。
- 底部工具栏文字模式开关 `footerLabels`（`FooterToolbar.tsx:78-191`；`App.tsx:1185`）。
- 可达性基线与门禁见 §8。

---

## 5. 关键交互与状态机

### 5.1 列表三态（加载 / 空 / 错误 / 搜索无结果）

判定顺序即 `App.tsx:1120-1154` 的三元表达式，**优先级从上到下**：

| 状态       | 组件              | 条件                                       | 出口                                                                                        |
| ---------- | ----------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 加载中     | `LoadingSkeleton` | `!dataReady && !loadFailed`                | 无（自动重试中）                                                                            |
| 加载失败   | `LoadErrorState`  | `!dataReady && loadFailed`                 | 「重试」按钮 `handleRetryLoad`（注释 1122：自动重试仍失败则给手动出口，不留无出口的骨架屏） |
| 空标签     | `EmptyTabs`       | `dataReady && tabs.length === 0`           | 无（纯说明）                                                                                |
| 搜索无结果 | `NoSearchResults` | `isFiltering && filteredTabs.length === 0` | 「清空搜索」`onClear`                                                                       |
| 正常       | `SectionList`     | 其余                                       | —                                                                                           |

组件实现见 `ListStates.tsx:13-92`（四个状态组件）。加载态刻意区分「同步中」与「真的没有标签」（`App.tsx:1125` 注释）。

### 5.2 撤销与恢复的状态流转

```
[用户动作：关闭 / 归档 / 自动休眠]
        │
        ├─ 走 closeWithUndo（undoStore.ts:271-329）/ recordClosedBatch（411-419）
        │
        ▼
  pushBatch 入栈（UndoStack.ts:32-40，FIFO，栈深默认 10）
        │
        ▼
  toast 提示 + 可撤销按钮（StatusToast.tsx:28-32）
        │
        ├── 用户点撤销 ──► runUndo（undoStore.ts:164-217）
        │                    ├─ 恢复成功 → popBatch 出栈（UndoStack.ts:43-46）
        │                    └─ 恢复失败 → 失败项 retryBatch 回填栈顶（可重试）
        │
        ├── 用户打开「历史」面板 ──► 任意批次恢复 + 浏览器最近关闭（sessions）
        │
        └── 超时 / 新批次挤占 ──► FIFO 淘汰（栈深上限）
```

**覆盖范围**：经本产品执行的关闭路径（`README.md:70`）；自动休眠批次（带台账，`autoDiscard.ts:13-28`）。
**不覆盖范围**：用户直接在浏览器关闭（走 `sessions` 最近关闭）；台账落盘失败的自动休眠批次（不发可撤销消息，`autoDiscard.ts:21-27`）。
**跨页一致性**：执行锁 `UNDO_EXEC_LOCK`、持久化锁 `UNDO_PERSIST_LOCK`（`undoStore.ts:92`）；消息双通道去重 Set 上限 32（`usePendingActions.ts:59-62`）。

### 5.3 工作空间切换流程

见 §4.9 的四步（写回 → 关闭 → 恢复 → 落标）。补充状态细节：

- 绑定维护在每次标签事件后重跑 `reconcileWithTabs`，且**必须 `ready` 之后**才允许执行——否则首帧会把磁盘上全部绑定判定为「条目已不存在」并整表写空（`folderSlice.ts:352-357` 注释原文，属确定性数据丢失）。
- 绑定写失败按分区记账，不复位全局 `storageDegraded`（`folderSlice.ts:375-384`）。

### 5.4 焦点与键盘模型

**面板内**：

- `⌘P / ⌘J / ⌘K / ⌘Z`（`useGlobalHotkeys.ts`）。
- 模态打开时 `isModalOpen()` **短路**全局热键（`useGlobalHotkeys.ts:40`）。
- `⌘⇧Z` 不判撤销（55-56）；在输入框 / 可编辑区内 `⌘Z` **让位给原生文本撤销**（57-62）。
- `↑↓` 漫游：索引初值 `null`（`useListNavigation.ts:39`）、循环取模（65）、列表收缩时钳制（48-52）、`Enter` 取 `index ?? 0`（68-75）。
- `Alt+↑↓` 键盘重排：`onMoveTab(tabId, ±1)`（`TabRow.tsx:66`），受 `reorderEnabled` 控制。
- `Esc`：搜索框内清空（`SearchBar.tsx:52-55`）；搜索控制器里 Esc 清空并失焦（`useSearchController.ts:222-228`）。
- `Space` 起拖（dnd-kit，`AboutPage.tsx:161-169`）。

**浏览器级**：4 个 `commands`（`wxt.config.ts:42-59`），可在浏览器快捷键设置页自定义（`ShortcutsSection.tsx:41-46`）。

**弹窗 / 模态焦点模型**：

- 自制弹窗族统一用 `useModalA11y`：焦点陷阱 + Esc + 关闭后焦点恢复 + 滚动锁定（`Dialog.tsx:48-139`；可聚焦选择器常量 21-22）。
- 模态栈 `modalStack` / `isModalOpen`（`Dialog.tsx:30-40`）——供全局热键判断是否有模态遮挡。
- 首启引导用原生 `<dialog>` + `showModal()`，同样挂 `useModalA11y`，且**不加遮罩点击关闭**（避免误点直接写回 `onboarded`）（`OnboardingTour.tsx:30-42`）。
- 命令面板：ARIA combobox + listbox + `aria-activedescendant` 钳制（`CommandPalette.tsx:443-459`）；点遮罩关闭（434-436）。

---

## 6. 数据设计

### 6.1 存储键与分区

全部持久化存储键在 `platform/registry.ts` 定义，均带版本后缀：

| 存储键                    | 内容                 | 证据             |
| ------------------------- | -------------------- | ---------------- |
| `tabs.fixed-folders.v1`   | 固定文件夹           | `registry.ts:50` |
| `tabs.persistent-pins.v1` | 常驻磁贴             | `registry.ts:54` |
| （折叠状态）              | 站点折叠记忆         | `registry.ts:59` |
| `tabs.settings.v1`        | 设置（46 字段）      | `registry.ts:64` |
| `tabs.undo-stack.v1`      | 撤销栈               | `registry.ts:65` |
| （自动分组）              | 自动分组状态         | `registry.ts:68` |
| （自动休眠台账）          | 最近一次自动休眠批次 | `registry.ts:73` |
| `tabs.sync-seeded.v1`     | 同步镜像是否已播种   | `registry.ts:79` |
| `tabs.snapshots.v1`       | 快照与归档           | `registry.ts:81` |
| `tabs.read-later.v1`      | 稍后读               | `registry.ts:83` |

另有 `chrome.storage.sync` 上的镜像块（前缀 `tabs.sync.v1.`，`SyncMirror.ts:17`）与 `storage.session` 上的会话数据（`itemTabBindings`、豁免账本 `createPersistedAllowanceLedger`，`background.ts:74-76`）。

组合根实例在 `platform/storage/repositories.ts:19-26` 统一导出（folders / pins / settings / undo / autoGroups / autoDiscard / snapshots / readLater）。

### 6.2 schema 约束与上限表

| 上限 / 默认值        | 值                       | 证据                                                 |
| -------------------- | ------------------------ | ---------------------------------------------------- |
| 单文件夹条目上限     | 500                      | `models.ts:28`                                       |
| 文件夹数上限         | 200                      | `models.ts:30`                                       |
| 常驻磁贴上限         | 200                      | `models.ts:32`                                       |
| 站点折叠记忆上限     | 2 000                    | `models.ts:34`                                       |
| 休眠白名单条目上限   | 500                      | `models.ts:36`                                       |
| 撤销单批次条目上限   | 1 000                    | `models.ts:40`                                       |
| 撤销栈深度           | 默认 10，范围 5–50       | `models.ts:42,137`                                   |
| 单快照标签数上限     | 1 000                    | `models.ts:44`                                       |
| 快照族上限           | 200                      | `models.ts:46`                                       |
| 稍后读上限           | 200                      | `models.ts:48`                                       |
| 自动休眠闲置阈值     | 默认 30 分钟，范围 5–240 | `models.ts:129`                                      |
| 自动快照间隔         | 默认 30 分钟，范围 5–720 | `models.ts:147`                                      |
| 自动快照滚动保留     | 默认 10，范围 1–50       | `models.ts:149`                                      |
| 命名快照上限         | 默认 30，范围 1–100      | `models.ts:151`                                      |
| 跨设备同步镜像       | 默认关闭                 | `models.ts:220`                                      |
| 显示其他窗口         | 默认开启                 | `models.ts:227`                                      |
| toast 时长           | 3 / 5 / 7 / 10 秒可选    | `settingSections.tsx:549-554`                        |
| 同步镜像块大小       | 6 000 字节               | `SyncMirror.ts:21`                                   |
| 同步镜像 TTL         | 30 天                    | `SyncMirror.ts:22`                                   |
| 同步镜像重试上限     | 5 次（指数退避）         | `SyncMirror.ts:46,111`                               |
| 时间线搜索快照数     | 20                       | `useSearchController.ts`（`HISTORY_SNAPSHOT_LIMIT`） |
| 命令面板空查询标签数 | 20                       | `CommandPalette.tsx:53`                              |
| 弹窗命中数           | 20                       | `popup/App.tsx:106`                                  |
| 设置页导入文件上限   | 5 MB                     | `SettingsPage.tsx:34`                                |
| Workona 导入上限     | 1 MB                     | `workonaImport.ts:66`                                |
| 其他窗口刷新节流     | 500 ms                   | `useOtherWindows.ts:40-48`                           |
| 跨页消息去重集合     | 32                       | `usePendingActions.ts:59-62`                         |
| 重复组判定阈值       | 2                        | `tabInsights.ts:19`                                  |
| 滞留判定天数         | 7                        | `tabInsights.ts:22`；`staleness.ts:6`                |

**settings 字段总数**：46（`models.ts:88-228`，按 `^  [a-zA-Z]+:` 计数得 46）。设置页 `settingSections.tsx` 声明布尔键白名单（26-47），另 `syncMirrorEnabled` 开关直接在 `SettingsPage.tsx:364-370` 编排。

**派生方式**：`DEFAULT_SETTINGS = SettingsSchema.parse({})` —— 默认值由 schema 单点派生，不手写第二份。

### 6.3 备份格式与导入事务语义

- 单一格式：`format: 'tabs.export'` + `EXPORT_FILE_VERSION = 2`（`models.ts:348,360-372`）。
- 版本不符即拒绝，`parseExportFile` 返回 `version-mismatch` 或 `invalid` 两类错误（`models.ts:384-395`）。
- 导入事务：任一分区写入失败整体回滚（`PRIVACY.md:80`）；实现上在导入期间挂起 watcher 回写与落盘，内存态由 `importData` 统一提交（`context.ts:102,140`）。
- 不做跨版本兼容，**不存在「旧版备份」**（`PRIVACY.md:80`；`CONTRIBUTING.md:68-70`）。

### 6.4 同步镜像模型

见 §4.13。要点回顾：默认关闭 → 镜像**文件夹、常驻磁贴与设置** → 分块 6000 字节写 `chrome.storage.sync` → TTL 30 天 → 配额超限静默降级 → 关闭即 `clearAll`。

---

## 7. 权限与隐私设计

### 7.1 权限清单与用途

manifest 声明 10 项权限（`wxt.config.ts:27-40`）+ 1 项按需主机权限（41）。用途以 `PRIVACY.md:23-36` 的表格为准，逐项对应：

| 权限                     | 用途（摘要）                                                                                    | 触网 |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ---- |
| `storage`                | 读写本地存储；同步镜像走 `chrome.storage.sync`                                                  | 否   |
| `tabs`                   | 读取当前窗口标签元数据；「搜索所有窗口」开启时读其他窗口                                        | 否   |
| `tabGroups`              | 读取/管理原生标签组，支持保存为固定文件夹                                                       | 否   |
| `sidePanel`              | 侧边栏主形态                                                                                    | 否   |
| `alarms`                 | 开启自动休眠后周期检查                                                                          | 否   |
| `contextMenus`           | 右键菜单快捷操作                                                                                | 否   |
| `omnibox`                | 地址栏 `t` 命令                                                                                 | 否   |
| `sessions`               | 撤销历史面板展示并恢复浏览器最近关闭                                                            | 否   |
| `bookmarks`              | 仅在用户主动操作时：导出为书签 / 从书签栏导入                                                   | 否   |
| `notifications`          | 自动休眠时本机通知                                                                              | 否   |
| `declarativeNetRequest`  | 禁缓存：按用户填的站点/URL 前缀改写 `Cache-Control` 等头为 no-store（默认关闭），不拦截不读内容 | 否   |
| `<all_urls>`（optional） | 禁缓存的生效范围；默认不授予，随开关按需询问                                                    | 否   |

（`PRIVACY.md:23-36`；`wxt.config.ts:27-41`。`sidePanel` 与 `action` 由 WXT 检测入口自动生成，`wxt.config.ts:60-62` 注释说明。）

**对外口径纪律**：快捷键是 manifest 声明而**不是权限**，Chrome 不因它授予数据访问能力，安装时也不出现提示，故不在权限表列出（`PRIVACY.md:40`）——这是刻意的信任设计。

### 7.2 零网络的工程保障

`pnpm check:privacy`（入口 `scripts/privacy-check.mjs`，需先 `pnpm build`）校验四件事（`PRIVACY.md:85-94`）：

1. **权限清单与 `PRIVACY.md` 第 2 节双向一致**（manifest 新增而未记录 / 文档记录而 manifest 已删，都失败）；
2. **主机权限在冻结清单内**（`<all_urls>` 走 optional）；
3. **零出站网络调用**：扫描 `src/` 源码**与** `.output/chrome-mv3/**/*.js` 构建产物——只看源码会让第三方依赖打进 bundle 后的网络调用不可见，而用户安装的是产物；
4. **存储数据类型**已在文档第 3 节文档化。

配套的工程约束：`CONTRIBUTING.md:89-94` 明确不接受「引入任何出站网络请求（含埋点、崩溃上报、CDN 资源）」「为绕过门禁而修改配置」「lint-disable 注释」。

### 7.3 信任面板设计意图

关于页把「零网络」从文档承诺变成**可见功能**（`README.md:76`）：提供 12 项权限逐条用途说明（`AboutPage.tsx:206-219`）、数据存放位置说明、以及 **DevTools 零网络请求自验证教程**——即教用户自己打开 DevTools 验证。另有隐私徽章（184-189）与补充事实（222-225）。

设计意图（代码注释/文案可证实的）：让用户可自行验证，而非依赖厂商承诺；信任面板随本版（v1.0）引入，属免费核心、零新权限、零上报（`README.md:78`）。

---

## 8. 设计系统与可达性基线

### 8.1 令牌体系与门禁

- **门禁 `pnpm check:ui`**：UI 设计令牌守卫，检查未受控调色板 / 字号 / 对比度（`README.md:53,146`）。
- **门禁 `pnpm check:i18n`**：`scripts/i18n-dead-keys.mjs` 三条规则——① zh-CN 与 en 键集合完全一致；② 每个键必须在 `src` 下 `.ts/.tsx` 中出现精确串匹配；③ 模板串动态键通过白名单豁免（`scripts/i18n-dead-keys.mjs:7-12,33-36`）。
  - 白名单 2 条：`onboarding.step\d+(Title|Body)`、`groups.color.(grey|blue|red|yellow|green|pink|purple|cyan|orange)`（33-36）。
  - 判定用「前面紧邻引号 + 后面不是单词字符或点号」的正则，避免把 `settings.on` 误判为被 `settings.onboarded` 引用（81-87）。
  - **实测结果（2026-09-30）**：zh-CN / en 各 **744** 键且集合一致，死键 0（运行 `node scripts/i18n-dead-keys.mjs` 的输出）。
- **聚合门禁 `pnpm check`**：typecheck → lint → check:i18n → check:ui → test → build → check:privacy（`README.md:42`；`CODEBUDDY.md:34`）。
- **覆盖率纪律**：阈值是 ratchet 基线，只许收紧不许放松（`CONTRIBUTING.md:75`）。

### 8.2 已达成的可达性事实（逐项）

| #   | 事实                                                                                                                                                 | 证据                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | 侧边栏补 `<h1 class="sr-only">`，修复标题层级断裂，使读屏可「跳到标题」                                                                              | `App.tsx:1002`（注释 999-1001）                          |
| 2   | 搜索命中数用 `<output aria-live="polite">` 播报，读屏用户有过滤反馈                                                                                  | `App.tsx:1017-1019`（注释 1016）                         |
| 3   | 存储降级横幅 `role="alert"`                                                                                                                          | `App.tsx:1025`                                           |
| 4   | 错误 toast `role="alert"` + `aria-live="assertive"`；带撤销按钮                                                                                      | `StatusToast.tsx:19-32`                                  |
| 5   | 弹窗族焦点陷阱 + Esc + 关闭后焦点恢复 + 滚动锁定；模态栈供全局热键判断                                                                               | `Dialog.tsx:30-40,48-139`                                |
| 6   | 命令面板 ARIA combobox + listbox + `aria-activedescendant`（并做索引钳制）                                                                           | `CommandPalette.tsx:443-459`                             |
| 7   | 引导进度点是 `<button>`，带 `aria-label`（「转到第 n 步」）与 `aria-current="step"`；`tour-dot` 透明扩区把 6px 视觉高度撑到 ≥24px 命中（WCAG 2.5.8） | `OnboardingTour.tsx:111-127`                             |
| 8   | 搜索框 `aria-label`；历史开关 `aria-pressed` + `aria-label` 随态切换                                                                                 | `SearchBar.tsx:45,62-64`                                 |
| 9   | 磁贴条 `aria-label` + 拖放提示 `data-drop-label`；切换中 `aria-busy`                                                                                 | `PinnedStrip.tsx:53-54`；`SpaceStrip.tsx:38`             |
| 10  | 弹窗命中数 `sr-only` output 播报                                                                                                                     | `popup/App.tsx:210-212`                                  |
| 11  | 白名单移除按钮命中区补到 24px（WCAG 2.5.8）                                                                                                          | `settingControls.tsx`（`whitelist-remove` 类）           |
| 12  | 字号纪律：`text-3xs` 用于说明性正文，配 `check:ui` 对比度守卫                                                                                        | 见 `App.tsx:1029,1040` 等处的 `text-3xs`；`README.md:53` |

### 8.3 已知可达性缺口（仅列代码可证实的）

| #   | 缺口                                                                                             | 证据                                         | 说明                                                               |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------ |
| 1   | 搜索框的键盘导航提示（↑↓/Enter/Esc）带 `aria-hidden="true"`，读屏用户收不到该提示                | `SearchBar.tsx:88-91`                        | 代码显式 `aria-hidden`，属已知取舍（视觉噪音 vs 读屏可达），非缺陷 |
| 2   | 固定空间空态概念地图只在 `!settings.conceptsSeen` 时出现，完成后只能从设置页「固定概念一览」回看 | `FixedArea.tsx:109-125`；`App.tsx:1246-1253` | 入口变深，非不可达                                                 |
| 3   | 分区折叠记忆上限 2000 条，超出后的行为未在本地代码中见到明确降级分支                             | `models.ts:34`                               | **待确认**（见 §11）                                               |

---

## 9. 非目标（明确不做什么，附依据）

| #   | 不做什么                                                               | 依据                                                                               |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | **不做自有账号 / 自有服务器 / 自建同步通道**                           | `README.md:159-167`；`PRIVACY.md:65-67`（「Tabs 自身没有服务器、不自建同步通道」） |
| 2   | **不做任何遥测、埋点、崩溃上报**                                       | `CODEBUDDY.md:24`；`CONTRIBUTING.md:89-94`                                         |
| 3   | **不做跨版本备份兼容 / 旧版备份解析**                                  | `CONTRIBUTING.md:68-70`；`models.ts:348,384-395`                                   |
| 4   | **不做订阅制收费**                                                     | `README.md:163-165`（买断 Pro「不破隐私、不联网、不订阅」）                        |
| 5   | **不读取页面内容 / 不拦截请求**                                        | `PRIVACY.md:35-36`（DNR 只改写既有响应头）                                         |
| 6   | **不接管当前窗口之外的标签**（其他窗口仅查看/聚焦/关闭）               | `README.md:5`；`App.tsx:1157-1163`；`useOtherWindows.ts:63`                        |
| 7   | **不在 core 层引入 chrome / DOM / React，也不 import platform**        | `CODEBUDDY.md:13-19`；`CONTRIBUTING.md:41-42`                                      |
| 8   | **不把校验只做在 UI 输入处**                                           | `CONTRIBUTING.md:44-50`（含真实事故说明）                                          |
| 9   | **新增权限不先改 `wxt.config.ts` + `PRIVACY.md` 就上线**               | `CONTRIBUTING.md:52-55`；`README.md:126`                                           |
| 10  | **不为绕过门禁修改 ESLint / Prettier / 覆盖率配置，不加 lint-disable** | `CONTRIBUTING.md:93-94`                                                            |

---

## 10. 术语表

| 术语                           | 定义                                                                                                       | 证据                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **固定空间（Fixed Area）**     | 持久化的组织资产区，含文件夹与常驻磁贴；与浏览器当前标签集合正交                                           | `FixedArea.tsx`；`PinnedStrip.tsx`                |
| **常驻磁贴（Persistent Pin）** | 身份归一化的快捷入口；单击切换/重开，中键只关页面、入口保留                                                | `PinnedStrip.tsx:17-22,45`；`models.ts:32`        |
| **分区（Section）**            | 标签列表按来源切分的临时区块；派生顺序为固定 → 原生组 → 站点聚合 → 未分组                                  | `core/site/Sections.ts:355-492`                   |
| **挂起转正**                   | 文件夹条目处于「待导航」的挂起态，标签事件后由 `reconcilePendingItems` 转为已绑定条目                      | `folderSlice.ts:358-362`；`types.ts:151`          |
| **绑定（binding）**            | 文件夹条目 ↔ 真实标签的对应关系，存于 session（`itemTabBindings`）；绑定标签豁免清理/休眠                  | `folderSlice.ts:364-374`；`autoDiscard.ts:63,114` |
| **空间（Space）**              | `origin='space'` 的快照；切换 = 写回现场 → 关闭非固定非隐身 http(s) 标签 → 同窗口恢复 → 写 `activeSpaceId` | `useSpaces.ts:53-104`；`models.ts:225`            |
| **归档（Archive）**            | `origin='archive'` 的快照；「归档当前窗口」= 留档并关闭                                                    | `SnapshotsPanel.tsx:139-162`；`workonaImport.ts`  |
| **keeper**                     | 重复组中按 `KeeperPolicy`（激活 > 固定 > index 最小）保留下来的那一个                                      | `DuplicateIndex.ts:69-92`                         |
| **休眠 / 挂起标签（discard）** | 调 `chrome.tabs.discard` 释放内存，标签保留可唤醒；安全集统一由 `canSafelyDiscardTab` 判定                 | `core/tab-types.ts`；`autoDiscard.ts:65,118`      |
| **快照族**                     | 全部快照 + 归档的集合，上限 200                                                                            | `models.ts:46`                                    |
| **降级（degraded）**           | 持久化写失败的状态，按分区记账（`storageDegraded`），UI 顶部横幅告警                                       | `App.tsx:1023-1033`；`folderSlice.ts:375-384`     |
| **兼容变体（compat）**         | 面向旧内核 Chromium 的构建变体，降级为弹窗形态；管道已建成，随 V2.0 交付                                   | `README.md:36,78`                                 |

---

## 11. 待确认清单

| #   | 不确定项                                                                                                                       | 卡在哪                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **i18n 键数**：主理人口径 743，本次实测（`node scripts/i18n-dead-keys.mjs`）为 **744**，两套 locale 各 744 且集合一致、死键 0  | 脚本输出与扁平计数（744）互相一致，但均与团队口径差 1。可能是统计时点不同；**以脚本当前输出 744 为准**，请主理人确认是否需要按 743 统一对外                                                                             |
| 2   | **src 总行数**：主理人口径 24 905（102 .ts + 59 .tsx + 4 .html + 2 .json + 1 .css），本次实测 `.ts+.tsx` = 24 909、全量 28 528 | 差 4 行，可能是统计时点不同。文件类型计数（102/59/4/2/1）与实测完全一致                                                                                                                                                 |
| 3   | **站点折叠记忆超过 2000 条后的降级行为**                                                                                       | 只见到上限常量（`models.ts:34`），未读到明确的淘汰/拒写分支代码                                                                                                                                                         |
| 4   | **`src/entrypoints/bookmarks/`** 是空目录还是有内容                                                                            | 目录下无文件（`ls` 为空），但目录存在；不确定是占位还是历史残留                                                                                                                                                         |
| 5   | **兼容变体（compat）最终的产品行为**                                                                                           | `README.md:78` 只说「管道已建成，随 V2.0 交付」；当前只知「降级为弹窗形态」（`README.md:36`），其余未实现，不宜描述                                                                                                     |
| 6   | **设置页实际暴露的设置项数量口径**                                                                                             | `settingSections.tsx:26-47` 声明布尔键白名单，另有 `syncMirrorEnabled` 在 `SettingsPage.tsx:364-370`；主理人口径「35 个 key + 1」，本次未做逐项复算，故本文只写「46 字段 schema」与「白名单在 26-47」，未复述 35 这个数 |
| 7   | **用户画像**                                                                                                                   | 无用户研究输入。本文 4 个画像全部标注为「推断」，推断依据是产品自带的三套预设（`settingPresets.tsx:25-55`）与关于页能力域（`AboutPage.tsx:30-145`）。如需真实画像，需 user-researcher 的输入                            |
| 8   | **性能基线的实测值**                                                                                                           | `tests/perf/search-perf.test.ts:81-109` 是「阈值断言」（<100ms / <1000ms / <300ms），不是实测数值记录。本文只引用阈值，未引用任何实测中位数                                                                             |

---

## 12. 证据索引（按文件列出本文引用过的 `file:line`）

### 根目录文档

- `README.md` — 3（定位）、5,7（无后端/只管当前窗口）、27-43（构建命令）、35-36（build/compat）、42（check 聚合）、53（check:ui）、60-76（功能一览表）、68（角标）、70（撤销覆盖）、71（快照恢复语义）、72（习惯洞察）、75（平台三态/双语）、76（信任面板）、78（V1.1/V1.2 注）、121-126（分层约束）、146（check:ui 令牌）、155（主存储）、159-167（商业模式）
- `PRIVACY.md` — 23-36（权限用途表）、32（sessions）、33（bookmarks）、35-36（DNR/optional host）、40（快捷键非权限）、65-73（跨设备同步四要点）、70（同步范围）、72（配额降级）、73（关闭即清除）、79-80（导出/导入事务）、85-94（隐私回归四项）、100（不可妥协底线）
- `CODEBUDDY.md` — 3（定位）、13-19（分层）、18（schema 隔离）、24（零网络）、26（校验唯 schema）、29-37（命令）、34（check 聚合）、41-42（分层方向）、43-46（agents/skills）
- `CONTRIBUTING.md` — 15（check 组成）、41-42（分层）、44-50（校验唯 schema + 事故）、52-55（权限冻结）、57-70（持久化变更 + 单一备份格式）、68-70（不做跨版本兼容）、75（覆盖率 ratchet）、89-94（不会接受的改动）
- `wxt.config.ts` — 22（default_locale）、23（minimum_chrome_version）、24（omnibox `t`）、26（open_in_tab）、27-40（10 项权限）、41（optional_host_permissions）、42-59（4 个 commands）、60-62（sidePanel/action 由 WXT 生成注释）、65-91（compat 变体 hook）
- `tests/perf/search-perf.test.ts` — 81-92（150 标签查询 <100ms）、88-90（命中附加断言）、94-101（索引构建 <1000ms）、103-109（500 标签 <300ms）
- `scripts/i18n-dead-keys.mjs` — 7-12（三条规则）、33-36（动态键白名单 2 条）、51-59（flatten）、81-87（引用判定正则）、103-106（通过输出）

### core

- `src/core/schema/models.ts` — 28,30,32,34,36,40,42,44,46,48（上限常量）、88-228（SettingsSchema，46 字段）、129（autoDiscardMinutes）、137（undoStackLimit）、145（autoSaveSnapshots）、147（autoSnapshotIntervalMin）、149（maxAutoSnapshots）、151（snapshotLimit）、220（syncMirrorEnabled）、225（activeSpaceId）、227（showOtherWindows）、348（EXPORT_FILE_VERSION=2）、360-372（ExportFileSchema）、384-395（parseExportFile）
- `src/core/undo/UndoStack.ts` — 17-29（toUndoTabRecord）、32-40（pushBatch FIFO）、43-46（popBatch）、63-75（createUndoBatch）
- `src/core/dup/DuplicateIndex.ts` — 26-36（build/webComparisonKey）、39-43（duplicates）、69-92（KeeperPolicy）
- `src/core/insights/tabInsights.ts` — 19（DUPLICATE_THRESHOLD）、22-23（STALE_TAB_DAYS/MS）、26（INSIGHT_TOP_N）、91-153（computeInsights）、124（休眠候选排除绑定）、135（滞留排除集）
- `src/core/insights/workonaImport.ts` — 66（1MB 上限）、103-159（parseWorkona）
- `src/core/readlater/trim.ts` — 10-17（超限淘汰最旧）
- `src/core/readlater/staleness.ts` — 6（READLATER_STALE_MS 7 天）、12-15（isReadLaterStale）
- `src/core/site/Sections.ts` — 15-49（TemporarySection）、102-145（buildOpenerTree）、195-245（collectSiteMergeCandidates）、269-353（buildSitePlan）、355-492（deriveSections）、458-476（language 模式）
- `src/core/snapshot/snapshotDiff.ts` — 18（三分类）、49-84（snapshotDiff）、92-101（buildPartialSnapshot）
- `src/core/tab-types.ts` — `canSafelyDiscardTab`、`NO_GROUP`

### platform

- `src/platform/registry.ts` — 50,54,59,64,65,68,73,79,81,83（各存储键）
- `src/platform/storage/repositories.ts` — 19-26（组合根实例）
- `src/platform/storage/SyncMirror.ts` — 17（CHUNK_PREFIX）、21（CHUNK_BYTES=6000）、22（TTL 30 天）、46（MAX_RETRY_ATTEMPTS=5）、111（退避）、119-123（写串行链）、185-193（clearAll）、213-242（pull）
- `src/stores/undoStore.ts` — 92（UNDO_EXEC_LOCK）、145-152（toast 时长）、164-217（runUndo/失败回填）、271-329（closeWithUndo）、411-419（recordClosedBatch）、436-441（clearBatches）
- `src/stores/data/folderSlice.ts` — 352-357（ready 前不协调，防整表写空）、358-362（挂起转正）、364-374（绑定维护）、375-384（按分区记账降级）
- `src/stores/data/context.ts` — 102,140（导入期间挂起回写/落盘）
- `src/stores/data/types.ts` — 110（打开固定条目四级）、151（快照联动）
- `src/stores/data/transferSlice.ts` — 74（导入期间挂起 watcher）

### entrypoints

- `src/entrypoints/sidepanel/App.tsx` — 74-91（planDuplicateCleanup）、997-1269（完整渲染树）、999-1002（sr-only h1）、1005-1015（SearchBar）、1017-1019（命中数 output）、1020-1033（降级横幅）、1034-1053（Tip）、1054-1062（SpaceStrip）、1063-1099（磁贴 + 原生固定区）、1100-1102（FixedArea）、1103（StatusToast）、1109-1119（稍后读）、1120-1154（三态 + SectionList）、1155-1163（其他窗口）、1166-1174（时间线）、1176-1181（新建标签条）、1183-1206（FooterToolbar）、1207-1265（五个浮层）
- `src/entrypoints/sidepanel/FooterToolbar.tsx` — 78-191（footerLabels 文字模式）、123-131（重复徽章）、134-142（批量关闭）、151-158（唤醒全部）
- `src/entrypoints/sidepanel/ListStates.tsx` — 13-92（四态组件）
- `src/entrypoints/sidepanel/hooks/useSearchController.ts` — 34（EMPTY_NO_CACHE_SET）、168-185（拼音 tick）、222-228（Esc 清空失焦）
- `src/entrypoints/sidepanel/hooks/useSpaces.ts` — 53-104（switchSpace 四步）、81-89（关闭过滤条件）、90-91（同 windowId 恢复）、109-129（exitSpace）、131-147（saveAsSpace）
- `src/entrypoints/sidepanel/hooks/useListNavigation.ts` — 39（索引初值 null）、48-52（收缩钳制）、65（循环取模）、68-75（Enter）
- `src/entrypoints/sidepanel/hooks/useGlobalHotkeys.ts` — 40（模态短路）、55-56（⌘⇧Z 不判撤销）、57-62（输入框让位原生撤销）
- `src/entrypoints/sidepanel/hooks/usePendingActions.ts` — 59-62（去重 Set 上限 32）、83-108（6 种消息分发）
- `src/entrypoints/sidepanel/hooks/useSectionDerivation.ts` — 65-101（基线复用）、111-120（过滤态强制展开）、135-144（toggleAll）
- `src/entrypoints/sidepanel/hooks/useOtherWindows.ts` — 40-48（500ms 节流）、63（排除隐身）、76（hasActive 排序）
- `src/entrypoints/background.ts` — 63（WINDOW_CACHE_UPDATE_KEYS）、68（全局兜底）、74-76（豁免账本）、76-93（ReuseCoordinator）、121（setPanelBehavior）、181-228（tabs 事件）、245-248（windows 事件）、252-260（onMessage + sender 校验）、309,313（onInstalled/onStartup）、442（omnibox）、460-461（角标）、468（alarms.onAlarm）
- `src/entrypoints/background/contextMenus.ts` — 14-27（MENU_IDS 12 项）、30-40（i18n 键）、45-58（写串行队列）、73-132（创建）
- `src/entrypoints/background/autoDiscard.ts` — 13-28（台账 + 通知 + 失败不发可撤销消息）、46-89（runAutoDiscard）、56（白名单匹配器）、57（阈值）、63,114（绑定豁免）、74-81（有限并发）、91-104（alarm periodInMinutes:1）、106-135（discardInactiveTabs）
- `src/entrypoints/background/autoSnapshot.ts` — 20（ALARM 名）、120-127（delayInMinutes）
- `src/entrypoints/options/SettingsPage.tsx` — 34（MAX_IMPORT_BYTES 5MB）、216-233（settingsSearch）、236-249（outlineItems）、364-370（syncMirrorEnabled）
- `src/entrypoints/options/settingSections.tsx` — 26-47（BooleanSettingKey）、180-618（buildSections 五组）、536-541（undoStackLimit 5/10/20/50）、549-554（toastDurationSec）、608-614（snapshotLimit）
- `src/entrypoints/options/settingControls.tsx` — 245-317（NoCacheToggle 请求 optional 权限）
- `src/entrypoints/options/settingPresets.tsx` — 25-55（三预设）、162-217（CAPABILITIES + replayTour）
- `src/entrypoints/options/ShortcutsSection.tsx` — 10（IS_MAC）、19-46（快捷键列表）
- `src/entrypoints/about/AboutPage.tsx` — 30-145（12 能力域）、152-158（ENTRY_POINTS）、161-169（面板内 7 项）、176-181（浏览器级 4 项）、184-189（PRIVACY_BADGES）、206-219（PERMISSION_FACTS 12 项）、222-225（TRUST_EXTRA_FACTS）
- `src/entrypoints/popup/App.tsx` — 17-19（降级形态注释）、106（命中上限 20）、129-136（跨窗口激活）、166-181（Esc/↑↓/Enter）、210-212（sr-only output）

### ui

- `src/ui/tabs/SectionList.tsx` — 12（LOCATE_SECTION_EVENT）、105-108（仅 native/site 可排序）、148-157（CategoryModule）、166-178（splitPartnerIds）
- `src/ui/tabs/TabRow.tsx` — 11（useSortable）、66（onMoveTab Alt 重排）、74（density 三档）
- `src/ui/tabs/SortablePinnedTile.tsx` — `makePinMiddleClickHandler`、`buildPinRuntimeIndex`、`CLOSED_PIN_RUNTIME`
- `src/ui/search/SearchBar.tsx` — 44-45（placeholder/aria-label）、52-55（Esc 清空）、62-64（历史开关 aria-pressed）、88-91（键盘提示 aria-hidden）
- `src/ui/fixed/FixedArea.tsx` — 37（默认折叠 >5）、44-47,60-72（空白拖入建文件夹）、109-125（概念地图）、135-150（PromptDialog）
- `src/ui/fixed/PinnedStrip.tsx` — 17-22（交互语义）、30-33（useDroppable）、38-41（items 必须 memo）、43（空 return null）、45（中键处理）、52（is-drop-target）、53-54（aria-label）
- `src/ui/readlater/ReadLaterSection.tsx` — 35-39（未读/过期）、41-57（openItem 标记已读）、59（空 return null）、78-89（归档过期）
- `src/ui/common/SpaceStrip.tsx` — 32（空隐藏）、38（aria-busy + 禁用）、40-51（全部标签出口）、74-82（saveAs）
- `src/ui/common/CommandPalette.tsx` — 53（EMPTY_QUERY_TAB_LIMIT=20）、372（漫游顺序）、434-436（点遮罩关闭）、443-459（ARIA 四件套）、570-590（RestoreConfirmDialog）
- `src/ui/common/SnapshotsPanel.tsx` — 54（三视图）、61,323-327（删除二次确认）、96-105（diff 预览）、109-129（选择性恢复）、139-162（生命周期分组）、191-233（OneTab/Workona 导入）、329-341,446-516（周报 + 洞察）
- `src/ui/common/UndoHistoryPanel.tsx` — 36-40（kindLabel）、106-119（崩溃引导）
- `src/ui/common/StatusToast.tsx` — 19-26（role=alert/assertive）、28-32（撤销按钮）
- `src/ui/common/OnboardingTour.tsx` — 7（TOTAL=3）、9-16（语义注释）、30-42（useModalA11y + showModal）、111-127（进度点 a11y + 24px 命中）
- `src/ui/dialog/Dialog.tsx` — 21-22（FOCUSABLE_SELECTOR）、30-40（modalStack/isModalOpen）、48-139（useModalA11y）

---

## 自检记录（行号抽查）

写作完成后对本文引用的行号做抽查，方法为 `grep -n` / `sed -n` / `cat -n` 回读原文比对。抽查 8 处，全部对得上：

| #   | 抽查项                 | 本文写法                                         | 回读结果                                                                                                                       | 结论                                                                                      |
| --- | ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1   | 撤销栈默认深度         | `models.ts:42` = `DEFAULT_UNDO_STACK_LIMIT = 10` | `42: export const DEFAULT_UNDO_STACK_LIMIT = 10;`                                                                              | ✅                                                                                        |
| 2   | 单快照 / 快照族上限    | `models.ts:44` = 1000、`46` = 200                | `44: SNAPSHOT_TABS_LIMIT = 1_000`、`46: SNAPSHOTS_LIMIT = 200`                                                                 | ✅                                                                                        |
| 3   | 命名快照上限默认值     | `models.ts:151` = 30                             | `151: snapshotLimit: z.number().int().min(1).max(100).default(30)`                                                             | ✅                                                                                        |
| 4   | 备份版本号             | `models.ts:348` = 2                              | `348: export const EXPORT_FILE_VERSION = 2;`                                                                                   | ✅                                                                                        |
| 5   | 权限清单与按需主机权限 | `wxt.config.ts:27-40` 权限、`41` optional        | 回读第 20-62 行：`27: permissions: [`、`39: 'declarativeNetRequest'`、`40: ]`、`41: optional_host_permissions: ['<all_urls>']` | ✅（注：团队口径写「27-41」，实际权限数组为 27-40，41 是 optional host 行，本文已分开写） |
| 6   | 浏览器级快捷键 4 个    | `wxt.config.ts:42-59`                            | `42: commands: {`、`59: }`（含 focus-search/open-panel/locate-active/discard-inactive）                                        | ✅                                                                                        |
| 7   | 稍后读淘汰策略         | `trim.ts:10-17` 按 `addedAt` 升序淘汰最旧        | 回读确认排序与 `slice(sorted.length - limit)`                                                                                  | ✅                                                                                        |
| 8   | 习惯洞察阈值           | `tabInsights.ts:19-26`                           | `19: DUPLICATE_THRESHOLD = 2`、`22-23: STALE_TAB_DAYS/MS`、`26: INSIGHT_TOP_N = 5`                                             | ✅                                                                                        |
| 9   | 搜索性能基线           | `tests/perf/search-perf.test.ts:81-109`          | 回读 75-109 行：`describe` 在 80，三个 `it` 分别在 81 / 94 / 103，断言 `<100` / `<1000` / `<300`                               | ✅（微调为 81-109）                                                                       |
| 10  | PRIVACY 权限表         | `PRIVACY.md:23-36`                               | `cat -n` 回读：23 表头、25-35 各项权限、36 optional host 行                                                                    | ✅                                                                                        |

**第二轮抽查（写作后统一回读，9 处）**：

| #   | 抽查项                               | 回读结果                                                                                         | 结论 |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------ | ---- |
| 11  | `Dialog.tsx:30-40` 模态栈            | `30: const modalStack: symbol[] = [];` … `38: export function isModalOpen()`                     | ✅   |
| 12  | `Dialog.tsx:48` useModalA11y         | `48: export function useModalA11y(`                                                              | ✅   |
| 13  | `FooterToolbar.tsx:123-131` 重复徽章 | `123: {duplicateCount > 0 && (` … `130: onClick={onCleanDuplicates}`                             | ✅   |
| 14  | `CommandPalette.tsx:53` 空查询上限   | `53: const EMPTY_QUERY_TAB_LIMIT = 20;`                                                          | ✅   |
| 15  | `popup/App.tsx:106` 弹窗命中上限     | `106: return engine.search(query, 20);`                                                          | ✅   |
| 16  | `SyncMirror.ts:21-22` 块大小与 TTL   | `21: CHUNK_BYTES = 6000`、`22: MIRROR_TTL_MS = …24*30`                                           | ✅   |
| 17  | `SyncMirror.ts:46` 重试上限          | `46: MAX_RETRY_ATTEMPTS = 5`                                                                     | ✅   |
| 18  | `trim.ts:10-17` 稍后读淘汰           | 按 `addedAt` 升序排序后 `slice(sorted.length - limit)`（保留最新、淘汰最旧）                     | ✅   |
| 19  | `tabInsights.ts:19-26` 三类阈值      | `19: DUPLICATE_THRESHOLD = 2`、`22-23: STALE_TAB_DAYS=7 / STALE_TAB_MS`、`26: INSIGHT_TOP_N = 5` | ✅   |

**两处与团队口径不一致，已在正文与 §11 标注**：

1. **i18n 键数**：团队口径 743；实测运行 `node scripts/i18n-dead-keys.mjs` 输出 「zh-CN/en 各 **744** 键且集合一致，动态键白名单 2 条，死键 0」，且独立扁平计数（zh 744 / en 744，差集均为空）与之一致。**本文按 744 写**，已在 §8.1 与 §11-1 标注差异。
2. **src 行数**：团队口径 24 905；实测 `.ts`(102) + `.tsx`(59) = **24 909** 行，全量（含 4 .html + 2 .json + 1 .css）= 28 528 行。文件类型计数与团队口径完全一致，行数差 4。**本文按实测写**，已在 §0 与 §11-2 标注差异。

**未逐项复算、故未在正文复述的数字**：团队口径「设置页暴露 35 个 key」。本文只写了可回读的事实（`settingSections.tsx:26-47` 布尔键白名单、`SettingsPage.tsx:364-370` 的 `syncMirrorEnabled`、schema 46 字段），未复述 35 这个数，见 §11-6。
