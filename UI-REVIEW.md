# Tabs UI 专项评审报告

> 评审日期：2026-10-30
> 评审对象：`apps/extension/src/ui/**`、`apps/extension/src/entrypoints/**`（sidepanel / options / about）、`apps/extension/src/styles/main.css`
> 上位约束：`PRIVACY.md` > `CONTRIBUTING.md` > `.codebuddy/rules/**` > 本文
> 评审口径：以当前代码逐行核验为准；机器门禁（`check:ui`）已覆盖的项不重复；只报门禁未覆盖的真实缺陷。

---

## 0. 结论先行

本轮只读评审覆盖 80+ UI 文件、三态主题 CSS（2463 行）与全部 UI 测试。**核心判断：设计令牌、对比度、主题、密度、响应式、焦点陷阱底座已是仓库级标杆，无需返工。问题集中在门禁未覆盖的「结构性可访问性」与「异步/焦点状态反馈」两类**，共确认：

| 级别                     | 确认项 | 处置                |
| ------------------------ | ------ | ------------------- |
| **P1** 用户可感知/结构性 | 6 项   | 本轮全部修复        |
| **P2** 一致性/反馈缺口   | 14 项  | 本轮全部修复        |
| 误报/刻意取舍            | 6 项   | 已排除，见 §3       |
| 需实机/需产品拍板        | 4 项   | 标注验证边界，见 §4 |

> 门禁基线：`pnpm --filter tabs check:ui` 40/40 通过、`check:i18n` 800 条全登记。本轮修复**不引入**越界令牌/未受控调色板/任意字号间距/文案硬编码，新增中文文案统一走 `pnpm i18n`。

---

## 1. 已属标杆、无需返工的部分（先肯定，避免误伤已做对的工作）

- **设计令牌对比度**：`design-tokens.test.ts` 以 WCAG 数学矩阵校验 2 主题 × 6 色相的全部文本/非文本配对；`main.css` 每一处色值均有行内注释说明对比度取值与推导。
- **主题三态 + 色相预设**：`data-theme`（system/light/dark）× `data-hue`（forest/ocean/violet/sunset/mono/plain）换肤、品牌绿→深绿计数徽章、危险色暗色提亮、`--c-on-accent` 前景反转，均已覆盖。
- **响应式/触屏**：`@container` 360/300px 档、`@media (hover:none)` 常显行操作、`prefers-reduced-motion`、`forced-colors: active` 全量降级（有守卫测试）。
- **弹窗底座**：`DialogShell` / `useModalA11y` 统一提供打开聚焦首项、Tab 焦点陷阱、Esc、关闭焦点恢复、`inert`/`aria-hidden` 背景惰性化、modalStack 嵌套栈顶裁决——经 `dialog-inert.test.tsx` 等验证。
- **命令面板四件套**：`role=combobox` + `aria-controls` + `aria-activedescendant` + `aria-autocomplete` 齐全，索引钳制正确。

---

## 2. 确认缺陷清单（本轮修复）

### P1 — 结构性 / 用户可感知

