# Tabs 产品设计分析报告

**分析日期**：2026-09-30
**分析对象**：`Tabs` —— 本地优先、无自有账号、无自有服务器的浏览器标签工作台（Chrome/Edge MV3 侧边栏扩展）
**代码基线**：仓库根目录工作副本（git HEAD `94a647c`）
**证据口径**：每条结论均标注 `file:line` 或可复现的命令输出。凡属推断（用户动机、使用频率、满意度）一律显式标注「**推断**」。本项目无埋点无遥测，故报告不出现任何使用量、留存、转化率数字。
**独立性**：本报告不引用 `docs/` 下其他文档的结论作为证据，全部结论回到 `src/` 源码与配置文件本身。

---

> ### 处理状态（第二轮已全部落地）
>
> 本轮（第二轮）已把下文 §3 列出的缺陷与 §4 的改进建议**全部处理完**，并通过全量门禁：
> `typecheck` / `lint` / `check:i18n`（772 键一致、死键 0）/ `test`（104 文件 1048 用例）/ `build` / `check:privacy`（网络通道调用 0）。
>
> | 编号 | 处置 | 编号 | 处置 |
> |------|------|------|------|
> | IA-1 | ⬜ R5 未立项（R3 已提供常驻入口，待观察） | IX-1 | ✅ R1 |
> | IA-2 | ✅ R6 | IX-2 | ✅ R3 |
> | IA-3 | ✅ R7（行为变更，需 CHANGELOG） | IX-3 | ✅ R8（方案 B） |
> | IX-4 | ✅ R12 | B-1 | ✅ R9 |
> | B-2 | ✅ R10 | B-3 | ✅ R11 |
> | C-1 | ✅ R2（实际修 13 处） | C-2 | ✅ R2 |
> | C-3 | ✅ R3 | A-1 | ✅ R13 |
> | A-2 | ⚠️ R14 判定不改（见下） | P-1 | ⚠️ R15 部分（虚拟化未改） |
> | P-2 | ✅ R19 已测量，无需优化 | S-1 | ✅ R4 |
> | S-2 | ✅ R17 | S-3 | ✅ R18 |
> | F-1 | ✅ R16 | F-2 | — 经核实非缺陷 |
>
> **两项有意未做**：
> - **R14（A-2）**：核查发现 `RowItem` 已有 `activatorRef` / `buttonAttributes` / `buttonListeners` 机制，dnd-kit 键盘手柄已存在。强行拆分会改变 `PointerSensor` 4px 命中语义与既有快照，风险高于收益 → 建议独立重构立项。
> - **R15（P-1）的虚拟化部分**：`SortableContext` 需全量挂载与虚拟化存在根本冲突，改分区级虚拟化属结构性重构 → 建议独立立项。本次只完成低风险的滚动边界提示。
>
> **过程中额外修掉的 3 个缺陷**：`trimSnapshotsWithEvicted` 的 `b.createdAt - b.createdAt` 自比较（排序失效）；`ResizeObserver` 在 jsdom 下缺失导致 28 个测试崩溃；3 个 UI 快照因预期内的标记变更而更新。
>
> 完整落地记录见 [product-improvement-plan.md](./product-improvement-plan.md) §0.5。

## 0. 代码基线事实（可复现）

```
src 总计 25,192 行
  core 32 文件 / platform 27 / ui 50 / entrypoints 40 / stores 13 / i18n 4
  入口形态：background · sidepanel · popup · options · about
  测试：99 个测试文件（tests/**）
  样式：src/styles/main.css 1,945 行
  locale：zh-CN 与 en 各 819 行（键集合由 scripts/i18n-dead-keys.mjs 守卫一致）

SettingsSchema（src/core/schema/models.ts:88-228）共 46 个字段
buildSections（src/entrypoints/options/settingSections.tsx:175）
  → 35 个 kind:'toggle'/'select' 的 key 行 + 7 个 kind:'custom' 行
```

---

## 1. 项目概述

### 1.1 产品定位

Tabs 是 Chrome/Edge 的 MV3 扩展，把散乱标签组织成有秩序的空间，并通过撤销、快照与归档降低误操作风险（`README.md:5`）。定位可拆三层：

| 层 | 内容 | 证据 |
|----|------|------|
| 功能层 | 只管理**当前窗口**标签，提供侧边栏式组织、搜索、拖拽整理与多层撤销 | `README.md:5` |
| 信任层 | 无后端 · 无账号 · 无遥测 · **零出站网络请求** | `README.md:7`；`PRIVACY.md:9-16` |
| 商业层 | 永久免费核心；护城河明确排除自有云端账号与自建同步 | `README.md:158-167` |

**最关键的定位取舍**：放弃「跨设备」这个标签管理器最常见的卖点，只保留「经浏览器账号通道的、默认关闭的、关闭即删除已上传数据的镜像」（`models.ts:213-220` `syncMirrorEnabled` 默认 `false`；`settingsSlice.ts:78-80` 关闭时 `await syncMirror.clearAll()`）。这是一次清醒的取舍，而非能力缺失。

### 1.2 形态矩阵（同一套 core，五种壳）

| 形态 | 入口 | 能力范围 | 定位 |
|------|------|----------|------|
| **sidepanel** | 侧边栏 | 全量 | 主工作台（`sidepanel/App.tsx`，1,309 行） |
| **popup** | 工具栏图标（Chrome 平台行为：右键图标） | **仅搜索 + 切换** | 降级形态 / 快速切换器（`popup/App.tsx`） |
| **options** | 设置页（`open_in_tab: true`，`wxt.config.ts:26,69`） | 设置 + 导入导出 + 诊断 + 清除数据 | 配置中心 |
| **about** | 关于页 | 能力总览 + **信任面板** | 信任凭证 |
| **background** | Service Worker | 复用引擎 / 自动快照 / 自动休眠 / 右键菜单 / omnibox / 角标 | 无 UI 后台能力 |

`wxt.config.ts:66-90` 的 `build:manifestGenerated` 钩子实现「兼容变体」：剥离 `sidePanel` 权限与字段、把 action 降级绑定 `popup.html`。README 标注兼容版管道已建成、随 V2.0 交付（`README.md:78`）。

### 1.3 核心用户链路（4 条，均为代码可证实的路径）

#### 链路 A · 日常找标签（**推断**为最高频）
`⌘/Ctrl+K` 或 `Ctrl+Shift+F` 聚焦搜索框（`useGlobalHotkeys.ts:41-53`、`wxt.config.ts:43-46`）
→ `SearchEngine`（fuzzysort + pinyin-pro，标题/URL/拼音三目标，`SearchEngine.ts:190-234`）实时过滤
→ `↑↓` 漫游、`Enter` 激活（`hooks/useListNavigation.ts`）
→ 命中数经 `<output aria-live="polite">` 对读屏播报（`App.tsx:1054-1057`）
→ `Esc` 清空（`SearchBar.tsx:50-56`）

**性能基线**：`tests/perf/search-perf.test.ts:82-109` 声明 150 标签单次查询中位数 < 100ms、500 标签 < 300ms。

#### 链路 B · 误关找回（**推断**为决定留存）
经本产品关闭的标签 → `closeWithUndo` 入撤销栈（`undoStore.ts:350-408`；整组关闭走同一批次 `App.tsx:871-878`）
→ `⌘Z` 或底栏护盾徽章 → 撤销历史面板（`UndoHistoryPanel.tsx`）
→ 栈外补救：面板同时列出 `chrome.sessions` 的浏览器最近关闭（`UndoHistoryPanel.tsx:59-73,156-190`）
→ 仍为空且存在快照时，展示「从快照找回」引导（`UndoHistoryPanel.tsx:105-114`）

