---
name: ui-component
description: UI 组件开发规范（全局统一）。当新增或修改 React 组件、设置页控件、弹窗、列表时使用——组件分层与复用清单（防重复造轮子）、单一职责、API 与命名约定、设计令牌、交互模式、目录治理、机器守卫清单。
allowed-tools: Read, Grep, Glob, ListDir, Write, Edit
disable: false
---

# UI 组件开发规范（全局统一）

硬性约束见 `rules/code-style` 与 `rules/architecture`（ui 层不得直连 chrome API）。本文档管**组件形态的一致性**。

制定依据：2026-10-27 全量实证审计（`ui/common` 37 文件 + 业务域 + 入口层逐文件通读）。文中"此前"类描述都是审计实测到的真实分叉，不是假设。

---

## 0. 一句话原则

**先查有没有，再决定建不建；能加 props 扩展就不开新组件；一个视觉形态只允许有一套 class 串。**

审计发现的最大结构性问题不是"没人守规范"，而是**中间形态层缺失**：`Button`/`IconButton`/`TextField` 三个原子收口了，但 chip/badge、行内图标按钮、列表行按钮、分组小标题、卡片壳这些"原子与页面之间"的形态没有被组件化（只有 `main.css` 里的 `.chip`/`.row-action`/`.status-badge` 语义类），于是各业务文件各自手写 `<button>` + class 串，每处重新发明一遍命中下限、`disabled:hover` 兜底与配色口径——**收口之后重复又在新位置复发**。所以规范的第一要务是补齐中间层。

---

## 1. 组件分层与落位

| 层                | 目录                                                                                         | 判据                                                         | 例子                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **L1 原子原语**   | `ui/common/`                                                                                 | 无业务语义、跨域复用、props 纯净                             | Button、IconButton、TextField、Select、Toggle、Checkbox、Chip、RowActionButton、Icon |
| **L2 中间形态**   | `ui/common/`                                                                                 | 由原子组合出的通用形态，仍无业务语义                         | EmptyState、SectionHead、RowItem、SegmentedChip、StatusBadges、ListStates            |
| **L3 业务域组件** | `ui/tabs/`、`ui/fixed/`、`ui/search/`、`ui/snapshot/`、`ui/spaces/`、`ui/dnd/`、`ui/dialog/` | 含领域类型（TabRecord / FixedFolder / Snapshot）或域专有交互 | TabRow、FolderRow、SnapshotRow、SpaceStrip                                           |
| **L4 页面/壳**    | `entrypoints/**`                                                                             | 只做组装与编排，**不定义展示组件**                           | App、SettingsPage、FooterToolbar（已下沉 ui/tabs）                                   |

**落位判定三问**：① 含不含领域类型？含 → L3。② 是否只被一个业务域消费？是 → 下沉该域目录，**不要塞进 `common/`**。③ 是否在 `entrypoints/` 里被两个以上页面 import？是 → 说明它已经是事实公共组件，**下沉 `ui/`**，别让入口层沉淀组件库。

文件命名：组件 PascalCase（多导出集合用 camelCase，如 `listStates.tsx`）；hooks/工具 camelCase；目录小写单词。

---

## 2. 复用清单（动手前必查，禁止跳过）

| 域   | 现成组件                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 按钮 | `Button`（8 变体 × 3 尺寸）、`IconButton`、`RowActionButton`（行内 20px 档）                                                                        |
| 表单 | `TextField`（input/textarea，outline/bare）、`Select`、`Toggle`、`Checkbox`、`ColorSwatchGroup`                                                     |
| 展示 | `Chip`/`Badge`、`StatusBadges`、`SectionHead`、`RowItem`、`RowActions`、`EmptyState`、`ListStates`（骨架/空/错误/无结果）、`Icon`、`Favicon`、`Kbd` |
| 反馈 | `StatusToast`（唯一提示渲染点）、`ErrorBoundary`                                                                                                    |
| 弹窗 | `DialogShell`、`ConfirmDialog`、`PromptDialog`（`ui/dialog/Dialog.tsx`）                                                                            |
| 浮层 | `ContextMenu` + `useRowContextMenu`（含键盘唤出）                                                                                                   |
| 拖拽 | `DndRoot` + `ui/dnd/dropPolicy` 的 `classifyDrop`/`resolveDrop`/`dropFeedbackClass`（**唯一落点口径**）                                             |
| 列表 | `VirtualRowList`（长列表）、`SectionList`                                                                                                           |

行为与需求有出入时**优先扩展现成组件（加 props）**，不新开近似组件。

---

## 3. 单一职责

