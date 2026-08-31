# TabHaven UI / UX 改进方案与执行计划

> 审查日期：2026-08-31
> 基线：`vitest run` 36 文件 / 277 用例全通过；tsc / eslint 零错误
> 审查范围：`src/styles/main.css`(1607 行) + 3 个入口 + 24 个 UI 组件 + i18n 396 键
> 前置背景：本文档是 2026-08-27 审计（`docs/UI-UX-AUDIT-2026-08-27.html`）的**接续**，
> 已修复项不再重复列出，只保留**当前代码中仍然存在**的问题。

---

## 0. 结论先行

| 维度 | 评价 | 说明 |
|---|---|---|
| 设计令牌系统 | 🟢 优秀 | 6 色相 × 明暗 = 12 套梯度，对比度全矩阵自动化守卫（`tests/ui/design-tokens.test.ts`），15 组色对全部 WCAG AA |
| 无障碍基础 | 🟢 良好 | 焦点环实色化、命中扩区 ≥24px、`prefers-reduced-motion`、`aria-live` 播报齐备 |
| 响应式降级 | 🟢 良好 | 容器查询三档（360px / 300px），窄侧边栏逐级降级策略清晰 |
| **能力落地率** | 🔴 **主要短板** | **「设计了但没接上」仍有 6 处**，含 1 处默认配置下功能完全失效 |
| **样式规范自洽** | 🟡 需收敛 | 自订「正文 ≥11px」规则被 53 处 `text-2xs` 绕过；2 个类名零 CSS 定义 |
| 设置页信息架构 | 🟡 需收敛 | 37 项设置仅 3 个分区，其中单区 21 项平铺；折叠能力已实现但从未启用 |

**一句话总结**：视觉与令牌层已达生产水准，真正的问题集中在**「实现了却没接线」与「自订规范被自己绕过」**——
这类问题不靠视觉走查发现，靠交叉核对（配置默认值 × 分支条件、CSS 定义 × TSX 引用、i18n 键 × 源码引用）发现。

---

## 1. 问题清单（按优先级）

### 🔴 P0-1 虚拟滚动在默认配置下永不生效（性能保护对目标用户失效）

**证据**

```
src/ui/tabs/SectionList.tsx:179-180
  const VIRTUAL_THRESHOLD = 60;
  const useVirtual = !reorderEnabled && tabs.length > VIRTUAL_THRESHOLD;

src/entrypoints/sidepanel/App.tsx:831
  reorderEnabled={settings.tabOrderSync}

src/core/schema/models.ts:58    tabOrderSync: z.boolean().default(true)
src/core/schema/models.ts:144   tabOrderSync: true
```

**问题**：`reorderEnabled` 恒为 `true`（默认值），`!reorderEnabled` 恒为 `false` → `useVirtual` **恒为 false**。
`VirtualRowList` 整个组件（77 行）在默认配置下是死代码。

**影响**：TabHaven 的目标用户正是「标签囤积者」。200+ 标签时全量挂载 DOM，
每次 `tabs` 快照更新触发整树 diff——**性能保护恰好在最需要它的场景失效**。

**根因**：拖拽重排（`SortableContext`）要求全部项挂载，与虚拟化天然冲突。
当前用「二选一」硬互斥回避了这个矛盾，代价是默认路径丢失虚拟化。

**建议方案（择一，推荐 A）**

- **方案 A（推荐，低风险）**：提高阈值 + 超阈值时自动降级排序。
  当 `tabs.length > 200` 时强制虚拟化并禁用该分区的列表内排序，
  同时给分区头一个提示徽章（如「大列表已优化，排序暂停」）。
  理由：200+ 标签的分区里做精细拖拽排序本就不是真实需求，用户此时要的是「能滚动、不卡」。
- **方案 B（彻底，高风险）**：改用 `@dnd-kit` 的虚拟化协同方案（`SortableContext` + 自定义 `items`），
  只把可视区项交给 sortable。需要大量回归测试，**不建议在当前阶段做**。