#### 链路 C · 整理（**推断**为情绪价值最高）
拖拽标签到固定空间/文件夹（`DndRoot.tsx`、`useTabDragHandlers.ts`）
→ 命中固定区空白 → `PromptDialog` 命名建夹（`FixedArea.tsx:49-72,151-159`）
→ toast 确认（`FixedArea.tsx:70`）
→ 或 `⌘P` 命令面板键入文件夹名 → 「打开全部」补开缺失条目（`App.tsx:905-927`）

#### 链路 D · 安全网（快照 / 归档 / 恢复）
命名保存 / 归档窗口（`snapshotStore.ts`）
→ 恢复前 `snapshotDiff` 三分类预览 + 勾选选择性恢复（`SnapshotsPanel.tsx:96-105,109-129`）
→ `RestoreConfirmDialog` 影响面摘要后才执行（`RestoreConfirmDialog.tsx:13-38`）

### 1.4 关键设计决策

| 决策 | 内容 | 证据 | 评价 |
|------|------|------|------|
| D1 | **分层架构**：core 零 chrome/DOM 依赖，platform 唯一触碰 `chrome.*` | `README.md` 架构节；`platform/tabs.ts:7-12` | 强。core 是单测主战场，99 个测试文件集中在 core/platform/stores |
| D2 | **撤销栈只覆盖「关闭」**；快照恢复明确不在覆盖内，故恢复必须走确认闸门 | `RestoreConfirmDialog.tsx:8-11` | 强。承认边界 + 补闸门，是诚实的设计 |
| D3 | **撤销语义：恢复成功才出栈**；失败项重入栈顶可重试 | `undoStore.ts:206-248` | 强。避免「既没拿回标签又失去重试入口」 |
| D4 | **按 URL 而非 tabId 做重做匹配**（关闭后 tabId 失效） | `core/undo/UndoStack.ts:78-102` | 强。正确识别了浏览器语义 |
| D5 | **持久化失败不假装成功**：按分区记账降级，全部恢复才撤横幅 | `data/context.ts:64-97` | 强。「界面显示成功但重启即丢」被定性为信任事故 |
| D6 | **所有集合有显式体积上限**（`FOLDER_ITEMS_LIMIT=500`、`SNAPSHOTS_LIMIT=200` 等） | `models.ts:33-62` | 强。把「导入一个 JSON」的攻击面显式封顶 |
| D7 | **默认保护性能力全开**：`autoSaveSnapshots`/`persistUndo`/`searchHistory` 均 true | `models.ts:145,164,166` | 强。「关窗后标签全丢」是最大痛点，出厂即保护 |
| D8 | **虚拟化与拖拽排序的容量取舍**：排序关闭 >60 行、排序开启 >120 行虚拟化 | `sectionCards.tsx:22-25,109-115` | 中。取舍自洽但**阈值下调过**（原 200），见 P-1 |
| D9 | **权限清单冻结** + `check:privacy` 门禁 | `scripts/privacy-check.mjs`；`README.md` 贡献节 | 强。把隐私从承诺变成 CI 事实 |
| D10 | **i18n 死键守卫**：locale 键必须被源码引用 | `scripts/i18n-dead-keys.mjs:8-15` | 强。代价是模板拼接键需白名单（`AboutPage.tsx:20-22`） |
| D11 | **多窗口数据刻意不进 tabStore**，由独立 hook 持有 | `useOtherWindows.ts:6-13` | 强。避免动摇「当前窗口唯一契约」的全部消费方 |

---

## 2. 优势分析

### 2.1 【最强】撤销安全网 + 快照 + 选择性恢复构成完整「反悔链」

竞品普遍只做「撤销上一步关闭」，本项目做到了五层：

- **多层撤销栈**：`undoStackLimit` 默认 10、可配 5–50（`models.ts:136-137`），FIFO 淘汰。
- **恢复成功才出栈**：`undoStore.ts:206-248` 的 `runUndo` 通过 `onCommitted` 回调把出栈时机交给调用方，**刻意不提前乐观出栈**——注释明确「提前出栈会在『拿不到目标窗口』这类早退路径上把批次永久丢掉」（`undoStore.ts:212-214`）。
- **失败项保留重试入口**：`undoStore.ts:244-245` 把 `result.failed` 组成 `retryBatch` 放回栈顶。
- **归档也进撤销栈**：`snapshotStore.ts:195` 调 `recordClosedBatch(closing,'archive',...)`，`undoStore.ts:76-79` 注释说明此前归档不进栈「违背可信关闭」。
- **跨页双重防护**：`undoInFlight` 页内互斥 + `withCrossPageLock(UNDO_EXEC_LOCK)` 跨窗口串行 + 锁内按磁盘复核批次仍存在（`undoStore.ts:105-114,417-438`）。
- **栈外兜底三层**：本产品撤销 → 浏览器 `sessions` 最近关闭 → 快照引导（`UndoHistoryPanel.tsx:96-114`）。

证据：`undoStore.ts:206-283,410-488`；`UndoHistoryPanel.tsx:96-190`。

### 2.2 【工程成熟度】并发与竞态治理有大量可验证的实现

这是同类项目里少见的水准。几乎每处并发都有锁、串行链或磁盘基线：

| 场景 | 治理手段 | 证据 |
|------|----------|------|
| 文件夹/磁贴高频写入 | 写合并 + 跨页 RMW 锁（锁内重读再合并） | `context.ts:47-54` |
| 设置在途连改 | `serialize()` 串行链，后一次必读到前一次内存终态 | `settingsSlice.ts:15-28` |
| 折叠状态整表写 | 锁内 `disk → 合并 → write`，避免另一页刚写的项被旧基线抹掉 | `settingsSlice.ts:31-49` |
| 撤销栈写盘 | 独立 `undoPersistChain`，写盘内容一律「磁盘基线 + 本页意图」 | `undoStore.ts:125-164` |
| 重做栈写盘 | 独立 `redoPersistChain`，复用 `UNDO_PERSIST_LOCK` 不新增锁名 | `undoStore.ts:167-193` |
| 镜像写入 | `writeChain` 串行化「get→remove→set」三步非原子操作 | `SyncMirror.ts:47-54,118-120` |
| 关闭同步的竞态 | `cancelPending()` 清掉去抖窗口内待写，否则「关闭即删除」承诺被 500ms 竞态击穿 | `SyncMirror.ts:56-74` |
| 清空数据 | 先清 sync 再清 local，防 `seeded` 标志随 local 清空后从旧镜像复活 | `settingsSlice.ts:123-131` |
| 导入事务 | 模块级 `importing` / `clearing` 互斥标志 | `context.ts:25-28,134` |

### 2.3 【反馈设计】「不静默」是贯穿全代码的纪律

代码里反复出现「必须给反馈 / 不能静默 return」的判断，已形成工程文化：