- 组件文件 **>300 行**必须自检是否混装职责；典型拆分方式：数据获取 → `useXxx()` hooks，业务编排 → `useXxxActions()`，常量/文案表 → 独立 `.ts`，纯函数 → `core/**`。
- **展示组件内不得直调平台副作用**（如 `createPlainNewTab()`、`getRecentlyClosed()`），改由 props 注入或 hooks 封装。
- **纯领域逻辑不许留在 ui**：如「条目匹配键」「顺序派生」应下沉 `core/**`（`core/site/roamOrder.ts` 是先例）。
- 一个组件只承担一种形态；发现"同视觉两处实现"时（如 `CategoryModule` vs `GroupCard`），合并而不是共存。

---

## 4. API 与命名约定（同类组件必须一致）

| 轴         | 约定                                                                                                          | 反例                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 点击回调   | 原语用 `onClick`；列表项/菜单项用 `onSelect`                                                                  | 同是按钮有的叫 `onClick` 有的叫 `onRun`             |
| 可访问名   | 统一 `label`（**必填**，同时落到 aria-label）+ 可选 `tooltip`（只做鼠标提示）；`ariaLabel` 缺省回落到 `label` | 有的组件 `title`+`ariaLabel` 两个独立 prop 互不兜底 |
| 尺寸       | 一律 `size`，取值收敛 `xs/sm/md/lg`；**不用 `box`/`density`**                                                 | `IconButton` 的 `box`、`RowItem` 的 `density`       |
| 视觉轴     | 一律 `variant`；状态/色调再用 `tone: 'default'｜'accent'｜'danger'｜'on'`                                     | 有的 `variant`、有的 `tone`+独立布尔 `danger`       |
| 样式逃逸   | 所有原语都给 `className?: string`，**末尾拼接**（照 `Button.tsx:84`）                                         | 有的组件没有 `className`，逼得调用方手写副本        |
| 图标传参   | `<Icon d={Icons.x}>`、`<IconButton icon={Icons.x}>` 保持；不新增第三套                                        | —                                                   |
| DOM `type` | 只有 `<button type>` 用 `type`；输入类型改用 `inputType`                                                      | `Button.type` 与 `TextField.type` 同名字不同义      |

**通用原语不得混入上层语义**：如 `IconButton` 的 `dismiss`（弹窗首焦跳过）、`badge`（工具条专用）这类应留在调用方或专用组件。

---

## 5. 视觉规范（设计令牌）

### 5.1 颜色

- 只用语义令牌类（`text-gray-*` / `bg-accent-*` / `text-warn-*` / `border-control` …）与 CSS 变量（`var(--c-*)`）。
- **禁止** Tailwind 默认调色板（`text-blue-500` 等 22 个色族）、**禁止** `#hex`/`rgb()` 字面色值（含写在 `style={{}}` 里的）。
- **控件边界**用 `--border-control`（≥3:1，WCAG 1.4.11）；**装饰性分隔线**才用 `--border-subtle`。混淆二者是审计中发现的真实违规。
- **唯一例外：输入框下划线**（`.input-row` / `.input-line`）静态态用 `--border-subtle`，聚焦态转品牌色 + 2px 指示条。这是"参照顶部搜索框"的观感要求（换 control 后实测偏重）；对比度由聚焦态承担。理由写在 `main.css` 的「输入落位语言」注释里，改回 control 只需一处。
- **禁止给令牌叠透明度**（如 `text-accent-700/90`）：对比度矩阵只测纯色，叠了无人校验。
- 强调色注入统一走 CSS 变量（`--accent` / `--tile-accent`），不要一处用 `backgroundColor`、一处用 `style={{ '--accent': … }}`。

### 5.2 字号

- 只用刻度类：`text-3xs / text-2xs / text-xs / text-sm`。**禁止** `text-[Npx]`。
- `.chip` 徽角字号由 `.chip` 统一（unlayered，优先于 utilities），组件不覆写。
- 同一视觉 role 不得出现两种字号（审计中"分组小标题"有 `text-2xs` 与 `text-3xs` 两版）。

### 5.3 间距 / 圆角 / 尺寸

- 间距走 4px 网格刻度（`p-2`/`gap-1`/`px-4`…）；**任意值 `p-[Npx]`/`gap-[Npx]`/`rounded-[`/`shadow-[` 被守卫拦**。
- 尺寸类任意值（`max-w-[…]`/`max-h-[…]`/`min-h-[…]`）**原则上禁止**，确需时提令牌（如 `--chip-max-w`）。
- 命中区：**任何可点击元素 ≥24px**（WCAG 2.5.8）。视觉 20px 的走 `.row-action`（`::after` 扩到 24px），**不要手写 `p-1` + 小 icon 自以为够**。

### 5.4 图标