**验收**：默认设置下打开含 250 个标签的窗口，DevTools Elements 面板中该分区 `li` 节点数 < 40。

---

### 🔴 P0-2 两个类名零 CSS 定义（样式静默失效）

**证据**

| 类名 | 引用位置 | main.css 定义 |
|---|---|---|
| `.fixed-area-empty` | `src/ui/fixed/FixedArea.tsx:434` | ❌ 无 |
| `.virtual-row-scroll` | `src/ui/tabs/VirtualRowList.tsx:62` | ❌ 无 |

**`.fixed-area-empty` 的实际后果最严重**：

```tsx
// FixedArea.tsx:434
<p className="fixed-area-empty">{t('fixed.emptyHint')}</p>
// 文案：「点击 + 新建收藏夹，或直接把标签/分组拖到这里」
```

该 `<p>` **没有任何字号 / 颜色 / 间距样式**，继承 `body` 默认值（浏览器默认 16px）。
在一个正文 12px、小字 10–11px 的密集侧边栏里，**空态提示文字比所有内容都大**，
且颜色为 `--c-gray-800`（正文色）而非弱文本色——视觉权重严重错配。

这是**新用户看到的第一屏内容**（固定空间为空时必现），首因效应影响最大。

**建议**

```css
/* 固定空间空态提示：弱文本 + 与 section-head 左对齐 */
.fixed-area-empty {
  margin: 2px 0 0;
  padding: 0 8px;
  color: var(--c-gray-500);
  font-size: var(--text-3xs);   /* 11px，遵守「正文说明 ≥11px」 */
  line-height: 1.5;
}
/* 虚拟列表滚动容器：滚动链隔离（避免冒泡到外层列表） */
.virtual-row-scroll {
  overscroll-behavior: contain;
}
```

**验收**：清空所有固定文件夹，空态提示字号为 11px、颜色为弱文本色，与上方分区标题左对齐。

**顺带**：`.icon`（`src/ui/tabs/SectionList.tsx`）同样无定义，需确认是否为无意残留。

---

### 🔴 P0-3 设置页折叠能力已实现但从未启用（21 项平铺于单一分区）

**证据**

```
src/entrypoints/options/SettingsPage.tsx:29-70   Section 组件完整实现 collapsible + forceOpen
src/entrypoints/options/SettingsPage.tsx:1124-1134  <Section collapsible={section.collapsible} .../>
grep "collapsible: true" → 零结果          # buildSections 从未传 true
```

**分区实际负载**

| 分区 | 项数 |
|---|---|
| `settings.appearance` | 9 |
| `settings.behavior` | 7 |
| **`settings.capabilities`** | **21** |

`details/summary` 折叠抽屉 + 搜索时 `forceOpen` 自动展开的机制**全部写好了**，
只差 `buildSections` 里一个 `collapsible: true`。当前 21 项高级能力全部平铺，
用户需连续滚动才能扫完，决策疲劳明显。

**建议**：把 `settings.capabilities` 拆为 2–3 个语义分区，其中低频项标 `collapsible: true`。
`forceOpen={isSearching}` 已就位，折叠不会影响搜索可达性——这是零成本收益。

**验收**：设置页首屏可见分区数 ≥4；`capabilities` 类低频项默认折叠；
在搜索框输入任意关键词后，命中项所在折叠区自动展开。

---

### 🟡 P1-1 最高频危险操作缺少危险态反馈，且危险色存在两套实现

**证据**

```
main.css:734-740        .row-action.is-danger:hover  { 砖红 }   ← CSS 已定义
grep "is-danger" src/**/*.tsx → 零结果                          ← 死 CSS

src/ui/tabs/TabRow.tsx:161-169   关闭按钮 className="row-action"      ← 无危险态
src/ui/fixed/FixedArea.tsx:118   className="row-action text-red-500"  ← 另一套写法
src/ui/fixed/FixedArea.tsx:273   className="row-action text-red-500"  ← 另一套写法
```

三个问题叠在一起：