- **无候选时明确告知**：`App.tsx:654-657` 清理重复无可清理项时 `notify(t('duplicates.cleanNone'))`，注释写明「命令面板常驻：无候选时不能静默」；`App.tsx:717-719` 休眠同理。
- **磁盘缺失批次不静默返回**：`undoStore.ts:423-437`，注释「『点了撤销没反应』会让用户以为扩展卡住」。
- **重做无对象时清栈并告知**：`undoStore.ts:506-519` `undo.redoNone`。
- **跨语义拖拽明确拒绝**：持久 pin 与浏览器置顶磁贴互拖 → `notify(t('fixed.pinCrossSortUnsupported'))`（`useTabDragHandlers.ts:400-404`），注释「此前静默无操作，用户以为拖拽坏了」。
- **排序被阻断时按原因区别对待**：`reorderCapability.ts:38-45` 注释——`sync-off` 是用户主动关的开关「静默即可」；`recency` 是用户不易察觉的视图语义限制「必须显式告知，否则只会让人以为功能坏了」。UI 侧确实消费了：`useTabDragHandlers.ts:108-117`（拖拽）与 `:234-243`、`handleMoveTab` 内（`Alt+↑↓` 键盘重排）均 `notify(t('tabs.orderLockedBySortMode'))`。
- **影响面在按下前可见**：底栏休眠按钮 `title` 直接带数量（`FooterToolbar.tsx:148-156`），注释「让影响面在按下前可见」；清理重复徽章直接显示待清理数（`FooterToolbar.tsx:126-134`）。
- **口径同源**：`planDuplicateCleanup`（`App.tsx:74-90`）与 `selectSleepableTabs`（`App.tsx:96`）被徽章计算与执行动作共用，注释明确防「徽章显示 3 个，点下去说没有」。

### 2.4 【可达性】投入远超同类扩展

- `<h1 className="sr-only">` 补标题层级（`App.tsx:1037-1040`，注释说明读屏用户此前无法跳到标题）。
- 失败提示走 `role="alert"` + `aria-live="assertive"`，普通提示走 `role="status"`（`StatusToast.tsx:15-25`；`undoStore.ts:41-47` 注释「操作失败是最不该被延后的信息」）。
- 命中数 `<output aria-live="polite">` 播报（`App.tsx:1054-1057`）。
- 图标按钮 `min-h-6 min-w-6` 兜底 24px 命中区（WCAG 2.5.8，`IconButton.tsx:47-53`，注释说明「一旦调用方传入更小的 iconClass 就会掉到 22px」）。
- 引导进度点改用 `button` + `aria-label` + `aria-current`，`tour-dot` 透明扩区把 6px 视觉高度撑到 ≥24px（`OnboardingTour.tsx:132-148`）。
- 弹窗统一契约：焦点陷阱 + Esc + 关闭后焦点恢复 + `aria-modal`（`Dialog.tsx:9,48-140,168-169`）。
- `prefers-reduced-motion`（`TabRow.tsx:139-143`）、`forced-colors`、`hover: none` 媒体查询（`main.css:822,841,1476`）。
- 「其他窗口」分段刻意不设外层 `aria-label`，注释「下方可见标题已提供可访问名，重复会二次播报」（`OtherWindowsSection.tsx:47`）——说明可达性不是机械堆砌。

### 2.5 【交互细节】多处「踩过坑」的修正被写进注释

这些注释本身就是产品成熟度的证据：

- **行内操作按钮区用 `display:contents` + `stopPropagation`**：`RowItem.tsx:190-198` 说明「PointerSensor 距离 4px 即可激活，在此区域内按下并轻微移动会把一次点击吞成拖拽 → 关闭/固定/静音等按钮『点一下没反应』」。
- **关掉拖拽让位过渡**：`TabRow.tsx:97-101` `transition: null`，注释「动画期间矩形一直在变，落点随之漂移——表现为『松手前要停一下才准』」。
- **弹窗脱离折叠闸门**：`sectionCards.tsx:460-463` 说明折叠时点「编辑」无反应、展开后「僵尸弹出」的同型坑；`FixedArea.tsx:145-148` 同一模式。
- **memo 生效前提被显式文档化**：`RowItem.tsx:29-35` 列出调用方必须满足的两条；`TabRow.tsx:114-123` 说明解构 `sortable.listeners` 每次渲染新对象会让 memo 100% 失效。
- **tab 引用稳定**：`core/tab-types.ts` 的 `mergeSnapshotTabs` 逐字段比较复用 `prev` 引用，注释「浏览器 query 每次返回全新对象，不做这一步，任何一个标签变化都会让整棵列表树 reconcile」。
- **提示暂停与真实行为自洽**：`TabRow.tsx:106-110` 的 `canReorder` 与 `useTabDragHandlers.ts:250-255` 的拦截配对，注释「否则出现『提示已暂停、松手却真的重排』的行为矛盾」。

### 2.6 【隐私工程化】把承诺变成 CI 事实

- 权限清单冻结在 `wxt.config.ts:28-44`（10 项）+ WXT 自动追加 `sidePanel` + optional host，`scripts/privacy-check.mjs` 校验与 `PRIVACY.md` 一致。
- 关于页「信任面板」逐条说明 12 项权限用途 + 数据存放位置 + **DevTools 零网络自验证教程**（`AboutPage.tsx:200-225`），注释「把『零网络』从文档承诺变成可见功能」「不要求信任声明，教会用户验证」。
- 诊断日志**主动脱敏**：`diagnostics.ts:60-73` 的 `redactUrls` 抹掉 URL，注释说明「诊断环形缓冲是**可导出**的——落进去等于把浏览内容写进用户会随手发给我们的文件」。
- `optional_host_permissions` 走按需请求（`wxt.config.ts:45`），不开禁缓存功能则安装时不出现全站权限警告。
- 隐身标签一律排除：`useOtherWindows.ts:61-63` 注释「面板不得明文展示隐身标签的标题/网址」。

### 2.7 【降级可观测】静默 catch 收口为诊断记录

`diagnostics.ts:1-20` 把静默 catch 收口为内存环形缓冲（100 条）+ `storage.local` 共享缓冲，注释说明「MV3 各上下文模块实例互不相通且 SW 回收即丢，纯内存缓冲会让『导出诊断』永远读不到 background 侧的故障记录」。`installGlobalErrorHandlers()` 在 background 侧安装（`background.ts:68`）。

---

## 3. 缺陷与不足

### 3.1 信息架构（IA）

#### IA-1【高】侧边栏首屏被非列表模块占满，主体列表被推到折叠线以下

`App.tsx:1035-1202` 的渲染顺序自上而下为：

```
h1(sr-only) → SearchBar → 命中数 output → 落盘失败横幅(条件) → Tip 横幅(条件)
→ SpaceStrip(条件) → PinnedStrip(条件) → 原生固定区(条件) → FixedArea(恒显)
→ StatusToast(条件) → [滚动区] ReadLaterSection(条件) → 主体列表 → OtherWindows(条件)
→ 历史命中区(条件) → 新建标签条 → FooterToolbar
```

**问题**：默认设置下（`showPinnedStrip=true`、`showOtherWindows=true`、`footerLabels=true`，均见 `models.ts:102,227,109`），用户需越过搜索框、两条可选横幅、空间条、两条磁贴条、固定空间（CSS 上限 `max-height: min(34vh, 280px)`，`main.css:1133-1135`）才看到第一个标签行。

固定空间**恒显且无开关**（`App.tsx:1138-1140` 无条件渲染 `<FixedArea />`），即使 `folders.length === 0` 也占据一个带标题与「+」按钮的完整卡片（`FixedArea.tsx:110-129`）。新用户（无文件夹、无磁贴）首屏看到的主体是「固定空间」空卡片 + 空态提示 + 概念卡，而他要找的标签在最下面。