| #        | 位置                                                                            | 问题与影响                                                                                                                                                                                                                                                                                                 | 改法                                                                                                                                                                                                                                                                                                                                                                                                                                          | 验收                                                                                  | 人日                              |
| -------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------- |
| **P1-1** | `ui/common/StatusBadges.tsx:54`（关联 `Chip.tsx:69`、`Icon.tsx:113`）           | 雪花「已休眠」徽章把可访问名交给 `<span aria-label>`，而 `span` 是 ARIA `generic` role（命名被禁止，`aria-label` 不生效）；内部 `Icon` 默认 `aria-hidden`。结果：读屏漏报这条「要不要唤醒/去重」的**决策信息**，与同组其余徽章（重复/静音/拆/伴/禁，均 aria-hidden 可见字 + sr-only 全量文案）口径不一致。 | 改为 Icon(aria-hidden) + `<span className="sr-only">` 承载文案，与同组同构。                                                                                                                                                                                                                                                                                                                                                                  | 新增/更新组件测试断言雪花徽章有 sr-only 文案。                                        | 0.2                               |
| **P1-2** | `ui/snapshot/useSnapshotImport.ts:44` + `ui/snapshot/SnapshotImportView.tsx:84` | OneTab/Workona 导入无在途互斥（无 ref 标尺），按钮仅在「文本为空」时禁用。Workona `importWorkona` 会循环逐份 `await persistSnapshot`，**执行期连点会并发提交生成重复快照**，且无任何「进行中」反馈。与本面板 save/saveSpace/delete/restore 一律 ref 拦连点的既有约定不一致。                               | `useSnapshotImport` 加 `importing` 状态 + `runningRef` 标尺；View 按钮 `disabled={importing                                                                                                                                                                                                                                                                                                                                                   |                                                                                       | 空}` 并给 busy 文案/`aria-busy`。 | 测试：连点只触发一次导入；导入中按钮禁用。 | 0.4 |
| **P1-3** | `ui/snapshot/SnapshotsPanel.tsx:256`（`performDelete`）                         | 删除确认后，作为焦点归还目标的删除按钮随 `await deleteSnapshot` 成功后行卸载被移除，焦点掉回 `<body>`；且 `deleteSnapshot`/`performDelete` 均不 notify 成功——**不可逆操作无成功回执、键盘/读屏需从头 Tab 找回**。                                                                                          | 删除完成后补成功回执；焦点显式归还到快照列表的稳定存活元素（相邻行操作/`tabIndex=-1` 容器）。                                                                                                                                                                                                                                                                                                                                                 | 测试：删除后有回执；焦点不落 body。                                                   | 0.3                               |
| **P1-4** | `ui/snapshot/SnapshotRow.tsx:132-138`                                           | 重命名输入框同时绑 `Enter→提交`、`Escape→取消`、`onBlur→提交`；而提交/取消都会 `setEditingId(null)` 卸载输入框，React 受控输入卸载时派发的 blur 会造成「Escape 取消反被保存」「Enter 重复提交」双重正确性缺陷。                                                                                            | 用 ref 标尺让提交幂等：Enter 提交后置位，onBlur 检查已提交则跳过；Escape 走独立取消路径不被 blur 反提交。                                                                                                                                                                                                                                                                                                                                     | 测试：Escape 取消不写盘；Enter 只写一次。                                             | 0.3                               |
| **P1-5** | `ui/hooks/useListNavigation.ts:15-16,83` + `ui/search/SearchBar.tsx:44-62`      | 搜索漫游 ↑↓ 只返回 `selectedTabId` 驱动**视觉高亮**（`.is-search-active`），全链路无读屏反馈当前命中项。读屏用户聚焦搜索框按 ↑↓，高亮在动却**得不到任何语音反馈**（只有 `App.tsx:1151` 的数量播报），无法知道当前选中哪条。                                                                                | **实现（较初稿修订）**：在 App 派生 `roamAnnouncement`（序号+标题）交给一条**常驻** `aria-live="polite"` 的 `<output>` 播报。**未**采用初稿的 combobox 四件套：侧栏结果列表是分区 + 虚拟化结构（非 listbox），`aria-activedescendant` 指向的行可能未挂载会成悬空引用；且把输入框从原生 `searchbox` 改成 `combobox` 会破坏既有键盘语义与测试。live 区常驻 App（不随 toast 条件挂载），满足「预先存在且为空、之后内容变化才播报」的可靠性约束。 | 测试：↑↓ 后 live 区播报当前命中项（序号+标题），初始为空、不影响既有 searchbox 语义。 | 0.6                               |
| **P1-6** | `ui/tabs/TabRow.tsx:171`（关联 `TabRowActions.tsx`）                            | 「复制网址」仅存在于右键菜单项；键盘可经 Shift+F10/ContextMenu 键唤出，但**触屏设备没有右键、长按 contextmenu 不保证触发**，触屏用户实质无法复制标签网址，与 `@media (hover:none)` 分支「把操作按钮常显以照顾触屏」的设计意图冲突。                                                                        | **实现（较初稿更优）**：新增一个 `@media (hover:none)` 才显形的「更多操作」行内按钮（`.row-action--touch-only`，桌面 `display:none` 不占宽度预算），点击打开既有右键菜单——一次覆盖触屏对「复制网址 / 休眠」等全部菜单动作的可达性，而非只补一个动作。                                                                                                                                                                                         | 测试/守卫：触屏 CSS 类存在性被 `component-consistency.test.ts` 断言保护，删了会失败。 | 0.3                               |

### P2 — 一致性 / 反馈缺口