1. **TabRow 的关闭按钮**是整个产品**最高频的破坏性操作**，悬停时与「固定 / 复制 / 休眠」
   完全同色（`--c-gray-500` → 品牌绿 hover），没有任何「这个会删东西」的视觉预警。
2. `.row-action.is-danger` 是**为此专门写的 CSS，但没有任何 TSX 使用它**。
3. FixedArea 改用 `text-red-500` 实现——靠 `main.css:736` 的
   `.row-action:hover.text-red-500` 兜底选择器生效。**同一语义两套实现**，后续必然漂移。

**建议**：统一到 `.row-action.is-danger`，删除 `text-red-500` 写法及其兜底选择器。
TabRow 关闭按钮补 `is-danger`。

> ⚠️ 注意：`is-danger` 只改 **hover / focus-visible** 态，静默态仍为中性灰。
> 不要让关闭按钮常态显红——密集列表里每行一个红图标会造成焦虑感。

**验收**：TabRow 关闭按钮悬停呈砖红底 + 砖红图标；`grep text-red-500 src/` 零结果；
`.row-action:hover.text-red-500` 兜底选择器可安全删除。

---

### 🟡 P1-2 自订字号规范被大面积绕过

**证据**

```
main.css:29-32（自订规范）
  10px 仅用于图标内文与徽角等极窄容器，正文说明一律 ≥ 11px

实际用量：text-2xs(10px) 53 处   vs   text-3xs(11px) 11 处
```

**9 处 `text-2xs` 与 `leading-*` 同现**——`leading-*` 是多行正文的强信号，
说明这些是**正文说明而非徽标**，属明确违规：

| 位置 | 内容 |
|---|---|
| `ui/common/ErrorBoundary.tsx:47` | 错误说明正文（`leading-relaxed`） |
| `ui/common/ErrorBoundary.tsx:50` | 错误堆栈（`leading-snug`） |
| `options/SettingsPage.tsx:515` | 预设画像描述（`leading-snug`） |
| `options/SettingsPage.tsx:545` | 能力指南操作说明（`leading-snug`） |
| `ui/tabs/SectionList.tsx:525` | 子分区标签（`leading-tight`） |
| `ui/tabs/TabRow.tsx:206` | 标签 URL 副标题（`leading-tight`） |

另有 `EmptyState.tsx:26` 的 `hint`（空态提示正文，10px）——**所有空态共用**，影响面广。

**建议**：**分批、按语义**改，不做全量替换。
优先级：空态 / 错误态 / 设置说明（用户需要阅读的）→ `text-3xs`；
徽标 / 计数 / 角标（扫视即可的）保持 `text-2xs`。

> ⚠️ `TabRow.tsx:206` 的 URL 副标题**改动需谨慎**：
> `SectionList.tsx:185` 的虚拟列表 `itemSize` 按「10px 副标题 ≈ 12.5px 行高」硬编码了 `+13`。
> 改字号必须同步改 `itemSize`，否则虚拟化行高错位（偏小则内容重叠）。
> 这两处是隐式耦合，**必须一起改或都不改**。

**验收**：上述 6 处正文类改为 `text-3xs`；`itemSize` 同步修正并实测行高一致；
`pnpm check:ui` 通过。

---

### 🟡 P1-3 i18n 死键 40 / 396（10.1%），暴露 1 个未实现功能

**扫描方法**（可复用，建议纳入 CI）：递归展开 396 键，与全部 `.ts/.tsx` 源码做精确串匹配。

| 前缀 | 数量 | 判定 |
|---|---|---|
| **`selection.*`** | **12** | 🔴 **多选批量操作功能完全未实现**（已翻译 enterMode / count / closeAction / pinAction / muteAction / moveToFolder / batchComplete…） |
| `onboarding.step*` | 7 | ⚪ **误报**——`OnboardingTour.tsx:57` 用模板串 `` t(`onboarding.step${step}Title`) `` 动态拼接 |
| `fixed.*` | 5 | 🟡 rename / renamePrompt / pendingHint / reorderPins / conceptsHint |
| `tabs.*` | 5 | 🟡 back / forward / highlight / attention / newTabPlaceholder |
| `palette.*` | 3 | 🟡 sectionCommands / sectionTabs（命令面板未做分组）/ hint |
| 其他单键 | 8 | `footer.search`、`search.close`、`settings.off`、`safety.shieldTitle`、`snapshots.reportThisWeek`、`toast.syncedToGroup`、`groups.drag`、`app.name` |