**影响范围**：全部用户，每次打开面板。

#### IA-2【中】设置页「跨设备同步」开关不在搜索体系内

对 `SettingsSchema` 字段与 `buildSections` 声明做集合比对（本次实测）：

```
未出现在 35 个 key 行中的字段（11）:
  colorTheme language autoDiscardMinutes discardWhitelist noCacheEnabled
  noCachePatterns onboarded tipSeen conceptsSeen syncMirrorEnabled activeSpaceId
```

其中 10 项是**合理**的：
- `colorTheme` / `autoDiscardMinutes` / `discardWhitelist` / `noCachePatterns` / `language` 由 `kind:'custom'` 行渲染（`settingSections.tsx:194,287,379,398,520`），确实在 UI 上可见可用；
- `onboarded` / `tipSeen` / `conceptsSeen` / `activeSpaceId` 是内部状态，不应对用户暴露。

**唯一真问题**：`syncMirrorEnabled` 的唯一出口是 `SettingsPage.tsx:367-368` 的手写 `Toggle`，**不在 `buildSections` 体系内**。而设置搜索框（`SettingsPage.tsx:222-227`）只匹配 `spec.labelKey` / `spec.hintKey` / `spec.labelKey` 小写串 → 用户搜「同步 / sync / 跨设备」会得到「搜索无结果」空态（`SettingsPage.tsx:306-312`），而开关其实就在同一页的「数据」分区里。

**影响范围**：所有试图用搜索找同步开关的用户。这是本产品信任面最重要的一个开关，不可达会实质削弱「用户可控」的承诺。

#### IA-3【低】两套 keeper 策略并存且口径不同

- `KeeperPolicy.select`（`DuplicateIndex.ts:79-91`）：激活 > 固定 > 位置靠前；固定标签豁免。
- `rankForKeep`（`DedupeByUrl.ts:17-26`）：`lastAccessed` 最新 > 激活 > 固定 > 位置靠前 > id 大。

两者都是「同 URL 保留谁」，但排序优先级不同。`DuplicateIndex.ts:66-68` 有注释警示「勿混用」，`ReuseCoordinator.ts:209` 也标注「与 KeeperPolicy.pinnedExempt 同口径」（仅指固定豁免这一条对齐）。

**实际后果**：用户在「清理重复」里看到保留的是「激活的那个」，而「同网址唯一化」自动合并保留的是「最近访问的那个」——同一产品的两个「去重」入口行为不同。这不一定是 bug，但**没有任何 UI 文案向用户解释**。

**影响范围**：同时开启两个能力的中重度用户。

### 3.2 交互流程与操作反馈

#### IX-1【高】批量破坏性动作无确认、无影响面预览 —— 与安全网设计自相矛盾

这是本次分析中最突出的**设计不对称**：

| 动作 | 影响面 | 确认 | 预览 | 可撤销 | 证据 |
|------|--------|------|------|--------|------|
| 快照**删除** | 1 份资产 | ✅ `ConfirmDialog` | — | ❌ | `SnapshotsPanel.tsx:61-62,651-660` |
| 快照**恢复** | N 个标签 | ✅ `RestoreConfirmDialog` | ✅ diff 三分类 + 勾选 | ❌ | `SnapshotsPanel.tsx:661-675`；`RestoreConfirmDialog.tsx` |
| 清除所有数据 | 全部资产 | ✅ 勾选 + 二次确认 | ✅ 逐项列举 | ❌ | `ClearDataDialog.tsx:40-59` |
| **一键清理重复** | N 个标签 | ❌ | ❌ | ✅ | `App.tsx:647-666` |
| **一键休眠全部** | N 个标签 | ❌ | ⚠️ 仅数量 | ⚠️ 部分 | `App.tsx:711-…` |
| **快速整理** | 打散重建全部分组 | ❌ | ❌ | ❌ | `App.tsx:810-838` |
| **关闭整个分区** | 该分区全部标签 | ❌ | ❌ | ✅ | `App.tsx:871-878` + `sectionCards.tsx:450-454` |

- **「快速整理」最严重**：`App.tsx:808-809` 注释明确「完全重新初始化临时区分组——打散现有临时区原生组（分组+未分组），按当前聚合方式重组全部非固定标签」。**不可撤销**（不进撤销栈，`regroupTempArea` 直接操作 tabGroups）。入口是底栏常驻图标按钮（`FooterToolbar.tsx:110-116`），`disabled` 仅防 `quickRegrouping` 重复触发。注释还记录了「曾被下沉到命令面板，用户要求恢复常驻」——说明它是高频入口。一次误点即重构用户全部标签组且无法回退。
- **「关闭整个分区」**：`sectionCards.tsx:446-455` 的「×」按钮一次关闭组内全部标签。虽走 `closeWithUndo` 可撤销，但**无确认、无数量提示**，且它就挂在密集分组头部（`SectionHead.tsx:95-107`，`is-danger` 仅改变悬停色）。误触成本 = 一次误点关掉整个域名分组。
- **清理重复**已由 `planDuplicateCleanup` 算出 `removable` 且徽章显示数量（`FooterToolbar.tsx:126-134`），但**执行前不展示「将关闭哪些、保留哪些」**——`keepIds` 只用于执行后的脉冲高亮（`App.tsx:645-646,660`）。

**影响范围**：全部用户；「快速整理」不可逆，风险最高。

#### IX-2【中】重做（redo）已完整实现但无任何常驻 UI 入口

`undoStore` 有完整的 `redoBatches` / `redo()` / `enqueueRedoPersist` 实现（`undoStore.ts:53-56,167-193,497-561`），i18n 文案齐备（`zh-CN:168-170` `undo.redo` / `undo.redone` / `undo.redoNone`），测试覆盖（`tests/stores/undoStore-redo.test.ts`）。

**唯一出口**是撤销成功后 toast 上的一次性动作按钮（`undoStore.ts:275-279`）：

```ts
action: get().redoBatches.length > 0
  ? { label: i18n.t('undo.redo'), run: () => void get().redo() }
  : undefined
```

**问题**：
1. toast 显示时长由 `toastDurationSec` 控制，默认 **7 秒**（`models.ts:153`；`undoStore.ts:196-203`）。7 秒后入口消失，重做能力对用户不存在。
2. `FooterToolbar` 与 `UndoHistoryPanel` 中 **`redo` 零引用**（实测 `grep -rn 'redo' src/ui src/entrypoints` 无命中）。
3. 无键盘快捷键：`useGlobalHotkeys.ts:54-56` 明确「⌘⇧Z 是重做语义：不判成撤销」并直接 `return`。
4. 重做栈会被任何新的关闭批次清空（`undoStore.ts:293-299`），这是正确的语义约束，但也意味着入口必须常驻才有用。

**影响范围**：所有「撤销后想反悔」的用户。功能已建、入口缺失，是最典型的半成品承诺。

#### IX-3【中】撤销栈不覆盖「恢复 / 整理」类动作，且边界对用户不可见

`RestoreConfirmDialog.tsx:8-11` 注释：「恢复会一次性新建整批标签，且**不在撤销栈覆盖范围内**（撤销栈只覆盖『关闭』），因此任何恢复入口……都必须先让用户看到『将打开 N 个标签（含 M 个分组）』再执行」。这是诚实的工程判断，但：