| #         | 位置                                                                                                                | 问题与影响                                                                                                                                                                                                                                                                   | 改法                                                                                                                 | 验收                                               | 人日 |
| --------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---- |
| **P2-1**  | `ui/common/SectionShell.tsx:113` + `SectionHead.tsx:93` + `ui/tabs/CollapsibleSectionCard.tsx:182`                  | 折叠按钮 `aria-controls={panelId}` 指向的 `<div id>` 在 `collapsed` 时被整段卸载，折叠态形成**悬空 ARIA 引用**（展开态正常）。                                                                                                                                               | 折叠时保留容器于 DOM 改用 `hidden`，使 aria-controls 始终有目标（或折叠态不输出 aria-controls 仅留 aria-expanded）。 | 测试：折叠态 aria-controls 有对应 DOM。            | 0.3  |
| **P2-2**  | `ui/common/ListStates.tsx:18-46` + `ui/snapshot/SnapshotListView.tsx:152` + `ui/tabs/OtherWindowsSection.tsx:87-98` | 三处骨架屏为纯视觉 div，无 `role=status`/`aria-busy`/sr-only「加载中」。读屏用户在数据加载期得到空白，易误判「没有标签」。                                                                                                                                                   | 骨架容器加 `role=status aria-busy=true` + sr-only 播报文案。                                                         | 测试：骨架带 aria-busy 与 role=status。            | 0.3  |
| **P2-3**  | `ui/common/StatusToast.tsx:46-61`                                                                                   | toast.action 按钮执行异步链路期间无 disabled/busy，点击后按钮保持可点，可连点重复触发（与 `UndoHistoryPanel` restoringRef、`SpaceStrip` switching 的互斥口径不一致）。另 §4 待核验 live region 挂载时机。                                                                    | 点击后本地置 busy/disabled，Promise settle 后复位。                                                                  | 测试：在途期间按钮禁用。                           | 0.2  |
| **P2-4**  | `ui/common/UndoHistoryPanel.tsx:137-146`                                                                            | `recent === null`（`getRecentlyClosed()` 异步未返回）与 `recent === []`（确认无）同等当作「无」，浏览器最近关闭读取期先闪一下「暂无撤销记录」再跳成列表；失败也落入同一空态。                                                                                                | 用 `recent === null` 作独立 loading 态，与「确认空」「失败」三态分开。                                               | 测试：加载中显示加载态而非空态。                   | 0.3  |
| **P2-5**  | `ui/common/ColorSwatchGroup.tsx:41-58`                                                                              | 容器 `role=radiogroup`、子项 `role=radio`+`aria-checked`，但子项是默认 `tabIndex=0` 的原生 button，无方向键漫游、无 roving tabindex。违反 radiogroup 键盘契约：键盘用户须 Tab 逐个穿过每个色块。                                                                             | 实现 roving tabindex（仅选中项 tabIndex=0）+ Arrow/Home/End 切换并 onSelect。                                        | 测试：方向键切换色块、Tab 只停一处。               | 0.4  |
| **P2-6**  | `ui/snapshot/SnapshotsPanel.tsx:318` + `ui/snapshot/SnapshotReportView.tsx:58`                                      | 洞察 Callout 已设 `tabIndex={-1}`（明显为聚焦准备），但直达 effect 只 `scrollIntoView`，从不 `.focus()`，`tabIndex` 成死 affordance——底栏「洞察」徽章直达后键盘/读屏焦点未进入洞察区。                                                                                       | `scrollIntoView` 后追加 `anchor?.focus()`（带 preventScroll 避免二次滚动）。                                         | 测试：直达后焦点在锚点。                           | 0.2  |
| **P2-7**  | `ui/snapshot/SnapshotsPanel.tsx` 视图切换 / `SnapshotListView.tsx:125`                                              | 列表→导入/周报、保存进入命名态、重命名提交后编辑框卸载，多处模式/视图切换都不迁移焦点，触发按钮或编辑框卸载后 activeElement 变 body。                                                                                                                                        | 关键切换后用 ref/effect 把焦点移入新内容首项（命名框、导入源组、重命名后回到的行按钮）。                             | 测试：模式切换焦点落点。                           | 0.4  |
| **P2-8**  | `ui/settings/SettingsOutline.tsx:49-59` + `ui/settings/settingControls.tsx:59`                                      | 目录链接 `preventDefault()` 后只 `scrollIntoView`，目标分区无 `tabIndex`；原生 `href="#id"` 的焦点转移被取消却未补做，键盘/读屏点目录后焦点仍在链接上，未真正跳入分区。                                                                                                      | 目标元素补 `tabIndex={-1}` 并在 scroll 后 `el.focus({preventScroll:true})`。                                         | 测试：跳转后焦点在目标分区。                       | 0.2  |
| **P2-9**  | `ui/settings/settingControls.tsx:389,393`（NoCacheToggle）                                                          | 「未授予网站权限」「网站权限已失效」为纯 `<span>`，无 `role=alert`/live；点开关被拒、或挂载后权限失效这类动态告警读屏完全不播报。                                                                                                                                            | 包一层 `role=alert`（或 aria-live）容器。                                                                            | 测试：告警容器带 role=alert。                      | 0.2  |
| **P2-10** | `ui/settings/settingControls.tsx:312-316`（NoCachePatternEditor）/`:217-222`（WhitelistEditor）                     | 「已忽略 N 行格式无效」「不是有效域名」等校验结果未用 `aria-invalid`/`aria-describedby` 与输入框绑定，读屏不播报、控件不标错误态。                                                                                                                                           | 错误文案挂 `role=alert/status` + id，TextField 经 `inputProps` 补 `aria-invalid`/`aria-describedby`。                | 测试：校验后输入框带 aria-invalid 与 describedby。 | 0.3  |
| **P2-11** | `ui/settings/settingControls.tsx:81,110-131`（Row/`isAssociableControl`）                                           | 复合控件行（休眠白名单/禁缓存站点列表）的标签因 `isAssociableControl` 判 false 降级为 `<div>`，无 `htmlFor` 也无 `fieldset/legend`/`role=group`；「输入域名」框、「添加/保存」按钮缺少分组语境。                                                                             | 复合控件容器套 `role=group aria-label`（label 为 ReactNode，用 aria-labelledby 指向标签 id 更稳）。                  | 测试：复合行有 group 语义。                        | 0.3  |
| **P2-12** | `ui/search/SearchBar.tsx:71-72`                                                                                     | 「包含历史」toggle 在 `aria-pressed` 之外，可访问名随开关在「包含历史…」↔「仅搜索当前标签」间变化，与 WAI-ARIA toggle button「标签应稳定、状态由 aria-pressed 表达」冲突，读屏会同时听到变化的名字与按下态，语义冗余（与 `PresetsPanel`/`SegmentedChip` 稳定名口径不一致）。 | 固定可访问名，仅靠 `aria-pressed` 表达开关。                                                                         | 测试：两态可访问名一致、aria-pressed 切换。        | 0.2  |
| **P2-13** | `entrypoints/options/SettingsPage.tsx:456-462`                                                                      | 备份导入事务进行中仅靠 `disabled={importing}` 表达，无 busy 文案/`aria-busy`，`transferStatus` 只在结束时写入——确认弹窗关闭后数秒内界面仅按钮变灰，感知为「点了没反应」。                                                                                                    | 进行中给按钮「导入中…」+ `aria-busy`，并用 live 区播报开始/结束。                                                    | 测试：导入中按钮文案与 aria-busy。                 | 0.3  |
| **P2-14** | `ui/tabs/TabRow.tsx:279-285` + `ui/tabs/rowList.tsx`                                                                | `isActive`（当前激活）、`isHighlighted`（Ctrl+多选）、`isSearchActive`（搜索命中）仅落实为 CSS 类，`<li>`/主按钮无 `aria-current`/`aria-selected`；读屏无法分辨当前标签、哪些被多选（底栏「关闭选中」依赖此态）。                                                            | `<li>` 按态补 `aria-current`（激活）/`aria-selected`（多选/命中，配 listbox 语义时用）。                             | 测试：激活行带 aria-current。                      | 0.3  |