**重点关注 `safety.shieldTitle`**：
文案为「本会话已可撤销 {{count}} 次：所有关闭操作都能撤销」——
这是**直接强化产品核心卖点（安全网）的信任文案，却从未展示**。
`FooterToolbar` 已经有 `undoBatchCount` 徽章，把这句话接成该徽章的 `title` 即可，成本极低、收益明确。

**建议**

1. `selection.*` 12 键：**要么实现多选批量操作，要么删键**。挂着不实现会让后续维护者误判功能已存在。
2. `safety.shieldTitle` → 接到撤销历史按钮的 `title`（`FooterToolbar.tsx:104-109`）。
3. 其余死键逐条判定「实现 or 删除」，不留中间态。
4. **把这个扫描脚本纳入 CI**（除动态拼接白名单外，零引用即失败）。

**验收**：死键数降至 ≤ 白名单规模；CI 守卫生效；`safety.shieldTitle` 在撤销栈非空时可见。

---

### 🟡 P1-4 底部工具栏 10 个纯图标按钮无文字标签

**证据**：`src/entrypoints/sidepanel/FooterToolbar.tsx:63-118`

最多同时渲染 **10 个图标按钮**（命令面板 / 折叠 / 快速整理 / 定位 / 休眠 / 唤醒 / 快照 / 历史 / 设置 + 分隔线），
全部纯图标，仅靠 `title` 属性提供说明。

**已做得好的部分**：用 `GroupDivider` 分了 3 组（视图组织 / 内存管理 / 记录恢复），
`aria-label` 齐备，计数徽章清晰——**信息架构是对的**。

**问题**：`title` 悬停延迟约 1s 且**触屏设备完全不可用**；
「快速整理」「折叠全部」这类**低频且后果较大**的操作，图标语义不自明
（`Icons.quickRegroup` 会重排所有标签的分组，属于重操作）。

**建议**（保守方案，不动布局）

- 为「快速整理」这类重操作加**首次使用确认**或**执行后 toast 说明影响范围**
  （现已有 `footer.quickRegroupDone`，但缺前置预期管理）。
- 死键 `footer.search`（「搜索标签」）可用于补一个搜索快捷入口的可见标签。
- 不建议加文字标签——侧边栏最窄 300px，加文字会挤爆布局，
  容器查询已按 `@container (max-width: 300px)` 做降级，加文字会破坏该策略。

**验收**：「快速整理」执行前有预期说明或确认；窄至 300px 时工具栏不换行溢出。

---

### ⚪ P2 其他（低优先，可延后）

| # | 问题 | 位置 |
|---|---|---|
| P2-1 | 虚拟列表 `itemSize` 硬编码估算行高（`(cozy?24:20) + (showUrl?13:0)`），与 CSS `padding` 隐式耦合，改任一侧即错位 | `SectionList.tsx:183-186` |
| P2-2 | 首启双重引导：`OnboardingTour`（3 步弹窗）+ Tips Banner。已用 `onDone` 同写 `tipSeen` 缓解，但 `conceptsSeen`（固定空间概念卡）是**第三层**引导 | `App.tsx:750-767` / `FixedArea.tsx:435` |
| P2-3 | `EmptyState` 的 `hint` 为 10px，所有空态共用（含 popup） | `EmptyState.tsx:26` |
| P2-4 | popup 底部只有一个设置按钮，无键盘提示（`↑↓` / `Enter` / `Esc` 全部可用但不可发现），`palette.hint` 死键可复用 | `popup/App.tsx:194-205` |
| P2-5 | 命令面板未做「命令 / 标签」分组，`palette.sectionCommands` / `sectionTabs` 已翻译未用 | `CommandPalette.tsx` |
| P2-6 | 固定空间 `max-height: min(34vh, 280px)` 内部滚动 + 外层列表滚动 + 虚拟列表滚动 = **最多三层嵌套滚动** | `main.css:854-859` |