- 快照恢复后若用户想「回到恢复前」，**没有任何路径**（只能手动关掉新建的标签）。
- 「快速整理」同样不可撤销，且**连确认闸门都没有**（见 IX-1），是两者叠加的最坏情况。
- `SnapshotsPanel.tsx:61-62` 说明团队清楚「删除不可撤销，必须二次确认」——同一面板的**恢复**动作有闸门却无回滚。

**影响范围**：使用快照恢复与快速整理的用户。

#### IX-4【低】无标签行右键上下文菜单

实测 `grep -rn 'onContextMenu|contextmenu' src --include=*.tsx` **零命中**。行内操作（静音/固定/复制/休眠/关闭）仅存在于 hover 展开的 `RowActions`（`TabRow.tsx:176-236`），且默认 `rowActionsVisible=false`(`models.ts:155`) → **悬停才出现**。

`wxt.config.ts` 注册了 `contextMenus` 权限并实现了页面/链接/标签栏/工具栏四类右键菜单（`background/contextMenus.ts`），但**侧边栏内的标签行没有右键菜单**。

**影响范围**：偏好右键操作的用户；无 hover 场景（触屏，`main.css:1476` 有 `@media (hover: none)` 处理）下操作可达性下降。

### 3.3 边界场景（空态 / 加载 / 异常）

#### B-1【中】popup 形态无加载态、无错误态

- 侧边栏有四态：`LoadingSkeleton` / `EmptyTabs` / `NoSearchResults` / `LoadErrorState`（`ListStates.tsx`），由 `App.tsx:1158-1169` 的 `!dataReady → loadFailed ? … : …` 三元驱动。
- **popup 只有 `EmptyState`**（`popup/App.tsx:215-218`），且 `title={query ? t('search.noResults') : t('search.typeHint')}` —— 即「数据还没加载完」与「真的没有标签」被渲染成**同一个空态**。
- `popup/App.tsx:38-40` 初始化失败只 `logDegraded`，注释说明「popup 无 toast 通道且失焦即销毁」。这是合理权衡，但**用户侧完全无反馈**：popup 打开即空白，用户只会认为扩展坏了。

**影响范围**：所有使用 popup 快速切换器的用户（Chrome 右键图标路径）。

#### B-2【低】「其他窗口」分段无加载态与错误态

`useOtherWindows` 注释「查询失败保持旧数据（下次事件再试）」（`useOtherWindows.ts:11,35-37`），首次查询是异步的；`OtherWindowsSection.tsx:44` 仅在 `otherWindows.length === 0` 时 `return null`。即：多窗口场景下，首次查询在途期间该区域完全空白，且**无任何骨架或提示**；若查询持续失败则永久空白。

**证据**：`App.tsx:1195-1201`；`useOtherWindows.ts:27-55`；`OtherWindowsSection.tsx:44`。

#### B-3【低】`EmptyTabs` 空态未提示「可从快照恢复」

`ListStates.tsx:34-56` 的 `EmptyTabs` 只给「新建标签」一个动作（`createPlainNewTab`）。而 `UndoHistoryPanel.tsx:105-114` 已有 `snapshots.crashGuidance` 引导——**同样的引导没有出现在主列表空态**。用户关光标签后看到的是「新建标签」，而不是「你有 N 份快照可以恢复」。

**影响范围**：清空窗口后的用户，恰是最需要找回能力的时刻。

### 3.4 一致性

#### C-1【中】同步范围的对外口径失真（本次最该先修的信任问题）

**代码事实**：`context.ts:56-62` 的 `scheduleMirror` 无条件传全量三元组：

```ts
syncMirror.schedule({ folders: state.folders, pins: state.pins, settings: state.settings });
```

`MirrorPayloadSchema` 定义内就有 `pins`（`SyncMirror.ts:25-30`）。**即常驻磁贴确实被镜像到浏览器账号通道。**

**文案事实**：
- `zh-CN/translation.json:231` `syncMirrorHint`：「开启后，**文件夹与设置**会镜像到你浏览器账号的同步通道」——未提磁贴。
- `en/translation.json:231` 同样只写 "your folders and settings"。
- `PRIVACY.md:71`：「**同步范围**：**仅**文件夹与设置（小数据量）」——与代码直接矛盾。
- `SECURITY.md:41`：「文件夹与设置的跨设备镜像由 `syncMirrorEnabled` 控制且**默认关闭**」——第三处同样漏写磁贴。

**同时**：`PRIVACY.md:14`（「固定文件夹、固定图标与设置」）、`PRIVACY.md:60`（「文件夹、磁贴与设置的分块镜像」）**都写了磁贴**。

**定性（必须准确）**：这是**说明书少写 / 文档内部自相矛盾**，不是「数据被偷偷上传」。`MirrorPayloadSchema` 内含 `pins` 属设计意图，且 PRIVACY.md 另两处已写明含磁贴。但同一份文档里「仅文件夹与设置」的措辞是**错误的**，且开关旁的 hint 是用户决策时唯一会读的文字，会构成实质性误导。

**修复有界**：2 个 locale 各 1 行 + `PRIVACY.md:71` + `SECURITY.md:41` = 4 处（均为纯文案）。

#### C-2【低】`SyncMirror.ts` 文件头注释与实现不符

`SyncMirror.ts:14`：「同步范围：设置 + 文件夹。归档/快照等大数据不镜像。」——与同文件 `MirrorPayloadSchema`（含 `pins`）及 `context.ts:61` 的调用矛盾。文档漂移的源头很可能在此。

#### C-3【低】「重做」i18n 与 UI 状态不匹配

`undo.redo` / `undo.redone` / `undo.redoNone` 存在且被死键守卫放行（因在 `undoStore.ts` 中被字符串引用），但**无 UI 引用**（见 IX-2）。死键守卫只能证明「键被源码引用」，无法证明「功能对用户可达」——这是守卫机制的固有盲区。

### 3.5 可访问性

#### A-1【低】弹窗打开时背景未 `inert`，依赖快捷键短路

`Dialog.tsx:35-38` 注释：「DialogShell 只拦 Tab/Esc，**背景未 inert**」；`useGlobalHotkeys.ts:38-40` 为此加了 `isModalOpen()` 短路。这是可行的 workaround，但不是标准做法：屏幕阅读器的虚拟光标仍可能浏览背景内容。

**影响**：读屏用户在弹窗打开时可能读到背景列表。

#### A-2【低】标签行主按钮承载三个角色

`TabRow.tsx:114-123` 说明键盘拖拽监听挂主按钮（`KeyboardSensor` 要求 keydown 目标即 activator），而同一按钮还承担 `Alt+↑↓` 重排（`TabRow.tsx:159-170`）与 `onClick` 激活。当前实现用 `altKey` 区分了，但**主按钮同时是「激活标签」「拖拽 activator」「重排目标」三个角色**，语义密度高，未来易冲突。

### 3.6 性能感知

#### P-1【低】虚拟化阈值下调导致中等规模分区失去列表内排序 + 嵌套滚动区

`sectionCards.tsx:22-25,109-115`：

```ts
const VIRTUAL_THRESHOLD = 60;        // 排序关闭时
const FORCE_VIRTUAL_THRESHOLD = 120; // 排序开启时（原为 200，已下调）
```

注释承认「这是**下调**：120~200 行的分区从此不再支持列表内拖拽排序（>120 时排序暂停并给出行内说明）」。**行为是自洽的**：`sortPaused` 时渲染 `tabs.largeListNotice`（`sectionCards.tsx:114,129`），且 `canReorder: false` 保证「提示暂停、松手不会真实重排」（`TabRow.tsx:106-110` + `useTabDragHandlers.ts:250-255`）。