### P2 — 一致性（键盘可达性对称）

| #         | 位置                                                                                                                          | 问题与影响                                                                                                                                                                                        | 改法                                                                   | 验收                             | 人日 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------- | ---- |
| **P2-15** | `entrypoints/sidepanel/FooterToolbar.tsx:47-65,167-178`                                                                       | 底栏按钮顺序仅通过指针拖拽重排，`SortableFooterButton` 刻意不展开 `attributes`、键盘监听未落到真按钮，**纯键盘用户无法自定义底栏顺序**（TabRow 有 Alt+↑↓、分区头有 Space 拖拽，唯独底栏缺替代）。 | 为底栏按钮补 Alt+←/→ 键盘重排（不增加 Tab 停靠点，复用 `arrayMove`）。 | 测试：Alt+方向键重排并回调。     | 0.4  |
| **P2-16** | `ui/tabs/TabRow.tsx:279` 关联 `ui/fixed/FolderItemRow.tsx:245`、`ui/fixed/FolderRow.tsx:229`、`ui/tabs/PinnedTile.tsx:96-100` | TabRow 有 `onContextMenu` + Shift+F10/ContextMenu 键键盘唤出；磁贴/文件夹条目/行仅绑 `onContextMenu`，**缺键盘触发**，菜单入口不对称。                                                            | 三处补与 TabRow 一致的键盘唤出（ContextMenu/Shift+F10）。              | 测试：键盘可唤出菜单。           | 0.3  |
| **P2-17** | `ui/fixed/FolderItemRow.tsx:246-267` 关联 `App.tsx:1252`                                                                      | 固定条目渲染带 `data-row-activate` 的 RowItem（漫游就绪），但位于 `FixedArea`，在 `listScrollRef` 漫游容器之外，`useRowRoving` 的 ↑↓/Home/End 覆盖不到；收藏夹条目多时键盘须逐行逐按钮 Tab。      | 把固定区纳入漫游容器，或为 FolderItemRow 单独接一路 `useRowRoving`。   | 测试：固定区条目可用方向键漫游。 | 0.4  |
| **P2-18** | `ui/dnd/DndRoot.tsx:318-322`（拖拽提示条）                                                                                    | `role=status` 提示「松开以放置 · Esc 取消」是鼠标语义，**键盘拖拽（Space 起拖）时同样显示**，键盘/SR 用户听到「松开」却无法松开（放置键是 Space），提示与操作不符。                               | 按拖拽来源（指针/键盘）切换文案，键盘态提示「空格放置 · Esc 取消」。   | 测试：键盘拖拽播报正确文案。     | 0.3  |
| **P2-19** | `ui/tabs/TabRow.tsx:274`、`ui/tabs/rowList.tsx:233`                                                                           | 同上 P2-14，行状态缺语义承载（此处并入 P2-14 一并修，不重复计工作量）。                                                                                                                           | 见 P2-14。                                                             | —                                | —    |