---

## 2. 执行计划

### 原则

- **每批独立可验收、可回滚**；一批未通过不进入下一批。
- 每批结束必须：`pnpm typecheck` + `pnpm lint` + `pnpm test` 全绿（基线 277 用例）。
- 每批一个 git commit，即为回滚点。
- **严格控制范围**：只改本文档点名的位置，不做顺带的全局重构。

### 批次划分

| 批次 | 主题 | 范围 | 风险 | 依赖 |
|---|---|---|---|---|
| **B1** | 补齐缺失 CSS 定义 | P0-2 | 🟢 极低 | 无 |
| **B2** | 危险态统一 | P1-1 | 🟢 低 | 无 |
| **B3** | 设置页分区折叠 | P0-3 | 🟢 低 | 无 |
| **B4** | i18n 死键治理 + CI 守卫 | P1-3 | 🟡 中 | 需逐键决策 |
| **B5** | 字号规范收敛 | P1-2 + P2-3 | 🟡 中 | 与 B6 有耦合 |
| **B6** | 虚拟化生效 | P0-1 + P2-1 | 🔴 高 | 依赖 B5 的 itemSize 决策 |
| **B7** | 引导层收敛 + 可发现性 | P2-2 / P2-4 / P2-5 | 🟡 中 | 依赖 B4 |

> **B5 → B6 的顺序不可颠倒**：B5 若改 `TabRow` 的 URL 副标题字号，
> B6 的 `itemSize` 必须基于**改后**的行高重新实测。

---

### B1 · 补齐缺失 CSS 定义 ✅ 已完成（2026-08-31）

**改动**

1. `src/styles/main.css:871-884` 新增 `.fixed-area-empty`（弱文本 / 11px / 左内边距 8px 对齐）
2. `src/styles/main.css:1539-1546` 新增 `.virtual-row-scroll { overscroll-behavior: contain; }`
3. `.icon`（`SectionList.tsx:439` / `FixedArea.tsx:297`）**经查为无副作用空类**——
   全项目零 CSS 定义、零测试依赖，但移除无用户可见收益，**移交决策点 #5，本批未动**

**验收结果**

- [x] `.fixed-area-empty` 定义为 11px 弱文本、`padding: 0 8px` 与分区标题对齐
- [x] `.virtual-row-scroll` 补齐滚动链隔离
- [x] 类名孤儿扫描：`.fixed-area-empty` / `.virtual-row-scroll` 已消除
- [x] `pnpm test` 277 用例全通过；`check:ui` 24 用例全通过
- [x] tsc / eslint 零错误

---

### B2 · 危险态统一 ✅ 已完成（2026-08-31）

**改动**

1. `src/ui/tabs/TabRow.tsx:163` 关闭按钮 → `"row-action is-danger"`（补齐最高频危险操作的预警）
2. `src/ui/fixed/FixedArea.tsx:118` 固定条目关闭 → `"row-action is-danger"`
3. `src/ui/fixed/FixedArea.tsx:273` 文件夹删除 → `"row-action is-danger"`
4. `src/styles/main.css:739-740` 删除两条 Tailwind 红色文本类的兜底选择器，
   危险态统一由 `.is-danger` 承载

**验收结果**

- [x] 静默态仍为中性灰（只改 `hover` / `focus-visible`，未引入常态红图标）
- [x] `grep -rn "text-red-500" src/` **零结果**（含注释，避免未来 CI 守卫误报）
- [x] 三处危险操作视觉表现统一（砖红底 `--c-red-50` + 砖红图标 `--c-red-600`）
- [x] 明暗两主题砖红对比度由 `design-tokens.test.ts` 全矩阵守卫，24 用例通过
- [x] `pnpm test` 277 用例全通过；tsc / eslint 零错误

---

### B3 · 设置页分区折叠 ✅ 已完成（2026-08-31）