**遗留问题**：`>120` 行分区会形成**嵌套滚动区**（`virtualMaxHeight = max(240, min(720, viewportHeight-240))`，`sectionCards.tsx:127`），注释也承认「固定 480px 会让大分区变成『列表里套列表』的第三层滚动区，滚轮停在上面时页面滚不动的误判」——当前方案是缓解而非根除。

#### P-2【低】语言分组模式对每条未分组标签发起异步探测

`App.tsx:582-611`：`groupMode === 'language'` 时对 `!tab.language` 的标签批量 `detectLanguage(tab.id)`。虽做了 in-flight 去重与批量 set（注释说明「逐条 setLanguage 会让 N 个标签产生 N 轮全量派生 + 整树重渲染」），但首次切到语言分组时仍有 N 次异步探测，期间分区按 `unknown` 归类（`Sections.ts:85` `sections.unknownLanguage`）。

### 3.7 数据安全与权限

#### S-1【高】卸载扩展 = 本地数据永久清空，无任何挽留

- 全部数据存 `chrome.storage.local`（`PRIVACY.md:48`），卸载即由浏览器清除。
- 代码中**无 `setUninstallURL`**（实测 `grep -rn 'setUninstallURL' src` 零命中）。
- 唯一的预防性设计是首启引导终步的导出提醒：`OnboardingTour.tsx:91-100` 注释「数据只存在本机，卸载即清除——在用户最有耐心看完的引导终局给出一次导出机会」。

**问题**：该提醒**只在首次**（`onboarded=false`）出现一次，且用户可 Esc 跳过（`OnboardingTour.tsx:14-15,61-67`，Esc 走 `onDismiss` 不落盘）。此后**再也没有任何出口**主动提醒用户导出。设置页虽有导出入口，但需要用户主动去找。

**影响范围**：全部用户。这是本地优先架构的固有代价，但缺少卸载挽留页（uninstall URL）这一标准缓解手段。

#### S-2【低】诊断日志脱敏正则覆盖不全

`diagnostics.ts:60-73` 用 `/https?:\/\/[^\s'")\]}]+/gi` 脱敏。注释说明动机正确（诊断可导出）。但正则无法覆盖非 http(s) 的敏感串（如 `chrome-extension://` 后跟的扩展 ID）。属深度防御的细节，风险低。

#### S-3【低】稍后读超限时静默淘汰最旧条目

`trimReadLater`（`core/readlater/trim.ts:1-17`）超 `READLATER_LIMIT=200` 时淘汰最旧。注释说明不能 `slice(0,limit)`（新条目追加在末尾，从头裁会切掉刚存的那条）。逻辑正确，但**淘汰发生时用户无感知**。

### 3.8 功能完备度

#### F-1【中】「习惯洞察」仅嵌在快照面板的「周报」页签内，出口层级过深

`computeInsights`（`tabInsights.ts:1-16`）计算三类洞察（重复重灾区 / 休眠候选 / 7 天滞留预警），唯一渲染点是 `SnapshotsPanel.tsx:341,449-509`，且 `view` state 默认是 `'list'`（`SnapshotsPanel.tsx:54`）。

链路：底栏快照按钮 → 快照面板 → 切到「周报」页签 → 才看到洞察。而洞察的三个出口（清理重复 / 一键休眠 / 归档窗口）在底栏已有直达按钮（`SnapshotsPanel.tsx:24-29` 由 App 注入既有 handler）——**洞察本身反而比它指向的动作更难到达**。

#### F-2【低】`HostRules` 无法从 src 根直接复核到 UI 消费链

实测 `grep -rn 'HostRules' src` 仅命中 `core/site/SiteResolver.ts:2`（import），`grep -n 'HostRules' tests` 命中 `tests/core/site/host-rules.test.ts`。即该模块经 `SiteResolver` 间接消费、有单测覆盖，**工作正常**，但消费链不如其他 core 模块直观。此项仅作记录，非缺陷。

---

## 4. 改进建议（按 严重程度 × 改造成本 排序）

### P0 · 高价值 / 低成本（建议立即做，合计约 4–6 人日）

| # | 举措 | 对应缺陷 | 落地方向 | 成本 |
|---|------|----------|----------|------|
| **R1** | **批量破坏性动作补影响面预览 + 确认** | IX-1 | ①「快速整理」不可逆且常驻底栏 → 复用 `RestoreConfirmDialog` 模式，加「将打散 N 个组、重组 M 个标签」摘要 + 确认；②「关闭整个分区」→ `SectionHead` 的 `closeTitle` 带数量（`sections.closeAll` / `closeGroupAll` 已有 count 参数位）或加轻量确认；③「清理重复」→ 复用既有 `planDuplicateCleanup` 的 `keepIds`，执行前展示「将关闭 N 个，保留：{域名列表}」 | 2 人日（三处共用一套闸门） |
| **R2** | **修正同步范围口径** | C-1, C-2 | 改 4 处：`zh-CN:231`、`en:231`、`PRIVACY.md:71`、`SECURITY.md:41`；同步修正 `SyncMirror.ts:14` 文件头注释。统一为「文件夹、常驻磁贴与设置」 | 0.5 人日（纯文案，跑 `check:i18n` 回归） |
| **R3** | **把重做接入常驻 UI** | IX-2, C-3 | ① `UndoHistoryPanel` 顶部加「重做」按钮（`redoBatches.length > 0` 时可用）；② `useGlobalHotkeys.ts:54-56` 把 `⌘⇧Z` 从 `return` 改为调用 `redo()`；③ 可选：底栏护盾徽章长按/右键菜单 | 1 人日（后端已完备，纯接线） |
| **R4** | **卸载挽留 + 导出引导前置** | S-1 | ① background 注册 `chrome.runtime.setUninstallURL` 指向静态提示页（可放 `public/` 或复用 about 页锚点），提示导出备份；② 设置页「数据」分区顶部常驻「建议定期导出」提示（不依赖 `onboarded`） | 1 人日 |

### P1 · 中等价值 / 中等成本（建议排入下个迭代）

| # | 举措 | 对应缺陷 | 落地方向 | 成本 |
|---|------|----------|----------|------|
| **R5** | **首屏信息架构减负** | IA-1 | ① 固定空间支持「无文件夹时折叠为单行入口」或加 `showFixedArea` 开关；② 两条可选横幅（Tip / 落盘失败）合并或可折叠；③ 评估 `showOtherWindows` 默认值（`models.ts:227` 当前 `true`） | 2 人日 |
| **R6** | **popup 补加载态与错误态** | B-1 | 复用 `LoadingSkeleton`；`initializeData` 失败时渲染带「打开设置」动作的 `EmptyState` 而非 `typeHint` | 0.5 人日 |
| **R7** | **快照恢复纳入可逆范围** | IX-3 | 恢复前记录「本次新建的 tabId 列表」，提供一次性「撤销本次恢复」入口（关闭这批新建标签，走 `closeWithUndo` 或专用批次） | 1.5 人日 |
| **R8** | **主列表空态补「从快照恢复」引导** | B-3 | `EmptyTabs` 在 `hasSnapshots` 时增加次要动作，复用 `snapshots.crashGuidance` 文案与 `onOpenSnapshots` | 0.5 人日 |
| **R9** | **设置页搜索覆盖同步开关** | IA-2 | 把 `syncMirrorEnabled` 的手写 Toggle 迁入 `buildSections`，或为搜索加入静态区块（presets / data / shortcuts）的标签匹配 | 1 人日 |
| **R10** | **「其他窗口」补加载/失败态** | B-2 | `useOtherWindows` 暴露 `loading` / `error`；`OtherWindowsSection` 渲染骨架或「暂不可用」提示 | 0.5 人日 |
| **R11** | **两套 keeper 策略口径固化** | IA-3 | 统一为一套（建议 `lastAccessed` 优先，更符合直觉），或在两处 UI 分别注明保留规则 | 1 人日（含回归测试调整） |

