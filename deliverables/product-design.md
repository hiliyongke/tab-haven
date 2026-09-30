# Tabs 产品设计文档（PRD）

**文档版本**：v1.1（含第二轮 R4–R19 落地后的规格更新）
**编写日期**：2026-09-30
**对应代码基线**：仓库根目录工作副本（git HEAD `94a647c`）
**产品形态**：Chrome / Edge 浏览器扩展（Manifest V3）
**适用读者**：设计、前端、测试、发布审核

> **本文档的编写口径**
> 本文每一条功能描述、状态、阈值、默认值都可回溯到 `src/` 下的具体代码或 `wxt.config.ts` / `PRIVACY.md`。
> 凡代码尚未实现、仅属规划的内容，一律放在第 12 节「未实现 / 规划中」并明确标注，不混入正式功能描述。
> 凡属推断（用户动机、使用频率）一律显式标注「**推断**」。本产品无埋点无遥测，故不含任何使用量数据。

---

## 1. 产品定义

### 1.1 一句话定义

**Tabs 是一个本地优先、无自有账号、无自有服务器的浏览器标签工作台：把散乱的标签组织成有秩序的空间，并通过撤销、快照与归档降低误操作风险。**（`README.md:3,5`）

### 1.2 定位三层

| 层 | 内容 | 证据 |
|----|------|------|
| 功能层 | 只管理**当前窗口**的标签页，提供侧边栏式组织、搜索、拖拽整理与多层撤销 | `README.md:5` |
| 信任层 | 无后端 · 无账号 · 无遥测 · **零出站网络请求** | `README.md:7`；`PRIVACY.md:9-16` |
| 商业层 | 永久免费核心；护城河明确排除自有云端账号与自建网络同步 | `README.md:158-167` |

### 1.3 核心取舍

**放弃「跨设备」这个标签管理器最常见的卖点**，只保留「经浏览器账号通道的、默认关闭的、关闭即删除已上传数据的镜像同步」：

- `syncMirrorEnabled` 默认 `false`（`models.ts:213-220`）
- 关闭开关时 `await syncMirror.clearAll()` 删除已上传镜像块（`settingsSlice.ts:78-80`）
- `scheduleMirror` 在开关关闭时「一次 sync 写入都不发」（`context.ts:57-60` 注释：「此前这里是无条件镜像，用户完全无感知就把完整收藏 URL 推上了浏览器账号通道」）

### 1.4 非目标（明确不做）

- ❌ 自有云端账号 / 自建同步通道（`README.md:158-167`）
- ❌ 任何遥测 / 埋点 / 使用统计（`PRIVACY.md:9-16`）
- ❌ 管理其他设备或其他浏览器配置文件的标签（只管当前窗口，`README.md:5`）

---

## 2. 目标用户与场景

> **本节含推断**。本项目无埋点无遥测（产品宪法），不存在使用量、留存、满意度数据。以下画像与场景基于功能设计反推，用于对齐设计意图，非调研结论。

### 2.1 用户画像（**推断**）

| 画像 | 特征 | 主要诉求 | 对应能力 |
|------|------|----------|----------|
| **标签囤积者** | 常开 50+ 标签，跨多个主题并行 | 找回、归类、清理 | 搜索（拼音）、站点聚合、一键清理重复、快照 |
| **会话工作者** | 按项目/任务切换整组标签 | 保存现场、整批切换 | 工作空间、文件夹「打开全部」、快照恢复 |
| **误关恐慌者** | 担心关错标签 | 反悔 | 多层撤销栈、浏览器最近关闭、快照、归档 |
| **隐私敏感者** | 拒绝把浏览数据交给第三方 | 可控、可验证 | 零网络、权限清单冻结、信任面板自验证教程 |

### 2.2 核心场景（均为代码可证实的路径）

| 场景 | 链路 | 证据 |
|------|------|------|
| **找标签** | `⌘/Ctrl+K` 或 `Ctrl+Shift+F` → 实时过滤 → `↑↓`/`Enter` | `useGlobalHotkeys.ts:41-53`；`wxt.config.ts:43-46` |
| **误关找回** | 关闭入撤销栈 → `⌘Z` / 底栏护盾 → 撤销历史 → 浏览器最近关闭 → 快照引导 | `undoStore.ts:350-408`；`UndoHistoryPanel.tsx:96-114` |
| **整理** | 拖到固定空间 → 命名建夹 → toast 确认；或 `⌘P` → 文件夹名 → 打开全部 | `FixedArea.tsx:49-72`；`App.tsx:905-927` |
| **保存现场** | 命名快照 / 归档窗口 / 关窗自动快照 → 恢复前 diff 预览 → 选择性恢复 | `SnapshotsPanel.tsx:96-129`；`snapshotStore.ts` |

---

## 3. 形态矩阵

同一套 `core` 领域逻辑，五种壳：

| 形态 | 入口文件 | 能力范围 | 定位 |
|------|----------|----------|------|
| **sidepanel** | `src/entrypoints/sidepanel/App.tsx`（1,309 行） | 全量 | 主工作台 |
| **popup** | `src/entrypoints/popup/App.tsx` | **仅搜索 + 切换** | 降级形态 / 快速切换器（Chrome 平台行为：右键图标） |
| **options** | `src/entrypoints/options/SettingsPage.tsx` | 设置 + 导入导出 + 诊断 + 清除数据 | 配置中心（`open_in_tab: true`，`wxt.config.ts:26,69`） |
| **about** | `src/entrypoints/about/AboutPage.tsx` | 能力总览 + **信任面板** | 信任凭证 |
| **background** | `src/entrypoints/background.ts` | 复用引擎 / 自动快照 / 自动休眠 / 右键菜单 / omnibox / 角标 / 关窗缓存 | 无 UI 后台能力 |

### 3.1 构建变体

`wxt.config.ts:66-90` 的 `build:manifestGenerated` 钩子：

- **标准版**（默认）：剥离 `action.default_popup`，点击图标打开侧边栏（注释：「`openPanelOnActionClick` 与 `default_popup` 共存时 popup 胜出」）。
- **兼容变体**（`TABS_VARIANT=compat`）：删除 `side_panel` 字段与 `sidePanel` 权限，`action.default_popup = 'popup.html'`。README 标注管道已建成、随 V2.0 交付（`README.md:78`）。
- `minimum_chrome_version: '114'`（`wxt.config.ts:25`）。

---

## 4. 信息架构

### 4.1 侧边栏布局（自上而下）

`src/entrypoints/sidepanel/App.tsx:1035-1234`

```
<h1 class="sr-only">                        ← 视觉隐藏，补标题层级（:1037-1040）
DndRoot（全局拖拽上下文）
├── SettingsSync（主题应用，无 UI）
├── SearchBar                               ← 常驻顶部，含「含历史」开关（:1043-1053）
├── <output aria-live="polite">             ← 命中数，仅读屏可见（:1054-1057）
├── [条件] 落盘失败横幅 role="alert"          ← storageDegraded（:1061-1071）
├── [条件] 能力发现 Tip 横幅                  ← !tipSeen（:1074-1091）
├── [条件] SpaceStrip 工作空间切换条           ← 有空间快照时（:1093-1100）
├── [条件] PinnedStrip 常驻磁贴条             ← showPinnedStrip（:1101）
├── [条件] 浏览器原生固定标签区                ← showPinnedStrip && pinnedSection（:1105-1137）
├── FixedArea 固定空间（恒显）                ← max-height: min(34vh, 280px)（:1138-1140；main.css:1133-1135）
├── StatusToast 状态提示条（条件）
├── [滚动区]
│   ├── [条件] ReadLaterSection 稍后读        ← dataReady && !isFiltering（:1149-1157）
│   ├── 主体：四态三元（:1158-1192）
│   │   ├── !dataReady → LoadErrorState（loadFailed）/ LoadingSkeleton
│   │   ├── tabs.length === 0 → EmptyTabs
│   │   ├── isFiltering && 0 命中 → NoSearchResults
│   │   └── SectionList 分区列表
│   └── [条件] OtherWindowsSection           ← !isFiltering && showOtherWindows（:1195-1201）
├── [条件] HistoryHitsSection 历史命中        ← isFiltering && searchHistory（:1206-1212）
├── add-tab-bar 新建标签条（常驻）
└── FooterToolbar 底部工具区（常驻）           ← :1221+
```