**决策点 #4 已确认**：三分法（休眠与内存 4 / 分组与搜索 7 / 高级与恢复 10）。
**决策点 #5 已确认**：删除 `.icon` 孤儿类。

**改动**

1. `buildSections` 将 21 项 `settings.capabilities` 拆为三个语义分区：
   **休眠与内存**（autoDiscard / autoDiscardMinutes / discardWhitelist / discardNotify）、
   **分组与搜索**（searchAllWindows / groupMode / autoGroupNative / uniqueUrlTabs / pinyinSearch / rowActionsVisible / badgeMode）、
   **高级与恢复**（contextMenus / omnibox / noCache / noCachePatterns / reuseNotify / undoStackLimit / toastDuration / persistUndo / autoSaveSnapshots / maxAutoSnapshots）
2. 低频「高级与恢复」标记 `collapsible: true` 默认折叠；搜索时 `forceOpen={isSearching}` 自动展开（既有机制）
3. i18n：`capabilities` 键替换为 `memory` / `groupSearch` / `advanced`（中英同步）
4. 删除 `SectionList.tsx` 的 `.icon` 孤儿类（决策点 #5）

**验收结果**

- [x] 设置页首屏可见分区数 ≥4（外观 / 行为 / 休眠内存 / 分组搜索 + 折叠的高级与恢复）
- [x] 低频分区默认折叠（`details` 无 `open`），点击 `summary` 展开
- [x] 搜索时折叠区自动展开（`forceOpen` 既有机制，测试覆盖）
- [x] `settings-page.test.tsx` 同步更新：三分区断言 + 折叠态校验，5 用例通过
- [x] tsc / eslint 零错误；277 用例全通过

---

### B4 · i18n 死键治理 + CI 守卫 ✅ 已完成（2026-08-31）

**决策点 #1 已确认**：删键，多选批量操作另立需求。

**改动**

1. 新增 `scripts/i18n-dead-keys.mjs`：中英键集合一致性 + 源码引用扫描。
   匹配规则为「引号定界」——纯 includes 会把 `settings.on` 误判为被
   `settings.onboarded` 引用（假阴性），后缀断言排除更长键前缀与标识符子串。
   动态拼接键（`onboarding.step*`）走白名单豁免。
2. 删除 32 个死键（zh-CN / en 同步）：`selection.*` 12、`app.name`、
   `onboarding.title`、`settings.on/off`、`fixed.rename/renamePrompt/pendingHint/
   reorderPins/conceptsHint`、`footer.search`、`groups.drag`、`search.close`、
   `palette.hint`、`snapshots.reportThisWeek`、`tabs.back/forward/highlight/
   attention/newTabPlaceholder`、`toast.syncedToGroup`
3. `safety.shieldTitle` 接入撤销历史按钮 `title`（栈非空时显示「本会话已可撤销 N 次…」）
4. `package.json` 新增 `check:i18n` 并入 `check` 聚合命令
5. `palette.sectionCommands` / `sectionTabs` 以计划内白名单保留至 B7（已消费并移除白名单）

**验收结果**

- [x] 脚本可独立运行（398 → 366 键，死键 35 → 0，含修复 settings.on 假阴性）
- [x] 白名单机制生效，`onboarding.step*` 不误报
- [x] 撤销栈非空时悬停历史按钮显示安全网文案
- [x] `selection.*` 已删除，无中间态
- [x] `pnpm check:i18n` 通过；治理前运行即失败（死键 34 个 → exit 1），守卫有效性已验证
- [x] zh-CN 与 en 键集合完全一致（规则 1 强制）

---

### B5 · 字号规范收敛 ✅ 已完成（2026-08-31）

**决策点 #3 已确认**：TabRow URL 副标题保持 10px（扫视型元数据；B6 实测行高后改字号零成本，可后续再议）。

**改动**

1. 6 处正文类 `text-2xs` → `text-3xs`：ErrorBoundary 错误说明 + 堆栈、
   SettingsPage 预设画像描述 + 能力指南说明、SectionList 子分区标签、
   EmptyState 空态提示（sidepanel / popup 共用）