### P2 · 锦上添花 / 观察项（本轮不建议做）

| # | 举措 | 对应缺陷 |
|---|------|----------|
| R12 | 标签行右键上下文菜单 | IX-4 |
| R13 | 习惯洞察上提到侧边栏（独立入口或内联卡片） | F-1 |
| R14 | 弹窗背景 `inert` 化替代快捷键短路 | A-1 |
| R15 | 虚拟化嵌套滚动区改为统一滚动容器 | P-1 |
| R16 | 稍后读超限时的可见提示 | S-3 |

---

## 5. 结论

Tabs 是一个**工程成熟度显著高于产品完成度**的项目：

- **工程侧**（分层架构、并发治理、反馈纪律、可达性、隐私门禁）达到了可发布水准。代码注释中大量「此前如何、为何改」的记录本身就是资产，也是本报告多数结论的一手证据。
- **产品侧**最突出的两个短板：
  1. **不可逆动作与可逆动作的处理不对称**（IX-1）——快照删除/恢复有确认与预览，而「快速整理」（同样不可逆）连确认都没有；
  2. **已建成的能力缺入口**（IX-2 重做、F-1 洞察）——后端完整、测试齐备，用户却触达不到。
- **最该立即修的一条**是 C-1 同步范围口径失真：成本最低（4 处文案）、影响的是信任面，且定性清楚——**是说明书少写，不是数据被偷偷上传**，不应被误读为隐私事故。

修完 P0 四项，可显著降低「用了几天就因一次误操作弃用」与「想反悔却找不到入口」这两类流失。

---

## 附录 A · 证据索引与处置状态（按缺陷编号）

**状态图例**：✅ 已修复 ｜ ⚠️ 部分修复 / 有意未改 ｜ ⬜ 未立项

> 说明：「缺陷证据」指向**缺陷原本所在位置**（用于复现与回归）；「修复落地」指向**本轮改动的落点**。
> 两者刻意分开保留 —— 缺陷证据是回归测试要盯的地方，删掉会失去可追溯性。

| 编号 | 状态 | 缺陷证据 | 修复落地 |
|------|------|----------|----------|
| IA-1 | ⬜ 未立项 | `App.tsx:1035-1202`；`main.css:1133-1135`；`FixedArea.tsx:74-129`；`models.ts:102,109,227` | R3 已提供常驻入口与 `⌘⇧Z`，R5 待观察后再定 |
| IA-2 | ✅ R6 | `models.ts:88-228`（46 字段）；`settingSections.tsx:175`；`SettingsPage.tsx:222-227,306-312,367-368` | `settingSections.tsx:522-526`（`kind:'custom'` 行，可被搜索命中） |
| IA-3 | ✅ R7 | `DuplicateIndex.ts:66-91`；`DedupeByUrl.ts:17-26`；`ReuseCoordinator.ts:209` | `DuplicateIndex.ts:3,65,88`（`select()` 委托 `rankForKeep`，原「勿混用」警示已删）。**行为变更，见 CHANGELOG** |
| IX-1 | ✅ R1 | `App.tsx:647-666,810-838,871-878`；`FooterToolbar.tsx:110-134`；`sectionCards.tsx:446-455`；`RestoreConfirmDialog.tsx:8-11` | `App.tsx:244,248`（`pendingRegroup`/`pendingCleanDup`）；`703` `runCloseDuplicates`；`894` `runQuickRegroup`；确认框渲染在 `1410/1426`（**在面板之后**，防被遮挡） |
| IX-2 | ✅ R3 | `undoStore.ts:53-56,275-279`；`useGlobalHotkeys.ts:54-56`；`models.ts:153` | `UndoHistoryPanel.tsx:66-68`（`redoBatches`/`redo`/`redoing`）+ 常驻重做按钮；`useGlobalHotkeys.ts:26,70`；`App.tsx:390`。**守卫在 `shiftKey` 分支之前**，不抢占输入框原生重做 |
| IX-3 | ✅ R8 | `RestoreConfirmDialog.tsx:8-11`；`App.tsx:810-838`；`SnapshotsPanel.tsx:61-62` | `snapshotStore.ts:33-40,322-324`（前后 tabId **差分**，只关本次新建的标签）；`UndoHistoryPanel` `kindLabel` 支持 `'restore'` |
| IX-4 | ✅ R12 | 原 `grep -rn 'onContextMenu' src` 零命中；`TabRow.tsx:176-236`；`models.ts:155` | 新增 `ui/common/ContextMenu.tsx`（Portal + `role="menu"` + Esc + 聚焦首项 + 外部点击关闭 + 视口收拢）；`TabRow.tsx:17,191,196,368` |
| B-1 | ✅ R9 | `popup/App.tsx:38-40,215-218`；`ListStates.tsx:12-32,34-56,74-91` | 新增 `popup/PopupListStates.tsx`；`popup/App.tsx:11-12,235`（错误态含 `onRetry` → 骨架屏 → 空态三态） |
| B-2 | ✅ R10 | `App.tsx:1195-1201`；`useOtherWindows.ts:11,27-55` | `useOtherWindows.ts:13,30,44,119`（`status: loading\|ready\|error` + `retry`） |
| B-3 | ✅ R11 | `ListStates.tsx:34-56`；`UndoHistoryPanel.tsx:105-114` | `ListStates.tsx:35,41,44`（`EmptyTabs` 加 `hasSnapshots`，追加恢复引导） |
| C-1 | ✅ R2 | `context.ts:56-62`；`SyncMirror.ts:25-30,133,233`；`zh-CN:231`；`PRIVACY.md:14,60,71`；`SECURITY.md:41` | 13 处文案/文档补上「常驻磁贴」：`zh-CN:231,715`；`en:231,715`；`PRIVACY.md:3,48,71`；`README.md:5,74,155`；`SECURITY.md:41`；`models.ts:214`；`SyncMirror.ts:14` |
| C-2 | ✅ R2 | `SyncMirror.ts:14` | 同上（`MirrorPayloadSchema` 实际载荷含磁贴） |
| C-3 | ✅ R3 | `zh-CN:168-170`；原 `grep -rn 'redo' src/ui src/entrypoints` 零命中 | `UndoHistoryPanel.tsx:66-68` + 常驻按钮 + `⌘⇧Z` |
| A-1 | ✅ R13 | `Dialog.tsx:35-38,168-169`；`useGlobalHotkeys.ts:38-40` | `src/ui/dialog/Dialog.tsx:56,119,163` —— `applyBackgroundInert`：栈首入栈时惰性化背景，栈清空时解除；不支持 `inert` 的内核退化为 `aria-hidden`。**注意路径是 `src/ui/dialog/` 而非 `src/ui/common/`** |
| A-2 | ⚠️ R14 有意未改 | `TabRow.tsx:114-123,159-170`；`RowItem.tsx:14-23` | **判定不改**：`RowItem` 已有 `activatorRef`/`buttonAttributes`/`buttonListeners`，dnd-kit 键盘手柄已存在。强行拆分会改变 `PointerSensor` 4px 命中语义与既有快照 → 建议独立重构立项 |
| P-1 | ⚠️ R15 部分 | `sectionCards.tsx:22-25,109-115,127`；`TabRow.tsx:106-110` | 只做低风险部分：`main.css:1142,1150`（底部滚动边界阴影，`background-attachment: local`）；`FixedArea.tsx:65,74` 切换 `.is-scrolled-to-end`。**虚拟化未改**：`SortableContext` 需全量挂载，与行级虚拟化根本冲突 → 建议独立立项 |
| P-2 | ✅ R19 已测量 | `App.tsx:582-611`；`Sections.ts:85` | `tests/perf/language-mode-perf.test.ts`。**结论：无需优化**（500 标签下单次派生 0.048ms，亚毫秒级）；`App.tsx` 已用「批量探测 + 一次 setLanguages」，当初担忧的 N 轮派生问题在代码里已解决 |
| S-1 | ✅ R4 | 原 `grep -rn 'setUninstallURL' src` 零命中；`OnboardingTour.tsx:14-15,61-67,91-100` | `background.ts:322,326,335,341`（`onInstalled` + `onStartup` 双注册）；新增 `public/uninstall.html`（样式内联、零外链、**无查询参数回传**）；设置页常驻导出提示 |
| S-2 | ✅ R17 | `diagnostics.ts:60-73`（原单条 `http(s)://` 正则） | `diagnostics.ts:69` `REDACT_PATTERNS` 四条（协议头 URL / 裸域名+路径 / 无点分级 `host:port` / `user:pass@`）；`FILE_LINE_TOKEN` 占位保护 `file.ts:42` 类误伤 |
| S-3 | ✅ R18 | `core/readlater/trim.ts:1-17`；`models.ts:62` | `trim.ts:26` `trimReadLaterWithEvicted`；`UndoStack.ts:53` `pushBatchWithEvicted`；`snapshots.ts:88,172` `trimSnapshotsWithEvicted`（`persistSnapshot` 已改走该变体）。三类全部经 `notifyEviction` 闭环，按类别会话内去重 |
| F-1 | ✅ R16 | `SnapshotsPanel.tsx:24-29,54,341,449-509`；`tabInsights.ts:1-16` | `FooterToolbar.tsx:49,85,151,155`（`insightCount > 0` 时独立洞察按钮，badge 显数）；`SnapshotsPanel.tsx` `initialView` + `scrollIntoView` 到洞察锚点；`App.tsx` `insightCount` 由 `computeInsights` 同参计算 |
| F-2 | — 非缺陷 | `SiteResolver.ts:2`；`tests/core/site/host-rules.test.ts` | 经核实为设计取舍，非缺陷 |