### 4.2 主体列表分区顺序

`core/site/Sections.ts:10-12`（行为规格）：

```
固定标签区（置顶） → 原生标签组 → 网站聚合组 → 未分组
```

固定空间的排除（文件夹挂起 / 绑定标签）由 `excludedTabIds` 传入（`Sections.ts:12`；`App.tsx:467-475` 构造 `fixedExcludedTabIds`）。

### 4.3 分区类型

| kind | 说明 | 证据 |
|------|------|------|
| `pinned` | 浏览器原生固定标签 | `Sections.ts:16` |
| `native` | 原生标签组（含 `depth` 用于来源树缩进） | `Sections.ts:17-27` |
| `site` | 网站聚合组（含 `mergedGroupIds`，同站点归并） | `Sections.ts:28-41` |
| `ungrouped` | 未分组兜底 | `Sections.ts:42-49` |

### 4.4 底部工具区三组

`FooterToolbar.tsx:86-198`，用 `GroupDivider` 分隔：

1. **视图与组织**：命令面板 / 折叠全部 / 快速整理 / 定位激活 / [条件] 清理重复 / [条件] 关闭选中
2. **内存管理**：休眠全部 / [条件] 唤醒全部
3. **记录与恢复**：快照空间（徽章=快照数）/ 撤销历史（徽章=批次数）/ 设置

---

## 5. 功能规格

### 5.1 标签视图

| 能力 | 规格 | 证据 |
|------|------|------|
| 聚合模式 | `site` 按网站（默认）/ `opener` 来源树 / `language` 按语言 | `models.ts:131` |
| 聚合阈值 | `aggregationThreshold` 1–5，默认 2 | `models.ts:95-96` |
| 排序方式 | `browser` 原生顺序（默认）/ `recency` 最近访问 | `models.ts:123` |
| 来源树健壮性 | 迭代式 DFS（防递归溢出）；opener 自引用按根处理；成环节点补为 depth 0 根，**保证任何标签都不会从侧边栏消失** | `Sections.ts:89-101` |
| 列表密度 | `compact` / `cozy`（默认）/ `large`（低视力档位） | `models.ts:104` |
| 状态徽章 | n× 重复计数、静音、拆分视图「拆/伴」标记、休眠灰化、可听绿点 | `StatusBadges.tsx`；`models.ts:111` |
| 分屏组括号 | 同一 `splitViewId` 的连续段 → 组首/组中/组尾，视觉连成左括号 | `splitGroupRoles.ts` |

**TabRecord 字段**（`core/tab-types.ts`）：id / windowId / index / active / pinned / incognito / url / pendingUrl / title / favIconUrl / status / discarded / muted / audible / groupId / splitViewId / lastAccessed / autoDiscardable / openerTabId / attention / language。

### 5.2 搜索

| 能力 | 规格 | 证据 |
|------|------|------|
| 匹配目标 | 标题 / URL / 拼音首字母（三目标，取最高分） | `SearchEngine.ts:190-234` |
| 拼音 | `pinyinSearch` 默认开；词典按需动态加载，就绪后触发重算 | `models.ts:157`；`popup/App.tsx:79-100` |
| 键盘导航 | `↑↓` 漫游、`Enter` 激活、`Esc` 清空并失焦 | `useListNavigation.ts`；`SearchBar.tsx:50-56` |
| 命中高亮 | 按索引分段高亮，纯文本、渲染层转义 | `SearchEngine.ts:227-233` |
| 读屏播报 | `<output aria-live="polite">` 播报命中数 | `App.tsx:1054-1057` |
| 跨窗口 | `searchAllWindows` 默认关（尊重「只管当前窗口」原则） | `models.ts:179` |
| 时间线搜索 | `searchHistory` 默认开；命中最近 20 份快照与归档条目 | `models.ts:158-164` |
| 键盘提示 | 仅聚焦时显示，不常驻占位 | `SearchBar.tsx:34-35,88-92` |

**性能基线**（`tests/perf/search-perf.test.ts:82-109`）：150 标签单次查询中位数 < 100ms；500 标签 < 300ms。

### 5.3 组织（固定空间）

#### 常驻磁贴（pins）
- 身份归一化（`core/fixed/PinIdentity.ts`）
- 单击切换 / 重新打开；**中键仅关闭页面、入口保留**（`PinnedStrip.tsx:17-18`）
- 上限 `PINS_LIMIT = 200`（`models.ts:39`）
- 拖到磁贴条即固定（`PinnedStrip.tsx:29-33` `useDroppable`）

#### 固定文件夹（folders）
- CRUD / 拖放排序 / 挂起转正 / 一键打开全部 / 导出到书签（`README.md` 功能一览）
- 单夹条目上限 `FOLDER_ITEMS_LIMIT = 500`；夹数上限 `FOLDERS_LIMIT = 200`（`models.ts:33,36`）
- 挂起条目：`pendingTabId` 表示「组内新建后等待真实导航的标签 id」（`models.ts:64-65`）
- 从书签栏导入文件夹（`importBookmarksFromBar`）
- 固定空间区域是 `useDroppable` 目标，拖到空白处 → `PromptDialog` 命名建夹（`FixedArea.tsx:49-72`）
- 折叠：文件夹 > 5 时首次自动折叠，用户手动切换后遵循用户选择（`FixedArea.tsx:34-37`）
- 空态：显示 `fixed.emptyHint` + [条件] 概念一览卡（`FixedArea.tsx:110-129`）

#### 工作空间（space）
- 命令面板键入文件夹名 → 「打开全部」补开缺失条目（`App.tsx:905-927`）
- `SpaceStrip` 切换条；`activeSpaceId` 仅为 id 引用，空间删除后按「找不到即视为未激活」容错（`models.ts:221-225`）

### 5.4 拖拽整理

| 能力 | 规格 | 证据 |
|------|------|------|
| 可拖对象 | 标签 / 常驻磁贴 / 分组头 / 文件夹条目 | `README.md` 功能一览 |
| 传感器 | `PointerSensor` 激活距离 4px；`KeyboardSensor` 专用手柄（Space 抓取 + 方向键） | `DndRoot.tsx:29-31` |
| 碰撞检测 | 关闭让位过渡（`transition: null`），保证落点与所见一致 | `TabRow.tsx:97-101` |
| 跨容器 | 拖到固定空间/文件夹/顶部磁贴条 | `useTabDragHandlers.ts` |
| 去重 | 拖入时重复 URL 自动去重 | `README.md` |
| 排序阻断 | `sync-off` 静默；`recency` 显式 `notify('tabs.orderLockedBySortMode')` | `reorderCapability.ts:38-45`；`useTabDragHandlers.ts:108-117,234-243` |
| 键盘重排 | `Alt+↑/↓`，与拖拽共用同一道闸门 | `TabRow.tsx:159-170`；`useTabDragHandlers.ts:104-127` |
| 虚拟化上限 | 排序关闭 >60 行、排序开启 >120 行虚拟化；超阈值时 `canReorder=false` 并提示 | `sectionCards.tsx:22-25,109-115`；`TabRow.tsx:106-110` |
| 不可行组合 | 持久 pin ↔ 浏览器置顶磁贴互拖 → `notify('fixed.pinCrossSortUnsupported')` | `useTabDragHandlers.ts:400-404` |
| 读屏播报 | dnd-kit `Announcements` + `ScreenReaderInstructions` | `DndRoot.tsx:14-21` |