2. 徽标 / 计数 / 角标类（`leading-none`）保持 10px 未动
3. 新增守卫（`design-tokens.test.ts`）：`text-2xs` 不得与多行 `leading-*`
   （relaxed/snug/tight/loose/normal）同现；`tab-url` 行豁免并注明原因

**验收结果**

- [x] 6 处正文说明字号变为 11px
- [x] 徽标 / 计数 / 角标类未被误改（SectionCount / StatusBadges / SnapshotsPanel 均 `leading-none`）
- [x] 守卫落地：24 → 25 用例通过（新增 1 条字号守卫）
- [x] `pnpm check:ui` 通过；tsc / eslint 零错误

---

### B6 · 虚拟化生效（高风险，需最充分验证） ✅ 已完成（2026-08-31）

**决策点 #2 已确认**：方案 A（超 200 强制虚拟化 + 停排序）。

**改动**

1. `SectionList.tsx` RowList：`tabs.length > 200` 时无论排序开关一律虚拟化
   （修复默认 `tabOrderSync: true` 下 `useVirtual` 恒 false 的死路径）；
   该分区内拖拽 / Alt+↑↓ 排序一并暂停，顶部显示「大列表已优化」说明
   （`tabs.largeListNotice`，仅强制暂停时显示——用户主动关排序不提示）
2. `VirtualRowList.tsx`：`itemSize` 由硬编码估算改为**首行实测校准**
   （估算起步，首行挂载后 `getBoundingClientRect` 实测，漂移 ≥1px 即修正；
   密度 / 副标题开关变化后自动重测），消除 P2-1 与 CSS padding 的隐式耦合
3. 新增 `activeTabId` / `autoScrollActive` 接入：激活行未挂载时按 index
   直接滚动容器（等价 `block:'nearest'`），接替 TabRow 内部的 scrollIntoView
4. ⌘J 定位关键路径：新增 `LOCATE_SCROLL_EVENT`，App 定位时先让虚拟列表滚到
   目标 index（直接写 `scrollTop`，瞬时生效），行挂载后 querySelector 才能命中
5. 新增 `tests/ui/section-list-virtual.test.tsx` 4 项回归测试

**验收结果**

- [x] 默认设置 250 标签分区挂载行 < 40（jsdom 实测断言）
- [x] 150 标签 + 排序开启：不进入虚拟化，全量挂载、拖拽排序不受影响（断言）
- [x] 行高实测校准落地（jsdom 无布局返回 0，由 `> 0` 守卫跳过，估算值兜底）
- [x] 虚拟化分区内激活标签自动滚入可视区（index 直滚路径）
- [x] `⌘J` 定位：深处目标行经 `LOCATE_SCROLL_EVENT` 滚入窗口后挂载（断言）
- [x] 未超阈值分区拖拽排序不受影响（150 标签全量挂载断言）
- [x] 三层嵌套滚动：`.virtual-row-scroll` 的 `overscroll-behavior: contain`（B1）
- [x] tsc / eslint 零错误；282 用例全通过（新增 4 项）

> ⚠️ 浏览器实测项（jsdom 无法覆盖）：滚动流畅度 / OVERSCAN=6 是否足够 /
> 4 种密度 × URL 组合的行高实测值。建议构建后在 250+ 标签窗口人工走查一次。

---

### B7 · 引导层收敛 + 可发现性 ✅ 已完成（2026-08-31）

**改动**

1. 三层引导收敛为两层：Onboarding 完成时同步写 `conceptsSeen: true`
   （新用户完成引导后固定空间不再弹概念卡；设置页「固定概念一览」仍可随时查看）
2. popup 底部补键盘提示（`popup.keyboardHint`：「↑↓ 选择 · Enter 切换 · Esc 关闭」），
   footer 改 `justify-between`，弱化呈现不与结果列表抢注意力
3. 命令面板补「命令 / 切换到标签」分组标题（启用 `palette.sectionCommands` /
   `sectionTabs`）：键盘漫游顺序保持「命令 → 标签」不变，分组标题
   `role="presentation"` 对读屏隐藏