### 附录 A 补充：本轮额外修复的缺陷（非原计划内）

| 问题 | 位置 | 说明 |
|------|------|------|
| 快照排序自比较 | `snapshots.ts` `trimSnapshotsWithEvicted` | 排序写成 `b.createdAt - b.createdAt`（自己减自己），**排序完全失效**，会导致保留的快照顺序错误。已修正 |
| `ResizeObserver` 在 jsdom 下缺失 | `FixedArea.tsx` | 直接 `new` 会让 28 个 FixedArea 测试全崩。已加类型守卫，缺失时退化为「滚动时才更新」 |
| 淘汰提示刷屏 | `undoStore.ts` `notifyEviction` | 三类淘汰的共同形态是「每操作一次再淘汰一条」（批量关 50 个标签 / 连续暂存 / 逐份导入 Workona），逐次 `set` toast 会互相顶掉 → 用户一条都看不到。改为按 key 会话内只提示一次（模块级 Set，非 store 字段，避免被快照测试与 setState 复位清掉） |
| 快照淘汰提示原本断链 | `snapshots.ts` `persistSnapshot` | `trimSnapshotsWithEvicted` 已存在，但 `persistSnapshot` 仍调旧的 `trimSnapshots`（丢弃淘汰信息）且无监听方注册 → 三类淘汰里这一类用户完全收不到提示。已补齐 |
| IA-1 | `App.tsx:1035-1202`；`main.css:1133-1135`；`FixedArea.tsx:74-129`；`models.ts:102,109,227` |
| IA-2 | `models.ts:88-228`（46 字段）；`settingSections.tsx:175`（35 key 行）；`SettingsPage.tsx:222-227,306-312,367-368` |
| IA-3 | `DuplicateIndex.ts:66-91`；`DedupeByUrl.ts:17-26`；`ReuseCoordinator.ts:209` |
| IX-1 | `App.tsx:647-666,711-…,810-838,871-878`；`FooterToolbar.tsx:110-134`；`sectionCards.tsx:446-455`；`SectionHead.tsx:95-107`；`SnapshotsPanel.tsx:61-62,651-675`；`RestoreConfirmDialog.tsx:8-11` |
| IX-2 | `undoStore.ts:53-56,167-193,275-279,293-299,497-561`；`useGlobalHotkeys.ts:54-56`；`models.ts:153`；`undoStore.ts:196-203`；`zh-CN:168-170`；`tests/stores/undoStore-redo.test.ts` |
| IX-3 | `RestoreConfirmDialog.tsx:8-11`；`App.tsx:810-838`；`SnapshotsPanel.tsx:61-62` |
| IX-4 | `grep -rn 'onContextMenu' src` 零命中；`TabRow.tsx:176-236`；`models.ts:155`；`background/contextMenus.ts` |
| B-1 | `popup/App.tsx:38-40,215-218`；`ListStates.tsx:12-32,34-56,74-91`；`App.tsx:1158-1169` |
| B-2 | `App.tsx:1195-1201`；`useOtherWindows.ts:11,27-55`；`OtherWindowsSection.tsx:44` |
| B-3 | `ListStates.tsx:34-56`；`UndoHistoryPanel.tsx:105-114` |
| C-1 | `context.ts:56-62`；`SyncMirror.ts:25-30,133,233`；`zh-CN:231`；`en:231`；`PRIVACY.md:14,60,71`；`SECURITY.md:41` |
| C-2 | `SyncMirror.ts:14` |
| C-3 | `zh-CN:168-170`；`grep -rn 'redo' src/ui src/entrypoints` 零命中 |
| A-1 | `Dialog.tsx:35-38,168-169`；`useGlobalHotkeys.ts:38-40` |
| A-2 | `TabRow.tsx:114-123,159-170`；`RowItem.tsx:14-23` |
| P-1 | `sectionCards.tsx:22-25,109-115,127`；`TabRow.tsx:106-110`；`useTabDragHandlers.ts:250-255` |
| P-2 | `App.tsx:582-611`；`Sections.ts:85` |
| S-1 | `grep -rn 'setUninstallURL' src` 零命中；`OnboardingTour.tsx:14-15,61-67,91-100`；`PRIVACY.md:48` |
| S-2 | `diagnostics.ts:60-73` |
| S-3 | `core/readlater/trim.ts:1-17`；`models.ts:62` |
| F-1 | `SnapshotsPanel.tsx:24-29,54,341,449-509`；`tabInsights.ts:1-16` |
| F-2 | `SiteResolver.ts:2`；`tests/core/site/host-rules.test.ts` |