### 5.5 安全网（核心差异化）

#### 撤销栈
- 深度 `undoStackLimit`，默认 10，范围 5–50，FIFO 淘汰（`models.ts:136-137`）
- **v1.1 起覆盖「关闭」与「快照恢复」两条路径**：恢复后本次新建的标签以 `kind='restore'` 入栈，撤销即关闭这批（⌘Z 可再开回来）。原「只覆盖关闭」的表述已随 R8 更新
- **恢复成功才出栈**（`undoStore.ts:206-248`）；失败项重入栈顶可重试（`:244-245`）
- 执行互斥：`undoInFlight` 页内 + `withCrossPageLock(UNDO_EXEC_LOCK)` 跨页 + 锁内按磁盘复核（`:105-114,417-438`）
- 写盘串行：`undoPersistChain`，内容一律「磁盘基线 + 本页意图」（`:125-164`）
- 跨重启持久化 `persistUndo` 默认开（`models.ts:166`）
- 归档也进撤销栈：`recordClosedBatch(..., 'archive', ...)`（`snapshotStore.ts:195`）
- 批次来源标签：`kindClose` 手动关闭 / `kindArchive` 窗口归档（`UndoHistoryPanel.tsx:36-40`）

#### 重做栈
- 撤销成功后压入「本次真正恢复成功的条目」（`undoStore.ts:250-258`）
- **任何新的关闭批次入栈即清空重做栈**（`:293-299`）
- 按 URL 匹配当前窗口标签（非 tabId，关闭后即失效），固定标签豁免（`UndoStack.ts:78-102`）
- 重做结果**重新入撤销栈**，可再次撤销（`undoStore.ts:540-547`）

#### 栈外兜底三层
1. 本产品撤销栈
2. 浏览器 `chrome.sessions` 最近关闭（`UndoHistoryPanel.tsx:59-73,156-190`）
3. 快照引导 `snapshots.crashGuidance`（`:105-114`）

#### 快照
| 能力 | 规格 | 证据 |
|------|------|------|
| origin | `manual` 命名 / `auto` 关窗自动 / `archive` 归档 / `space` 工作区 | `models.ts` SnapshotSchema |
| 自动快照 | `autoSaveSnapshots` 默认开；关窗 + 定时双触发 | `models.ts:145`；`autoSnapshot.ts:10-16` |
| 定时去重 | 现场指纹（URL 集合+顺序）相同则跳过写入 | `autoSnapshot.ts:18-31` |
| 保留上限 | 自动 `maxAutoSnapshots` 默认 10；命名 `snapshotLimit` 默认 30 | `models.ts:149,151` |
| 单快照上限 | `SNAPSHOT_TABS_LIMIT = 1,000`；族上限 `SNAPSHOTS_LIMIT = 200` | `models.ts:56,59` |
| 恢复预览 | `snapshotDiff` 三分类（将新建 / 已存在 / 不恢复）+ 计数摘要 | `SnapshotsPanel.tsx:96-105` |
| 选择性恢复 | 默认全选，勾选是「从完整恢复里剔除若干条」 | `SnapshotsPanel.tsx:70-75,109-129` |
| 恢复确认 | `RestoreConfirmDialog` 展示「将打开 N 个标签（含 M 个分组）」 | `RestoreConfirmDialog.tsx:24-37` |
| 恢复可撤销（v1.1） | 恢复后把本次**新建**的标签以 `kind='restore'` 入撤销栈；撤销该批次 = 关闭这批标签，⌘Z 可再开回来 | `snapshotStore.restore` + `recordRestoreForUndo`；`UndoHistoryPanel.kindLabel` |
| 删除确认 | `ConfirmDialog`，注释「删除不可撤销，必须二次确认」 | `SnapshotsPanel.tsx:61-62,651-660` |
| 一致性约束 | `tabCount === tabs.length`（防导入数据漂移） | `models.ts` SnapshotSchema refine |
| 导入 | OneTab 文本 / Workona JSON（1MB 上限，仅 http(s)，超 `SNAPSHOT_TABS_LIMIT` 静默截断） | `workonaImport.ts:9-29` |

#### 习惯洞察（P-05）
- 三类：重复重灾区（同页面 ≥ 2 份，www 归一化）/ 休眠候选（`canSafelyDiscardTab` 且未绑定）/ 7 天滞留预警
- Top N = 5；纯本地计算、零上报、不落盘（`tabInsights.ts:1-26`）
- 渲染位置：快照面板「周报」页签（`SnapshotsPanel.tsx:341,449-509`）
- 三个出口直接复用既有 handler：清理重复 / 一键休眠 / 归档窗口（`SnapshotsPanel.tsx:24-29`）

### 5.6 休眠与资源

| 能力 | 规格 | 证据 |
|------|------|------|
| 手动休眠 | 行内 snowflake 按钮；激活/已休眠标签不显示该按钮 | `TabRow.tsx:217-226` |
| 批量休眠 | `selectSleepableTabs` 口径，徽章与执行同源 | `App.tsx:96`；`FooterToolbar.tsx:148-156` |
| 自动休眠 | `autoDiscardEnabled` 默认关；`autoDiscardMinutes` 5–240 默认 30 | `models.ts:127,129` |
| 白名单 | `discardWhitelist`，上限 500，hostname 长度 ≤ 253 | `models.ts:174-177`；`models.ts:33,45` |
| 可撤销 | 台账落盘后发 `auto-discarded` 消息，面板提供「全部唤醒」；**台账写失败时不发可撤销消息**（避免「点不动」） | `autoDiscard.ts:15-27` |
| 安全判定 | `canSafelyDiscardTab`（排除激活/播放/固定等） | `core/tab-types.ts` |

### 5.7 快捷入口

| 入口 | 规格 | 证据 |
|------|------|------|
| 右键菜单 | 页面 / 链接 / 标签栏 / 工具栏图标四类；`contextMenusEnabled` 默认开 | `contextMenus.ts:15-28`；`models.ts:187` |
| 地址栏 `t` 命令 | `omnibox: { keyword: 't' }`；建议：已打开标签（置顶）/ 文件夹 / 常驻磁贴 / 站内搜索；`omniboxEnabled` 默认开 | `wxt.config.ts:26`；`omnibox.ts:28-40` |
| omnibox 转义 | `escapeSuggestionText` 转义 `<>&`（Chrome 把 description 当受限 XML 解析，导入的备份名可含 `<url>`） | `omnibox.ts:15-24` |
| 工具栏角标 | `auto`（有重复显重复数 / 否则显标签数）/ `count` / `dups` / `off`；`off` 时跳过全量 query | `models.ts:185`；`badge.ts:9-14` |
| 图标点击 | `actionClickMode`：`panel` 开侧边栏（默认）/ `regroup` 后台整理不弹面板 | `models.ts:135`；`actionRegroup.ts:9-12` |
| 浏览器命令 | `focus-search` Ctrl+Shift+F / `open-panel` Ctrl+Shift+O / `locate-active` Ctrl+Shift+L / `discard-inactive` Ctrl+Shift+U | `wxt.config.ts:43-58` |
| 面板快捷键 | `⌘/Ctrl+P` 命令面板 / `⌘/Ctrl+J` 定位激活 / `⌘/Ctrl+K` 搜索 / `⌘/Ctrl+Z` 撤销；模态打开时短路；输入框内 `⌘Z` 让位原生文本撤销 | `useGlobalHotkeys.ts:4-6,36-73` |
| 命令面板 | 命令 + 标签切换 + 文件夹空间三组漫游；空查询标签项上限 20（含 Favicon 有真实渲染成本） | `CommandPalette.tsx:52-53,107-111` |