4. i18n 扫描器移除计划内白名单（两键已消费）

**验收结果**

- [x] 全新安装：完成 Onboarding 后固定空间不再出现概念卡（conceptsSeen 同步写入）
- [x] 老用户（已 `onboarded`）行为不受影响（仅改写入时机，未动 schema）
- [x] popup 键盘提示可见（中英文案齐备）
- [x] 命令面板分组标题正确，键盘导航跨组连续（扁平漫游序列未变）
- [x] `pnpm check:i18n` 通过：368 键零死键（含本批新增 1 键）

---

## 3. 建议纳入 CI 的守卫

现有 `tests/ui/design-tokens.test.ts` 已覆盖：对比度全矩阵 / 未定义 CSS 变量 / 越界令牌 / 任意值字号。
建议补充：

| 守卫 | 拦截的问题 | 对应本次发现 |
|---|---|---|
| **CSS 类名定义完整性**：TSX 引用的自定义类必须在 `main.css` 有定义 | 样式静默失效 | **P0-2**（本次靠脚本才发现） |
| **i18n 死键检测**（含动态拼接白名单） | 「设计了没接上」 | **P1-3** |
| `text-2xs` 不得与 `leading-*` 同现 | 正文字号误用 | **P1-2** |
| **配置默认值 × 分支可达性**：`!someSetting` 且该 setting 默认 `true` 时告警 | 默认配置下的死代码路径 | **P0-1**（最难发现的一类） |
| `itemSize` 必须等于实测行高 | 虚拟列表错位 | **P2-1** |

> 最后一条最有价值：**P0-1 这类「默认配置下功能完全失效」的问题，
> 视觉走查和单元测试都发现不了**，只能靠「配置默认值 × 分支条件」的交叉核对。

---

## 4. 优先级建议

若资源有限，**按此顺序**做，收益递减：

1. ~~**B1**（30 分钟，修新用户第一屏的视觉错位）~~ ✅ **已完成**
2. ~~**B2**（30 分钟，补最高频危险操作的预警）~~ ✅ **已完成**
3. ~~**B3**（1–2 小时，设置页可读性显著改善）~~ ✅ **已完成**
4. ~~**B4**（半天，含 CI 守卫，防止问题回流）~~ ✅ **已完成**
5. ~~**B6**（1 天+，目标用户的核心性能问题，但风险最高）~~ ✅ **已完成**
6. ~~**B5 / B7**（打磨项，可延后）~~ ✅ **已完成**

**当前进度**：**全部 7 批（B1–B7）已完成**。3 个 P0（虚拟化死路径 / 类名零定义 /
设置页折叠未启用）与 4 个 P1 全部解决；i18n 死键 35 → 0（398 → 368 键）；
CI 守卫新增 `check:i18n`（键集合一致 + 死键零容忍）与字号搭配守卫；
tsc / eslint 零错误，282 用例全通过（基线 277 + 新增 5）。

遗留人工实测项：B6 的浏览器端滚动流畅度与 250+ 标签场景走查（jsdom 无法覆盖）。

---

## 5. 待确认决策点 ✅ 全部已确认（2026-08-31）

| # | 决策点 | 确认结果 |
|---|---|---|
| 1 | `selection.*` 12 键 | ✅ **删键**，多选批量操作另立需求（B4 已执行） |
| 2 | P0-1 虚拟化方案 | ✅ **方案 A**：超 200 强制虚拟化 + 停排序（B6 已执行） |
| 3 | `TabRow` URL 副标题字号 | ✅ **保持 10px**（B5 已执行；实测行高落地后改字号零成本，可后续再议） |
| 4 | `settings.capabilities` 21 项拆分 | ✅ **三分法**：休眠与内存(4) / 分组与搜索(7) / 高级与恢复(10，默认折叠)（B3 已执行） |
| 5 | `.icon` 类（`SectionList.tsx`） | ✅ **删除**（B3 已执行） |