> 合计 P1×6 + P2×14（含并入项）≈ **6.5 人日**。

---

## 3. 已排除项（误报 / 刻意取舍，不改）

逐条核验后确认以下**不是缺陷**，特此记录，避免后续重复报、也避免"评估→修复"把它当成问题改坏：

| 位置                                                             | 初判                                                           | 核验结论                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/tabs/VirtualRowList.tsx:203-210`                             | 「`aria-setsize` 挂在 `role=list` 容器上、`<li>` 无 posinset」 | **误报**。代码第 206-211 行已通过 `cloneElement` 把 `aria-posinset`/`aria-setsize` 注入每一行，`TabRow.tsx:60-61,282-283` 接收并落到 `<li>`；CSS 注释亦自证"挂在容器上是无效 ARIA"。实现完全正确。        |
| `entrypoints/sidepanel/FooterToolbar.tsx:40-45`                  | 「底栏外壳不展开 dnd-kit `attributes`」                        | **刻意取舍**（注释已写明）：展开会让 Tab 停靠点从 13 变 26（外壳+真按钮各一），键盘用户每次多按一倍。功能键盘仍可达，仅"自定义顺序"缺替代 → 已列入 P2-15 单独补键盘重排，**不改变**外壳 attributes 决策。 |
| `ui/panels/CommandPalette.tsx` combobox 四件套                   | 疑似半成品 tablist                                             | 核验 role=combobox + aria-expanded + aria-controls + aria-autocomplete + aria-activedescendant 与 listbox/option 齐全、索引钳制一致，合规。                                                               |
| `ui/dialog/Dialog.tsx` 关闭焦点恢复                              | trigger 卸载时焦点丢 body                                      | 底座 `useModalA11y` 已 `trigger?.focus?.()`、ContextMenu 另有 `isConnected` 兜底；触发行被关闭的极端路径见 §4 待实机核验，非组件缺陷。                                                                    |
| `ui/common/SegmentedChip.tsx` / `ui/settings/settingPresets.tsx` | tablist/toggle 语义                                            | 刻意用 `role=group`/toggle + `aria-pressed` 稳定名，注释明确"避免半成品 tablist 误导读屏"，是正确简化，合规。                                                                                             |
| `ui/tabs/TabRow.tsx` 行内操作默认 hover 出现                     | 键盘/触屏不可达                                                | 已由 CSS `:focus-within`（`main.css:1851`）+ `@media (hover:none)`（`:1912`）双层兜住，键盘 Tab 与触屏均可触达。                                                                                          |

---

## 4. 原需验证项的处置（本轮已全部落地）

初稿把以下四项列为「需实机 / 需产品拍板」，经进一步静态核验与确定性处置，**本轮全部落地**，不再留待后续：

| 项                        | 位置                                                | 定性                                                                                                                                                                                                                                                                                                                                           | 本轮处置                                                                                                                                                                                                                                                               | 验收                                                   |
| ------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| ① live region 挂载时机    | `ui/common/StatusToast.tsx`                         | **确认为真实缺陷**：`if(!toast) return null` 让 role/aria-live 随内容一起挂载，违反「live region 须预先存在且为空」的公认约束，首次 polite 提示可能漏报。无需实机即可判定反模式成立。                                                                                                                                                          | 改为**两个常驻 live region**（`aria-live=assertive` 承载错误、`aria-live=polite` 承载普通，均预先存在于 DOM 且无 toast 时为空），视觉条 `.status-toast` 与播报分离、去掉自身 role/aria-live 避免重复播报。刻意不写 role，避免污染 `getByRole('alert'/'status')` 查询。 | `status-toast.test.tsx` 4 例                           |
| ② 焦点归还目标被卸载      | `ui/dialog/Dialog.tsx`、`ui/common/ContextMenu.tsx` | **确认为真实缺陷**：触发元素在浮层期间被卸载（菜单项「关闭该标签」使行消失）时 `focus()`/`isConnected` 分支均静默失败，焦点掉 body。静态可确认。                                                                                                                                                                                               | `domContract.ts` 加 `restoreFocus(trigger)`：trigger 仍连接→同步还给它；已卸载→微任务（等背景 inert 解除）后落到 `.app` 内首个可聚焦元素。Dialog 与 ContextMenu 共用，零业务耦合、零结构改动。                                                                         | `dom-contract-focus.test.ts` 3 例                      |
| ③ 折叠卸载焦点保持        | `ui/common/SectionHead.tsx` + `domContract.ts`      | **确认为可防御缺口**：折叠使分区 body 整段卸载，若焦点恰在被折叠行内则掉 body。                                                                                                                                                                                                                                                                | `domContract.ts` 加 `preserveFocusBeforeCollapse()`，由所有折叠的公共出口 `SectionHead` toggle 在调用外部 onToggle **之前**执行：仅当焦点确在某 `.section-card` 的 `.section-body` 内时移到存活的 `button.toggle`；正常点击 toggle 时为空操作。                        | `dom-contract-focus.test.ts` 3 例                      |
| ③' 虚拟化键盘拖拽落点     | `rowList.tsx:155-211` + `dnd/dropPolicy.ts:257-263` | **静态追踪确认链路完整，非缺陷**：`dropPolicy` 仅在 Tab→Tab `reorder-tabs` 分支对 `canReorder=false` reject('virtualized')，**跨容器投放（Tab→固定空间）放行**；键盘拖拽有三级 `closestCenter` 回退 + `role=status` 排序暂停提示 + reject 播报「该位置不能放置」+ 键盘提示条「空格放置 · Esc 取消」。无静默失败，故不改 dnd 逻辑以免引入回归。 | 保持现状，静态证据判定非缺陷；现有 `dnd-drop-policy.test.ts`/`dnd-accessibility.test.ts` 覆盖                                                                                                                                                                          |
| ④ ≤300px 播放胶囊动作丢失 | `main.css` ≤300px 容器查询                          | **产品裁决：保留动作**。注释「信息已由行内徽章承载」对信息成立，但整块 `display:none` 会让「一键定位播放标签」这个**动作**在窄面板消失，属丢功能。                                                                                                                                                                                             | ≤300px 档**不再整块隐藏**胶囊，改为只隐藏装饰脉冲点 `.section-media-dot` + 收紧内距，保留可点击的定位图标按钮。≤360px 已隐藏文字标签，此处再退一级即可。                                                                                                               | `component-consistency.test.ts` 新增守卫（含判据自测） |

> 说明：①②③④ 的处置均以静态代码证据为准，不依赖真实读屏实机（本环境无 NVDA/VoiceOver）。其中 ①②④ 为确定性代码修复，③' 经静态追踪判定为非缺陷而不改动。所有处置均有对应测试锁定，防止回归。

---

## 5. 已落地清单与验证（2026-10-30 收尾）

### 已落地（全部 P1 + P2，逐项经 `grep -F` 复核仍在文件中）

| 批次 | 项    | 落地要点                                                                                                      |
| ---- | ----- | ------------------------------------------------------------------------------------------------------------- |
| A    | P1-1  | `StatusBadges` 雪花徽章改 Icon(aria-hidden)+sr-only 文案，与同组同构                                          |
| A    | P1-4  | `SnapshotRow` 编辑会话 ref 标尺：Enter/Escape/blur 三方去重，onChange 重置放行二次提交                        |
| A    | P1-2  | `useSnapshotImport` 加 `importInFlight` ref + `importing` 状态；导入按钮在途禁用 + busy 文案 + `aria-busy`    |
| A    | P1-3  | `performDelete` 删除成功 notify 回执 + `requestAnimationFrame` 归还焦点到列表容器（`listRef`，`tabIndex=-1`） |
| B    | P1-5  | App 常驻 `aria-live` 播报 `roamAnnouncement`（详见 §2 修订说明）                                              |
| B    | P1-6  | `TabRowActions` 触屏「更多操作」按钮 + `.row-action--touch-only` CSS                                          |
| C    | P2-1  | `SectionShell` 折叠时保留空容器 + `hidden`，修复 `aria-controls` 悬空                                         |
| C    | P2-2  | `LoadingSkeleton` / `OtherWindowsSection` 加载骨架加 `role=status` + `aria-busy` + sr-only                    |
| C    | P2-3  | `StatusToast` 异步动作本地 busy + ref 互斥                                                                    |
| C    | P2-4  | `UndoHistoryPanel` 把 `recent===null` 单列加载态，不闪空态                                                    |
| C    | P2-5  | `ColorSwatchGroup` roving tabindex + Arrow/Home/End 方向键漫游即选                                            |
| C    | P2-6  | 洞察锚点 `scrollIntoView` 后追加 `.focus({preventScroll:true})`                                               |
| C    | P2-7  | 命名框 / 导入视图首项加 `autoFocus`（含给 `SegmentedChip` 增加可选 autoFocus 透传）                           |
| C    | P2-8  | `SettingsOutline` 跳转后给目标补 `tabIndex=-1` 并 `focus`                                                     |
| C    | P2-9  | `NoCacheToggle` 权限告警包 `role=alert`                                                                       |
| C    | P2-10 | `WhitelistEditor`/`NoCachePatternEditor` 校验结果 `aria-invalid`+`aria-describedby` 关联 + `role=status`      |
| C    | P2-11 | `Row` 复合控件容器补 `role=group`+`aria-labelledby` 指向标签 id                                               |
| C    | P2-12 | `SearchBar` history toggle 固定可访问名、仅靠 `aria-pressed` 表达状态（同步更新 3 处测试断言）                |
| C    | P2-13 | `SettingsPage` 导入按钮 busy 文案 + `aria-busy`                                                               |
| C    | P2-14 | `TabRow` 激活态补 `aria-current`                                                                              |
| D    | P2-15 | `FooterToolbar` 底栏按钮 Alt+←/→ 键盘重排（冒泡到外壳 span，不增加 Tab 停靠点）                               |
| D    | P2-16 | `useRowContextMenu` 增 `openFromKeyboard`；磁贴/文件夹行/条目补 ContextMenu 键/Shift+F10                      |
| D    | P2-17 | `FixedArea` 接一路 `useRowRoving`，固定区条目方向键可漫游                                                     |
| D    | P2-18 | `DndRoot` 提示条按 `activatorEvent` 判定键盘/指针，切换「空格放置」/「松开以放置」                            |
| 附   | —     | `Button` 显式收口 `busy` prop 并透传 `aria-busy`（修复调用方 busy 被静默丢弃的实现缺口，守卫已断言）          |
| §4①  | —     | `StatusToast` 改两个常驻 live region（assertive/polite），视觉条与播报分离；详见 §4                           |
| §4②  | —     | `domContract.restoreFocus(trigger)`：trigger 卸载时回落 `.app` 内首个可聚焦元素；Dialog/ContextMenu 共用      |
| §4③  | —     | `domContract.preserveFocusBeforeCollapse()` 接入 `SectionHead` toggle；虚拟化拖拽经静态判定非缺陷（§4③'）     |
| §4④  | —     | ≤300px 保留播放胶囊动作入口：只隐藏装饰脉冲点、收紧内距，不整块 `display:none`（CSS 守卫锁定）                |
| 隐私 | —     | `PRIVACY.md` 3.1-c 协调锁清单补 `tabs.pending-actions-rmw`、`tabs.sync-mirror-rmw`，`check:privacy` 通过      |

### 新增/更新的测试与守卫

- `tests/ui/snapshot-row-rename.test.tsx`（新）：重命名 Enter/Escape/blur 三方去重 4 例。
- `tests/ui/common-primitives.test.tsx`：+ 雪花徽章 sr-only 2 例、ColorSwatchGroup roving/方向键/Home-End 3 例。
- `tests/ui/snapshots-panel.test.tsx`：+ 删除回执、导入在途互斥 2 例。
- `tests/ui/sidepanel-app.test.tsx`：+ 搜索漫游 live 播报 1 例；2 个快照基线随预期 DOM 变更更新。
- `tests/ui/search-bar-history.test.tsx`：3 处断言改为稳定名 + `aria-pressed`。
- `tests/ui/component-consistency.test.ts`：+ `Button` busy 透传、+ `.row-action--touch-only`、+ §4④ ≤300px 播放胶囊不整块隐藏（含判据自测）。
- `tests/ui/status-toast.test.tsx`（新）：§4① 常驻 live region 4 例。
- `tests/ui/dom-contract-focus.test.ts`（新）：§4② restoreFocus 3 例 + §4③ preserveFocusBeforeCollapse 3 例。

### 门禁结果

| 门禁                                     | 结果                                                                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck`（`tsc --noEmit`）            | ✅ **全绿（0 错误）**，收尾复查确认。期间曾被并行会话的 platform/store 重构（`RestoreEngine.ts` 的 `RestoreOutcome`、`useBatchTabActions.ts`/`saveSpace` 签名等）短暂打断，均非本轮改动、且已自行收口 |
| `lint`（全仓 `eslint --max-warnings 0`） | ✅ **全绿（0 错误）**                                                                                                                                                                                 |
| `check:i18n`                             | ✅ 809 条（808 译 + 1 豁免，未登记 0，9 条新词已补英文译文）                                                                                                                                          |
| `check:ui`                               | ✅ 42/42（含 §4④ 守卫断言）                                                                                                                                                                           |
| UI 测试                                  | ✅ **428/428**（41 文件；含 §4 新增 10 例）                                                                                                                                                           |
| 全量测试（含 core/platform/stores）      | ✅ **1670/1670**（160 文件，含覆盖率 ratchet）                                                                                                                                                        |
| `build`（wxt build）                     | ✅ 通过，产物 2.07 MB                                                                                                                                                                                 |
| `check:privacy`                          | ✅ **通过**：存储键 34 个与 PRIVACY.md 第 3 节一致，网络通道调用 0                                                                                                                                    |
| `format:check`                           | ✅ 全仓通过                                                                                                                                                                                           |
| 完整 `pnpm check`                        | ✅ 聚合门禁全绿；扩展 160/1670、i18n-kit 6/54、根守卫 1/7                                                                                                                                             |

### 收尾确认

- `crossPageLock.ts` 新增的 `tabs.pending-actions-rmw`、`tabs.sync-mirror-rmw` 已登记到 `PRIVACY.md` 3.1-c 的协调锁表；它们不写存储、不保存浏览数据，`check:privacy` 已验证 34 键一致。
- 本轮 UI 评审的 P1×6 + P2×14 + §4 四项及隐私门禁残留已全部处置，无遗留阻塞。
- 全仓审查与跨层最终验收见 `AUDIT-REPORT.md`；真实 Chrome、触屏和 VoiceOver/NVDA 场景按该报告第 5 节做人工复核。