### 5.8 重复治理

- **一键清理重复**：每网址保留「激活 > 固定 > 位置靠前」的一个；固定标签与固定空间绑定条目豁免；走 `closeWithUndo` **可撤销**
- `planDuplicateCleanup` 是模块级纯函数，徽章计算与执行动作共用，**保证口径一致**（`App.tsx:66-90`）
- 清理后对保留项播放脉冲高亮，让「保留了谁」可见（`App.tsx:645-646,660`）
- **同网址唯一化**（`uniqueUrlTabs` 默认开）：新建已存在 URL 时切到最近访问的既有标签，其余关闭
- **keeper 口径已统一（v1.1 / R7）**：`KeeperPolicy.select` 现委托 `rankForKeep`，全应用唯一口径为**最近访问 > 激活 > 固定 > 位置靠前 > id 大**；原「勿混用」警示已删除。`duplicates.cleanConfirm` 文案显式说明保留规则。属**行为变更**：组内「激活/位置靠前」者不是「最近访问」者时，清理保留项会变（可撤销）

### 5.9 数据

| 能力 | 规格 | 证据 |
|------|------|------|
| 导出 | 完整备份 JSON：固定空间 + 常驻磁贴 + 折叠态 + 设置 + 全部快照族 + 稍后读；`format: 'tabs.export'`，`EXPORT_FILE_VERSION = 2` | `models.ts` ExportFileSchema |
| 导入 | **事务式**，失败整体回滚；体积上限 5MB；格式不符即拒绝 | `SettingsPage.tsx:38-39,115` |
| 导入互斥 | 与清空事务互斥；导入期间固定空间只读，拖拽写入挂起 | `context.ts:25-28,102-108` |
| 版本策略 | 未来版本被字面量拒绝（宁可提示升级，不让旧代码误读新字段） | `models.ts` ExportFileSchema 注释 |
| 跨设备镜像 | 分块存储（每块 6000 字节，防 8KB/项配额）；镜像 30 天无更新视为过期；超配额静默降级 | `SyncMirror.ts:19-22` |
| 镜像 TTL | `MIRROR_TTL_MS = 30 天` | `SyncMirror.ts:22` |
| 清除数据 | 顺序：先清 sync 再清 local（防 `seeded` 标志清空后从旧镜像复活） | `settingsSlice.ts:123-131` |
| 存储键 | 带版本后缀，如 `Tabs.fixed-folders.v1`、`tabs.redo-stack.v1`、`tabs.diagnostics.v1` | `PRIVACY.md:48`；`registry.ts:73`；`diagnostics.ts:23` |

### 5.10 稍后读（ReadLater）

- 上限 `READLATER_LIMIT = 200`，超限**淘汰最旧**（不能 `slice(0,limit)`，新条目追加在末尾）
- 与「当前有几个标签」正交，故放在状态三元之外；位置在主体列表之前（`App.tsx:1147-1157`）
- 陈旧归档：`core/readlater/staleness.ts`

---

## 6. 状态与边界设计

### 6.1 主体列表四态

`App.tsx:1158-1192`

| 状态 | 条件 | 呈现 | 动作 |
|------|------|------|------|
| 加载中 | `!dataReady && !loadFailed` | `LoadingSkeleton`（结构对齐真实列表，加载完不跳版） | — |
| 加载失败 | `!dataReady && loadFailed` | `LoadErrorState` | 「重试」→ `handleRetryLoad`（`App.tsx:613-617`） |
| 空窗口 | `dataReady && tabs.length === 0` | `EmptyTabs` | 「新建标签」→ `createPlainNewTab` |
| 搜索无结果 | `isFiltering && filteredTabs.length === 0` | `NoSearchResults` | 「清空搜索」 |

### 6.2 持久化降级

- 按**分区**记账（`FOLDERS_SCOPE` / `PINS_SCOPE` / `BINDINGS_SCOPE`），非单一全局布尔（`context.ts:64-97`）
- 理由（注释）：「若『任一分区写成功就复位全局标志』，一次 settings 写失败会被随后一次 folders 写成功悄悄抹掉」
- UI：`storageDegraded` 时顶部 `role="alert"` 横幅（`App.tsx:1058-1071`）
- 语义：表达「**此刻存储可能不可写**」，而非「历史上有过失败」（注释：「宁可多提示一次，也不能让『界面显示成功、重启即丢』静默发生」）

### 6.3 反馈分级

| 级别 | 通道 | 证据 |
|------|------|------|
| 普通成功 | `notify()` → `role="status"` / `aria-live="polite"` | `StatusToast.tsx:15-25` |
| 失败 | `notifyError()` → `role="alert"` / `aria-live="assertive"` + 危险色 | `StatusToast.tsx:15-25`；`undoStore.ts:41-47` |
| 可撤销 | toast 带「撤销」按钮（`canUndo` + `batchId`） | `StatusToast.tsx:28-32` |
| 自定义动作 | toast 带动作按钮（如自动休眠「全部唤醒」、撤销后「重做」） | `undoStore.ts:30-34,275-279` |
| 无候选 | **必须显式告知**，禁止静默（如 `duplicates.cleanNone`、`footer.quickRegroupNone`） | `App.tsx:654-657,817-819` |

toast 显示时长 `toastDurationSec` 3–15 秒，默认 7（`models.ts:153`）。

### 6.4 首启引导

- `OnboardingTour` 3 步：列表已就绪 / 固定空间 / 键盘直达 + 功能清单
- **延迟 0.9s 弹出**，让用户在模态遮罩前先看到真实列表（`App.tsx:436-439`）
- **延迟窗口内用户一旦开始操作（pointerdown/keydown）即放弃本次弹出**（`:440-462`）
- `Esc` 走 `onDismiss` **不落盘**，下次打开仍可再看（`OnboardingTour.tsx:14-15,61-67`）
- 完成后一次性写回 `onboarded + tipSeen + conceptsSeen`（`App.tsx:1291-1293`）
- 无遮罩点击关闭（注释：「避免误点直接写回 onboarded 标记」）

---

## 7. 数据与存储模型

### 7.1 分层约束（改动前必读）

1. `core/**` 不得出现 `chrome.*` / `browser.*` / DOM / React，也不得 import `platform/**`
2. `platform/**` 是唯一触碰 `chrome.*` 的层，`ui/**` 不得绕过它
3. 所有持久化数据必须经 `core/schema` 的 zod schema 校验，**坏数据隔离而非静默丢弃**
4. 权限清单冻结在 `wxt.config.ts` 与 `PRIVACY.md`，新增权限须先改这两处并通过 `pnpm check:privacy`

（来源：`README.md` 架构节）

### 7.2 持久化仓库

`platform/registry.ts:73`：folders / pins / collapse / settings / snapshots / undo / redo / autoDiscard / readLater / diagnostics

### 7.3 体积上限（防导入攻击面）

`models.ts:33-62`