- 只用 `ui/common/Icon.tsx` 的 `Icons` 表；不散落 SVG。
- 图标按钮默认 `aria-hidden`，需要读屏名时传 `label`（或外层 `sr-only`）。

---

## 6. 交互模式（同一动作只能有一种实现）

| 场景                      | 唯一出口                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 成功 / 一般提示           | `useUndoStore().notify()` → `StatusToast`                                                                       |
| 失败提示                  | `notifyError()`（保留重试入口）/ `notifyFailure(scope, msg, err)`（进诊断）                                     |
| 加载 / 在途               | `Button`/`IconButton` 的 `loading`（`aria-busy`）；**不许用 `'…'` 字符串表示在途**                              |
| 空 / 错误 / 无结果 / 骨架 | `EmptyState` 与 `ListStates` 的四个状态组件                                                                     |
| 危险操作确认              | `ConfirmDialog`，且 `confirmLabel` 用**动作本身**（"删除"）而非中性的"确定"                                     |
| 右键菜单                  | `ContextMenu` + `useRowContextMenu`（**必须同时接鼠标与键盘唤出**，键盘入口在 hook 内）                         |
| 弹窗                      | `DialogShell`（`<div role=dialog>`）或原生 `<dialog>`（**必须用 `m-auto` 居中，见 `CommandPalette.tsx` 注释**） |
| 拖拽落点反馈              | `dropFeedbackClass(isOver, outcome)`，**不许内联三元**（`noop` 语义会丢）                                       |
| 动效                      | `transition-base` 令牌；需位移再叠 `transition-transform`；**不写 `duration-*`/`ease-*`**                       |
| 焦点                      | 焦点环走全局样式，不写死 `border-radius`；模态内焦点由 `useModalA11y` 统一                                      |

**表单行为**：所有输入走 `TextField`（或 `Select`/`Toggle`/`Checkbox`）；**`entrypoints/**` 与 `ui/**` 禁止裸 `<input>`/`<button>`**（`type="file"` 等显式白名单除外）。

---

## 7. 目录治理（审计中的真实欠账，按序推进）

1. `ui/common/` 里的**整条快照域**下沉 `ui/snapshot/`：`SnapshotRow`、`useSnapshotImport`、`useSnapshotRestore`、`snapshotOrigin`、`RestoreConfirmDialog`。
2. `common/` 里的**整页面板**归位：`SnapshotsPanel`、`UndoHistoryPanel`、`CommandPalette`、`OnboardingTour`、`SpaceStrip`（→ `ui/spaces/`）、`StatusToast`。
3. **反向依赖清零**：`common/` 不得 import 业务域（如 `useAllWindowTabs` → `ui/search/`）。
4. `entrypoints/options/` 的展示控件下沉 `ui/settings/`：`settingControls`、`settingPresets`、`SettingsOutline`、`ShortcutsSection`。
5. 删除死代码（审计实测 `ui/common/format.ts` 全仓零引用）。

---

## 8. 机器守卫（`pnpm check:ui`）

`check:ui` 跑 `tests/ui/design-tokens.test.ts` + `tests/ui/component-consistency.test.ts`（后者是本规范的结构性守卫）。现有覆盖与缺口：

| 已有                                      | 尚缺（已在 `component-consistency.test.ts` 落地） |
| ----------------------------------------- | ------------------------------------------------- |
| 对比度矩阵（20 pair × 2 主题 × 6 色相）   | 结构性重复：同类 class 串只允许一套               |
| 弱对比令牌（`text-gray-400` 承载文字）    | 重复造轮子：裸 `<button>`/`<input>`               |
| CSS 变量定义完整性                        | `style={{}}` 内联色值                             |
| 未受控调色板 / 字号 / 间距任意值          | 尺寸类任意值（`w-/h-/max-w-/min-h-[`）            |
| `cursor-pointer` / forced-colors / 焦点环 | 扫描面扩展到 `.ts`（当前只扫 `.tsx`）             |

**新增守卫前必须实测命中数**：先 grep 估算，命中项要么先修掉，要么进显式白名单并写清理由——不允许"守卫恒绿但因为没扫到"。

## 9. 验证

```bash
pnpm check:ui                      # 设计令牌 + 组件一致性守卫
pnpm test:watch tests/ui/<对应测试> # 行为测试（按 role 查询，不按 class）
pnpm typecheck && pnpm lint
```

## 10. 输入 / 输出

- 输入：组件需求或设计描述。
- 输出：① 复用结论（用了哪个现成组件 / 为何必须新建，新建需说明它属于 L1–L3 哪一层）② 组件代码（props 符合 §4、样式符合 §5、交互走 §6 唯一出口）③ 双语 locale 键 ④ 对应 UI 测试 ⑤ 如新增了形态，同步更新 §2 复用清单与本文件的守卫说明。