| 常量 | 值 | 说明 |
|------|-----|------|
| `FOLDER_ITEMS_LIMIT` | 500 | 单文件夹条目 |
| `FOLDERS_LIMIT` | 200 | 固定文件夹数 |
| `PINS_LIMIT` | 200 | 常驻磁贴 |
| `SITE_COLLAPSE_LIMIT` | 2,000 | 折叠站点记录 |
| `DISCARD_WHITELIST_LIMIT` | 500 | 休眠白名单 |
| `HOST_MAX_LENGTH` | 253 | hostname（DNS 标签总长上限） |
| `UNDO_BATCH_ENTRIES_LIMIT` | 1,000 | 单撤销批次条目 |
| `DEFAULT_UNDO_STACK_LIMIT` | 10 | 撤销栈默认深度 |
| `SNAPSHOT_TABS_LIMIT` | 1,000 | 单快照标签数 |
| `SNAPSHOTS_LIMIT` | 200 | 快照族总条数 |
| `READLATER_LIMIT` | 200 | 稍后读条目 |

**设计原则**（`models.ts:18-30`）：集合必须有显式上限（导入的备份可被任意构造）；**自由文本字段刻意不加逐字符串上限**——registry schema 一旦收严，存量超限用户的真实数据会在读盘时被判为坏数据而清空。

### 7.4 设置项（46 字段，`models.ts:88-228`）

按 UI 分组：

**外观（appearance）**
| 字段 | 类型 / 默认 | 说明 |
|------|------------|------|
| `themePreference` | system / light / dark，默认 `system` | 主题三态 |
| `colorTheme` | plain / forest / ocean / violet / sunset / mono，默认 `plain` | 色号取自 `core/theme/colorThemes` 唯一来源 |
| `showPinnedStrip` | bool，默认 `true` | 顶部常驻磁贴条 |
| `density` | compact / cozy / large，默认 `cozy` | large = 低视力可读性档位 |
| `showUrl` | bool，默认 `false` | 标题下方显示完整网址 |
| `footerLabels` | bool，默认 `true` | 底栏图标旁显示名称（窄面板自动退回纯图标） |
| `showSplitBadges` | bool，默认 `true` | 分屏「拆/伴」标记 |
| `groupAccentStyle` | auto / mono，默认 `auto` | 站点组强调色 |

**行为（behavior）**
| 字段 | 类型 / 默认 | 说明 |
|------|------------|------|
| `language` | string(2–32)，可选 | 语言覆盖（BCP-47）；运行时切换，缺省由浏览器语言决定 |
| `autoScrollActive` | bool，默认 `true` | 切换标签时滚动进可视区 |
| `closeOnMiddleClick` | bool，默认 `true` | 中键关闭标签 |
| `newTabPosition` | end / after-active，默认 `end` | 新建标签位置 |
| `sortMode` | browser / recency，默认 `browser` | 临时区排序 |
| `showOtherWindows` | bool，默认 `true` | 其他窗口分段（只读 + 聚焦/关闭） |

**能力（capabilities）**
| 字段 | 类型 / 默认 | 说明 |
|------|------------|------|
| `aggregationThreshold` | int 1–5，默认 `2` | 同域名成组阈值 |
| `tabOrderSync` | bool，默认 `true` | 侧边栏拖拽重排写回原生顺序 |
| `autoDiscardEnabled` | bool，默认 `false` | 自动休眠 |
| `autoDiscardMinutes` | int 5–240，默认 `30` | 自动休眠等待时长 |
| `discardWhitelist` | string[] ≤500，默认 `[]` | 永不自动休眠的 hostname |
| `groupMode` | site / opener / language，默认 `site` | 非固定标签聚合模式 |
| `autoGroupNative` | bool，默认 `false` | 自动创建浏览器原生组（关闭会解散本功能创建的组） |
| `actionClickMode` | panel / regroup，默认 `panel` | 工具栏图标点击行为 |
| `uniqueUrlTabs` | bool，默认 `true` | 同一网址只保留一个标签 |
| `pinyinSearch` | bool，默认 `true` | 拼音首字母匹配 |
| `searchHistory` | bool，默认 `true` | 时间线搜索（命中最近 20 份快照与归档） |
| `searchAllWindows` | bool，默认 `false` | 搜索范围扩展到所有窗口 |
| `rowActionsVisible` | bool，默认 `false` | 行操作按钮常显 |
| `discardNotifyEnabled` | bool，默认 `true` | 自动休眠系统通知 |
| `reuseNotifyEnabled` | bool，默认 `true` | 重复合并状态提示 |
| `badgeMode` | auto / count / dups / off，默认 `auto` | 工具栏角标 |
| `contextMenusEnabled` | bool，默认 `true` | 右键菜单总开关 |
| `omniboxEnabled` | bool，默认 `true` | 地址栏 `t` 命令 |
| `noCacheEnabled` | bool，默认 `false` | 开发者：指定站点禁用前端缓存（需网站访问权限） |
| `noCachePatterns` | string[] ≤限制，默认 `[]` | 禁缓存站点；**归一化在 schema 层完成**，非法项丢弃 |

**安全网**
| 字段 | 类型 / 默认 | 说明 |
|------|------------|------|
| `undoStackLimit` | int 5–50，默认 `10` | 撤销栈深度 |
| `persistUndo` | bool，默认 `true` | 撤销记录跨重启持久化 |
| `autoSaveSnapshots` | bool，默认 `true` | 关窗 + 定时自动快照 |
| `autoSnapshotIntervalMin` | int 5–720，默认 `30` | 定时快照间隔 |
| `maxAutoSnapshots` | int 1–50，默认 `10` | 自动快照保留数 |
| `snapshotLimit` | int 1–100，默认 `30` | 命名快照保留数 |
| `toastDurationSec` | int 3–15，默认 `7` | 状态提示条时长 |

**数据与内部状态**
| 字段 | 类型 / 默认 | 说明 |
|------|------------|------|
| `syncMirrorEnabled` | bool，默认 `false` | 跨设备镜像（浏览器账号通道） |
| `activeSpaceId` | string，可选 | 当前激活工作空间（仅 id 引用） |
| `onboarded` / `tipSeen` / `conceptsSeen` | bool，默认 `false` | 引导与提示的已读标记 |

**默认值单一来源**：`DEFAULT_SETTINGS` 由 `SettingsSchema` 直接派生，不手抄字段（`models.ts:231-234`，注释：「手抄的代价是『加设置忘了改默认值』」）。

---

## 8. 权限与隐私

### 8.1 权限清单（`wxt.config.ts:28-45`）

| 权限 | 用途 | 出境 |
|------|------|------|
| `tabs` | 读取与操作标签 | 否 |
| `tabGroups` | 原生标签组读写 | 否 |
| `storage` | 本地存储；镜像走 `chrome.storage.sync` | 否（仅本地） |
| `alarms` | 定时自动快照 / 自动休眠 | 否 |
| `contextMenus` | 右键菜单 | 否 |
| `omnibox` | 地址栏 `t` 命令 | 否 |
| `sessions` | 浏览器最近关闭列表 | 否 |
| `bookmarks` | 书签栏导入文件夹、导出到书签 | 否 |
| `notifications` | 自动休眠通知 | 否 |
| `declarativeNetRequest` | 开发者禁缓存（改响应头） | 否 |
| `sidePanel` | WXT 自动追加 | 否 |
| `<all_urls>` | **optional_host_permissions**，按需请求 | 否 |

### 8.2 隐私承诺

- 无自有服务器、无自有账号、无遥测、**零出站网络请求**（`README.md:7`；`PRIVACY.md:9-16`）
- 主存储 `chrome.storage.local`，键名带版本后缀（`PRIVACY.md:48`）
- 准确表述应为「无自有账号、无自有服务器」；「数据永不离开设备」**并不准确**——开启浏览器同步时镜像数据会经浏览器厂商通道传输（`PRIVACY.md:15`）
- 隐身标签一律排除，面板不得明文展示（`useOtherWindows.ts:61-63`）
- **安全设计基线**（`SECURITY.md:34-41`）：零出站网络 / 权限最小化且冻结 / 不收集遥测 / 数据不出设备（除非主动开启同步）——均声明为「刻意设计，不属于漏洞」
- **漏洞报告**：经 Security Advisories 私下报告（禁止公开 issue），7 天确认、14 天评估、高危尽力 30 天修复（`SECURITY.md:14-32`）
- **不在范围内**（`SECURITY.md:43-48`）：需本地管理员权限的攻击、浏览器自身漏洞、已停止支持版本、诱导用户手动导入恶意备份文件（已用 schema 校验尽力收敛）
- 诊断日志**主动脱敏** `redactUrls`，不记录标签标题与 URL（`diagnostics.ts:6-8,60-73`）

### 8.3 信任面板（关于页）

`AboutPage.tsx:200-225`：12 项权限逐条用途说明 + 数据存放位置 + **DevTools 零网络请求自验证教程**。设计意图（注释）：「把『零网络』从文档承诺变成可见功能」「不要求信任声明，教会用户验证」。

---

## 9. 可达性（Accessibility）

| 能力 | 规格 | 证据 |
|------|------|------|
| 标题层级 | `<h1 class="sr-only">` 补侧边栏标题（此前完全缺失） | `App.tsx:1037-1040` |
| 实时播报 | 命中数 `<output aria-live="polite">` | `App.tsx:1054-1057` |
| 反馈分级 | 错误 `role="alert"` + assertive；普通 `role="status"` + polite | `StatusToast.tsx:15-25` |
| 命中区 | 图标按钮 `min-h-6 min-w-6`（≥24px，WCAG 2.5.8）；禁用态 opacity 50 | `IconButton.tsx:47-53` |
| 引导进度点 | `button` + `aria-label` + `aria-current`；`tour-dot` 透明扩区撑到 ≥24px | `OnboardingTour.tsx:132-148` |
| 弹窗契约 | 打开聚焦首项 / Tab 焦点陷阱 / Esc 取消 / 关闭后焦点恢复 / `aria-modal` | `Dialog.tsx:9,48-140,168-169` |
| 折叠态 | `aria-expanded`（`SectionHead.tsx:31,80`） | |
| 拖拽 | dnd-kit `Announcements` + `ScreenReaderInstructions` + 键盘专用手柄 | `DndRoot.tsx:14-21`；`SectionHead.tsx:62-74` |
| 减少动效 | `prefers-reduced-motion` 下 `scrollIntoView` 用 `auto` | `TabRow.tsx:139-143`；`main.css:822` |
| 强制色彩 | `@media (forced-colors: active)` | `main.css:841` |
| 无 hover | `@media (hover: none)` | `main.css:1476` |
| 重复标签规避 | 「其他窗口」不设外层 `aria-label`（下方可见标题已提供可访问名） | `OtherWindowsSection.tsx:47` |
| 字号纪律 | 正文说明 ≥ 11px（`text-2xs`），`text-3xs` 仅限图标内文/徽角；由 design-tokens 守卫强制 | `CommandPalette.tsx:92-93` |

---

## 10. 视觉与主题

| 能力 | 规格 | 证据 |
|------|------|------|
| 主题三态 | system / light / dark | `models.ts:94` |
| 色号预设 | plain / forest / ocean / violet / sunset / mono；色号唯一来源 `core/theme/colorThemes` | `models.ts:92`；`settingSections.tsx:6,159-166` |
| 应用路径 | `ThemeApplier` 写 `root.dataset.theme` / `dataset.hue`；`theme-init.ts` 头部同步防闪烁 | `ThemeApplier.ts:41-52` |
| 站点强调色 | `groupAccentStyle: auto` 按域名/favicon 自动配色 | `models.ts:113`；`ui/tabs/accent.ts` |
| 固定空间标识 | 标题前品牌色条（不用容器边框），与临时分组区分 | `FixedArea.tsx:84-87` |
| 响应式 | `container-type: inline-size`；`@container (max-width: 360px/300px)` 下 `.icon-btn-label-keep` 退化为纯图标 | `main.css:491,1865-1900` |
| 空态规范 | 「说明原因 + 提供下一步操作」 | `EmptyState.tsx:4-6` |

### 10.1 国际化（双轨道）

| 轨道 | 文件 | 消费方 | 语言决策链 |
|------|------|--------|-----------|
| **UI 轨道** | `i18n/index.ts` | React 形态（sidepanel/popup/options/about） | `settings.language` → 浏览器 UI 语言 → `zh-CN` 兜底 |
| **Headless 轨道** | `i18n/headless.ts` | background SW（不引 react-i18next，避免把 React 拉进 SW bundle） | 同上，且订阅 `settingsRepository.watch` 实时跟随 |

- 两条轨道**共用同一份 locale 资源文件**（`locales/{zh-CN,en}/translation.json`）
- UI 侧语言覆盖由 `SettingsSync.tsx:13,22-26` 执行 `i18n.changeLanguage(language)` 并同步 `<html lang>`（读屏音系与字体渲染跟随）
- SW 侧由 `initHeadlessI18n()`（`headless.ts:42-55`）读取设置并 watch 变更；读取失败保持浏览器语言兜底
- manifest / 商店文案走浏览器原生 `_locales` 机制（`default_locale: 'en'`，`wxt.config.ts:24`），与 UI 轨道分离

### 10.2 主题应用路径

```
theme-init.ts（各入口 main.tsx 首个 import，同步执行防首屏闪烁）
  → 读 localStorage 镜像键 tabs:theme / tabs:theme-hue
  → 内联色号白名单 VALID_HUES: Record<ColorTheme, true>（编译期校验漏加/多加）
  → 写 documentElement.dataset.{themePreference,theme,hue}
     ↓
ThemeApplier.ts（权威路径，异步）
  → 读 chrome.storage 设置 → applyTheme(preference, colorTheme)
```

`theme-init.ts` 只用 `import type`（编译期擦除）——注释：「本脚本必须同步执行完才能防住首屏闪烁，引入任何运行时模块都有被拆成异步 chunk 的风险」。
色号 id 与展示色值的**唯一权威来源**是 `core/theme/colorThemes.ts`（`COLOR_THEMES` / `COLOR_THEME_IDS`），被 schema（core）、主题应用（platform）、设置页（UI）共同消费；展示文案由设置页以 `Record<ColorTheme, string>` 承接，漏配在编译期报错。

---

## 11. 质量门禁

| 命令 | 作用 |
|------|------|
| `pnpm check` | 聚合门禁：typecheck → lint → check:i18n → check:ui → test → build → check:privacy |

### CI 流程（`.github/workflows/ci.yml`）

触发：push 到 main/master、PR；同分支新推送取消在途任务（`concurrency.cancel-in-progress`）。
Node 22 + pnpm 11.1.3，`pnpm install --frozen-lockfile`。步骤顺序：

```
format:check → typecheck → lint → check:i18n → check:ui → test
→ pnpm audit --audit-level=high → build → check:privacy
```

与本地 `pnpm check` 差异：CI **额外**跑 `format:check` 与 `pnpm audit --audit-level=high`（高危及以上漏洞阻断合并）。
`check:ui` 此前只作为本地脚本存在、从未在 CI 执行（`ci.yml:46-47` 注释：「守卫建了等于没建」），现已纳入。

### 覆盖率棘轮（`vitest.config.ts:44-92`）

阈值按目录分层，取「当前实测值 − 余量」作为**棘轮基线**：锁住既有覆盖不回退，逐迭代收紧。
`core/` 实测 100%，是唯一要求接近满覆盖的层。

| 范围 | lines / statements / branches / functions |
|------|------|
| 全局 | 63 / 58 / 50 / 54 |
| `src/core/**` | 88 / 88 / 72 / 85 |
| `src/platform/*.ts`（直连文件） | 86 / 84 / 76 / 85 |
| `src/platform/**`（含子目录） | 60 / 60 / 55 / 55 |
| `src/entrypoints/background.ts` | 72 / 68 / 56 / 60 |
| `src/entrypoints/background/**` | 86 / 84 / 72 / 72 |
| `src/entrypoints/popup/**` | 80 / 76 / 64 / 76 |
| `src/ui/fixed/**` | 78 / 62 / 70 / 78 |
| `src/ui/dnd/**` | 62 / 48 / 48 / 50 |
| `src/ui/common/**` | 56 / 55 / 54 / 57 |
| `src/stores/*.ts` | 62 / 60 / 64 / 63 |
| `src/stores/data/**` | 66 / 54 / 56 / 68 |

**为什么要单列 `src/platform/*.ts`**（`vitest.config.ts:50-57`）：目录均值会**稀释**个别文件的缺口。
bookmarks / sessions / permissions / navigation 曾实测 0%、`tabs.ts`（589 行）47%，被子目录把均值抬到 70%，
于是它们远低于 60 的阈值却仍然通过。

**棘轮纪律**（`CONTRIBUTING.md:75-76`）：只许收紧，不许放松；改动拉低覆盖率须补测试而非调阈值。

### 测试环境（`vitest.config.ts:12-32`）

- `WxtVitest()` 插件把 `wxt/browser` 别名到 fake-browser 并 stub 全局 `chrome` / `browser`，使平台层可在单测中驱动；
- 默认 `environment: 'node'`，UI/平台层测试在文件顶部以 `// @vitest-environment jsdom` 注释按需切换；
- `isolate: true` + `restoreMocks: true` + `clearMocks: true`（注释：「漏写即造成跨用例的 spy 泄漏——单独跑通过、全量跑失败」）。
| `pnpm typecheck` / `lint` / `test` / `test:watch` | 类型 / 规范 / 测试 |
| `pnpm check:ui` | 设计令牌守卫（未受控调色板 / 字号 / 对比度） |
| `pnpm check:i18n` | 中英文案键集合一致性 + **死键检查**（locale 键必须被 src 源码引用） |
| `pnpm check:privacy` | 隐私回归：权限冻结 + 零网络调用（需先 build） |
| `pnpm build` / `build:compat` / `zip` / `crx` | 构建与打包 |
| `pnpm format` / `format:check` | Prettier |

**死键守卫机制**（`scripts/i18n-dead-keys.mjs:8-15`）：
1. zh-CN 与 en 键集合必须完全一致；
2. 每个键必须在 src 下 `.ts/.tsx` 中出现精确串匹配；
3. 模板串动态拼接的键通过 `DYNAMIC_KEY_PATTERNS` 白名单豁免——新增拼接点必须同步登记。

**已知盲区**：守卫只能证明「键被源码引用」，无法证明「功能对用户可达」（详见分析报告 C-3）。

**贡献约定**（`README.md` 参与贡献节）：
- `core/**` 保持零 chrome/DOM/React 依赖，且不 import `platform/**`
- 持久化数据形状变更须同步 `core/schema`（新增存储类型还须同步 `PRIVACY.md` 第 3 节）
- 新增权限须同时改 `wxt.config.ts` 与 `PRIVACY.md`
- 新增 UI 文案须同时补 zh-CN 与 en 两份 locale
- **校验写在 schema 层，不只做在 UI 输入处**（`CONTRIBUTING.md:44-50`）——备份导入会绕过 UI。历史事故：`noCachePatterns` 只在设置页编辑器归一化，导致一份含 `https://*` 的备份就能生成覆盖全部 HTTP(S) 流量的 DNR 规则
- **导出备份格式单一**（`CONTRIBUTING.md:69-70`）：`z.literal(EXPORT_FILE_VERSION)` 校验，版本不同即拒绝导入，**不做跨版本兼容**；改动格式须递增 `EXPORT_FILE_VERSION`
- 提交信息用 Conventional Commits、描述用中文；不接受 lint-disable 注释、不接受为绕过门禁修改 ESLint/Prettier/覆盖率配置（`CONTRIBUTING.md:80-94`）

---

## 12. 仍未实现 / 规划中（v1.1 更新）

> 本节列出**尚未实现**的内容，避免与正式功能混淆。以下条目**在 `src/` 中无对应实现代码**。

| 条目 | 状态 | 依据 |
|------|------|------|
| — | ~~重做（redo）的常驻 UI 入口~~ → **v1.1 已实现**（R3）：`UndoHistoryPanel` 常驻「重做」按钮 + `⌘⇧Z` 接线 | 已完成 |
| — | ~~批量破坏性动作的确认 / 预览~~ → **v1.1 已实现**（R1）：快速整理 / 清理重复加确认闸门（带影响面），分区关闭 title 带数量 | 已完成 |
| — | ~~快照恢复的可逆性~~ → **v1.1 已实现**（R8，方案 B）：恢复后把本次新建的标签以 `kind='restore'` 入撤销栈；`UndoHistoryPanel.kindLabel` 支持该 kind | 已完成 |
| — | ~~卸载挽留（`setUninstallURL`）~~ → **v1.1 已实现**（R4）：`background.ts` 双处注册，指向 `public/uninstall.html` 静态页（样式内联、无参数回传） | 已完成 |
| — | ~~标签行右键上下文菜单~~ → **v1.1 已实现**（R12）：新增 `ui/common/ContextMenu.tsx`，`TabRow` 接 `onContextMenu` | 已完成 |
| — | ~~popup 形态的加载态 / 错误态~~ → **v1.1 已实现**（R9）：新增 `popup/PopupListStates.tsx` | 已完成 |
| — | ~~「其他窗口」分段的加载态 / 失败态~~ → **v1.1 已实现**（R10）：`useOtherWindows` 暴露 `status: loading\|ready\|error` | 已完成 |
| — | ~~主列表空态的「从快照恢复」引导~~ → **v1.1 已实现**（R11）：`EmptyTabs` 加 `hasSnapshots` | 已完成 |
| **兼容变体对外交付** | 构建管道已建成（`wxt.config.ts:66-90`），README 标注随 V2.0 交付 | `README.md:78` |
| **R14 行主按钮拆分角色** | **有意未做**：`RowItem` 已有 `activatorRef` / `buttonAttributes` / `buttonListeners`，dnd-kit 键盘手柄已存在；强行拆分会改变 `PointerSensor` 4px 命中语义与既有快照 → 建议独立重构立项 | 见分析报告 A-2 |
| **R15 分区级虚拟化** | **有意未做**：`SortableContext` 需全量挂载，与行级虚拟化存在根本冲突；改分区级属结构性重构 → 建议独立立项。v1.1 只完成滚动边界提示 | 见分析报告 P-1 |
| **R5 撤销历史可达性进一步补全** | 未立项：R3 已提供常驻入口与 `⌘⇧Z`，待观察实际使用后再定 | 见分析报告 IA-1 |
| **Chrome Web Store 上架** | README 标注「待上架」 | `README.md:20` |

---

## 13. 关键设计决策（Design Decisions）

| # | 决策 | 理由 | 证据 |
|---|------|------|------|
| DD-1 | 撤销栈覆盖「关闭」，**v1.1 起也覆盖快照恢复**（R8） | 原决策：恢复是「新建」，语义不同，边界靠确认闸门补偿。v1.1 改为：恢复后把新建标签记为 `kind='restore'` 批次，撤销栈既有语义（撤销 = 重新打开已关闭的标签）恰好能让它们再开回来，语义自洽 | `RestoreConfirmDialog.tsx` 顶部注释；`snapshotStore.restore` |
| DD-2 | **恢复成功才出栈**，失败项重入栈顶 | 提前乐观出栈会让用户在失败时「既没拿回标签又失去重试入口」 | `undoStore.ts:206-248` |
| DD-3 | 重做**按 URL 匹配**而非 tabId | 关闭后 tabId 即失效，恢复出来的是新 id | `UndoStack.ts:78-102` |
| DD-4 | 新关闭批次入栈**即清空重做栈** | 重做只对「最近一次撤销」有意义，否则会去关无关的标签 | `undoStore.ts:293-299` |
| DD-5 | 持久化降级**按分区记账** | 单一全局布尔会让「一次 settings 失败被一次 folders 成功悄悄抹掉」 | `context.ts:64-97` |
| DD-6 | 集合有**显式体积上限**，自由文本不限 | 导入的备份可被任意构造；自由文本由 storage 配额天然封顶，收严会清空存量数据 | `models.ts:18-30` |
| DD-7 | 保护性能力**默认全开**（自动快照 / persistUndo / 时间线搜索） | 「关窗后标签全丢」是最大痛点，出厂不保护等于放弃安全网 | `models.ts:138-145,158-166` |
| DD-8 | 同步镜像**默认关闭**且关闭即删除已上传数据 | 与「本地优先」定位一致；此前无开关、用户完全无感知 | `models.ts:213-220`；`settingsSlice.ts:78-80` |
| DD-9 | 多窗口数据**不进 tabStore**，由独立 hook 持有 | 现有 store 以「当前窗口」为唯一契约，塞进多窗口会动摇全部消费方 | `useOtherWindows.ts:6-13` |
| DD-10 | 排序阻断按原因区别对待：`sync-off` 静默、`recency` 显式告知 | `sync-off` 是用户主动选择；`recency` 是不易察觉的视图语义限制 | `reorderCapability.ts:38-45` |
| DD-11 | 虚拟化阈值**下调**（200 → 120）后必须提示且阻断真实重排 | 让「能拖拽排序」优先，同时杜绝「提示暂停、松手却真重排」 | `sectionCards.tsx:103-115`；`TabRow.tsx:106-110` |
| DD-12 | 导出文件**第一个公开版本就带版本号** | 无版本号时每次加字段只能靠猜，迁移逻辑指数膨胀；未来版本字面量拒绝 | `models.ts` EXPORT_FILE_VERSION 注释 |
| DD-13 | 弹窗**脱离折叠闸门**，经 Portal 挂 body | 折叠时点「编辑」无反应 / 展开后「僵尸弹出」的同型坑 | `sectionCards.tsx:460-463`；`FixedArea.tsx:145-148` |
| DD-14 | 拖拽**关闭让位过渡**（`transition: null`） | 动画期间矩形持续变化，落点漂移 → 「松手前要停一下才准」 | `TabRow.tsx:97-101` |
| DD-15 | 行内操作区 `display:contents` + `stopPropagation` | PointerSensor 4px 即激活，会把一次点击吞成拖拽 | `RowItem.tsx:190-198` |

---

## 14. 术语表（与代码保持一致）

| 术语 | 代码对应 | 含义 |
|------|----------|------|
| **固定空间** | `FixedArea` / `folders` | 长期保存的文件夹集合（用户资产） |
| **常驻磁贴 / pin** | `PersistentPin` / `PinnedStrip` | 顶部磁贴条，本产品自建的常驻入口 |
| **浏览器固定标签** | `tab.pinned` / section `pinned` | 浏览器原生固定，不参与 Tabs 逻辑 |
| **临时区** | `TemporarySection` | 当前窗口标签的派生态（原生组 / 站点组 / 未分组） |
| **分区 / section** | `TemporarySection` | 列表中的一个卡片 |
| **挂起条目** | `item.pendingTabId` | 组内新建后等待真实导航的标签 |
| **绑定标签** | `boundTabIds` | 与固定空间条目关联的标签 |
| **批次 / batch** | `UndoBatch` | 撤销栈中的一次关闭记录 |
| **快照 / snapshot** | `Snapshot` | 窗口标签的存档（manual / auto / archive / space） |
| **归档** | `origin: 'archive'` | 关闭标签但留档 |
| **工作空间 / space** | `origin: 'space'` | 可一键切换的轻量空间快照 |
| **keeper** | `KeeperPolicy.select` / `rankForKeep` | 重复组中保留哪一个的策略 |
| **降级 / degraded** | `storageDegraded` / `logDegraded` | 持久化失败或能力不可用的状态 |
| **镜像 / mirror** | `SyncMirror` | 经浏览器账号通道的跨设备数据副本 |

---

## 15. 附录：证据索引（按能力域）

| 能力域 | 主要文件 |
|--------|----------|
| 领域模型 | `core/schema/models.ts`、`core/tab-types.ts` |
| 分区派生 | `core/site/Sections.ts`、`SiteGrouping.ts`、`SiteKey.ts`、`SiteResolver.ts`、`HostRules.ts` |
| 重复治理 | `core/dup/DuplicateIndex.ts`、`DedupeByUrl.ts` |
| 撤销 / 重做 | `core/undo/UndoStack.ts`、`stores/undoStore.ts`、`platform/undo/RestoreEngine.ts` |
| 搜索 | `core/search/SearchEngine.ts`、`historyIndex.ts` |
| 固定空间 | `core/fixed/PinIdentity.ts`、`FolderOps.ts`、`ItemMatch.ts`、`Reconcile.ts` |
| 自动分组 | `core/group/AutoGrouping.ts`、`platform/group/AutoGroupSync.ts` |
| 快照 | `platform/snapshot/snapshots.ts`、`core/snapshot/snapshotDiff.ts`、`stores/snapshotStore.ts` |
| 复用引擎 | `platform/reuse/ReuseCoordinator.ts`、`ReusePolicy.ts`、`AllowanceLedger.ts` |
| 存储 | `platform/storage/DataRepository.ts`、`SyncMirror.ts`、`coalescedWriter.ts`、`crossPageLock.ts` |
| 状态层 | `stores/tabStore.ts`、`undoStore.ts`、`dataStore.ts` + `data/*Slice.ts`、`snapshotStore.ts`、`readLaterStore.ts` |
| UI 组件 | `ui/common/`（25 个）、`ui/tabs/`（11 个）、`ui/fixed/`（6 个）、`ui/dialog/`、`ui/dnd/`、`ui/search/`、`ui/readlater/` |
| 入口 | `entrypoints/background.ts` + `background/*`、`sidepanel/` + `sidepanel/hooks/*`、`popup/`、`options/`、`about/` |
| i18n | `i18n/index.ts`、`i18n/headless.ts`、`locales/{zh-CN,en}/translation.json` |
| 门禁脚本 | `scripts/i18n-dead-keys.mjs`、`scripts/privacy-check.mjs`、`scripts/pack-crx.mjs` |
| 配置 | `wxt.config.ts`、`vitest.config.ts`、`eslint.config.js`、`tsconfig.json` |
| 文档 | `README.md`、`PRIVACY.md`、`SECURITY.md`、`CONTRIBUTING.md`、`LICENSE` |
| CI / 测试配置 | `.github/workflows/ci.yml`、`vitest.config.ts`、`tests/setup.ts` |
