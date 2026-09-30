# Tabs 产品优化与修复计划

**版本**：v1.0
**日期**：2026-09-30
**代码基线**：git HEAD `94a647c` + 本轮已落地的 R1/R2/R3 改动
**配套文档**：[product-design-analysis.md](./product-design-analysis.md)（分析依据）、[product-design.md](./product-design.md)（产品规格）

> **本文档的口径**
> 每条计划都标注**缺陷编号**（对应分析报告 §3）、**证据位置**（`file:line`）、**落地步骤**、**验收标准**、**预估成本**。
> 已完成的项标注 ✅ 并附实际改动与验证结果；未做的标注 ⬜。
> 成本单位为**人日**，是量级估算而非承诺。凡属推断标注「**推断**」。

---

## 0. 本轮已完成的修复（P0 前三项）

三项均已在本次会话中改完并通过**全量门禁**（`typecheck` / `lint` / `check:i18n` / `test` 98 文件 1000 用例 / `build` / `check:privacy`）。

| 编号 | 缺陷 | 改动 | 验证 |
|------|------|------|------|
| **R2** ✅ | C-1, C-2 同步范围口径失真 | 13 处文案/注释修正 | `check:i18n` 通过（757 键一致、死键 0） |
| **R3** ✅ | IX-2, C-3 重做无入口 | 撤销历史常驻按钮 + `⌘⇧Z` | 新增 2 个用例，全量 1000 通过 |
| **R1** ✅ | IX-1 批量破坏性动作无确认 | 快速整理 / 清理重复 加确认闸门；分区关闭带数量 | 全量门禁通过 |

### R2 · 同步范围口径修正（C-1 / C-2）

**问题**：`scheduleMirror({ folders, pins, settings })`（`context.ts:61`）与 `MirrorPayloadSchema`（`SyncMirror.ts:25-30`，含 `pins`）表明**常驻磁贴确实在镜像范围内**，但用户可读文本普遍只写「文件夹与设置」。

**实际修正 13 处**（超出最初判断的 4 处——首轮低估，第二轮全仓扫描补齐）：

| 文件 | 位置 | 原文 → 修正 |
|------|------|------------|
| `zh-CN/translation.json` | :231 `syncMirrorHint` | 「文件夹与设置」→「文件夹、常驻磁贴与设置」 |
| `zh-CN/translation.json` | :715 `domData2Body` | 同上 |
| `en/translation.json` | :231 `syncMirrorHint` | "folders and settings" → "folders, always-on tiles and settings" |
| `en/translation.json` | :715 `domData2Body` | 同上 |
| `PRIVACY.md` | :3 摘要 | 补磁贴 |
| `PRIVACY.md` | :48 存储说明 | 补磁贴 |
| `PRIVACY.md` | :71 同步范围 | 「**仅**文件夹与设置」→ 补磁贴并去掉「仅」 |
| `README.md` | :5、:74、:155 | 三处补磁贴 |
| `SECURITY.md` | :41 安全基线 | 补磁贴 |
| `models.ts` | :214 `syncMirrorEnabled` 注释 | 补磁贴 |
| `SyncMirror.ts` | :14 文件头 | 「设置 + 文件夹」→ 补 pins，并加注「对外文案必须与之一致」 |

**定性说明（重要，避免误读）**：这不是「偷偷上传未声明的数据」。`PRIVACY.md:14` 与 `:60` **本来就已写明磁贴**；问题在于**文档自相矛盾**（:71 写「仅」）与**设置项说明漏写**。修复性质是「说明书补正」。

### R3 · 重做接入常驻 UI（IX-2 / C-3）

重做后端早已完备（`undoStore.redo()`、i18n、4 个测试），但**唯一出口是撤销后 toast 上 7 秒的一次性按钮**。

改动：
1. `UndoHistoryPanel.tsx` —— 订阅 `redoBatches` / `redo` / `redoing`，在「本产品撤销」分区标题行右侧条件出现「重做」按钮（`redoBatches.length > 0`），`redoing` 时禁用；`hasAny` 计入重做栈（否则「有重做项但撤销栈空」会误显示空态）。
2. `useGlobalHotkeys.ts:56-77` —— `⌘⇧Z` 从 `return` 改为调用 `redoLast()`。
3. `App.tsx:390` —— `redoLast` 接到 `useUndoStore.getState().redo()`。
4. 新增 `undo.redoHint` 键（中英）。

**过程中发现并修掉的一个自引入缺陷**：我最初把 `if (event.shiftKey)` 分支放在文本编辑闸门**之前**，导致 `⌘⇧Z` 在搜索框内会抢走浏览器原生文本重做。新增的测试用例立刻捕获了它。修正后闸门**同时**覆盖撤销与重做两个分支，并在代码注释里写明这条约束（防止后人再犯）。

### R1 · 批量破坏性动作补确认闸门（IX-1）

同一产品内此前存在**两档安全级别**：快照删除/恢复有确认，而「快速整理」（不可逆）和「清理重复」（影响 N 个标签）点下即执行。

改动：
- **快速整理** —— 拆为 `handleQuickRegroup`（算影响面 → 弹确认）与 `runQuickRegroup`（真正执行）。确认文案带「将打散 N 个现有分组、重新归拢 M 个标签」+ 明确「不可撤销」。
- **清理重复** —— 拆为 `handleCloseDuplicates` / `runCloseDuplicates`，确认文案带「将关闭 N 个重复标签」+「可一键撤销」。
- **关闭整个分区** —— `sectionCards.tsx:455` 的 `closeTitle` 补 `count`，让「会关掉几个」在点之前可见（可撤销，故只需数量预览不需二次确认）。
- 新增 6 个 i18n 键（中英各 6）。

**过程中发现并修掉的一个层叠缺陷**：确认弹窗最初渲染在 `SnapshotsPanel` **之前**，从快照面板内部触发的「清理重复」会弹出一个**叠在面板下方、用户看不见**的确认框。已把两个 `ConfirmDialog` 移到 JSX 末尾并加注释说明原因。

---

## 0.5 第二轮落地记录（R4–R19 全部处理）

第二轮把剩余 17 项（R4–R19 + R8 评审 + docs 复核）全部处理完。**最终全量门禁通过**：

```
typecheck / lint / check:i18n（772 键一致、死键 0）/ test（104 文件 1048 用例）
/ build / check:privacy（网络通道调用 0、权限清单与 PRIVACY.md 一致）
```

| 编号 | 缺陷 | 实际落地 | 偏离说明 |
|------|------|----------|----------|
| **R4** | S-1 | `background.ts` 在 `onInstalled` + `onStartup` 双处注册 `setUninstallURL('uninstall.html')`；新增 `public/uninstall.html`（样式全内联、零外链、**无查询参数回传**）；设置页数据分区顶部常驻导出提示 | 按计划完成 |
| **R6** | IA-2 | `syncMirrorEnabled` 改为 `settingSections.tsx` 的 `kind:'custom'` 行，进入搜索索引；删除 `SettingsPage` 中重复渲染 | 按计划完成 |
| **R11** | B-3 | `EmptyTabs` 加 `hasSnapshots`，存在快照时追加恢复引导 | 按计划完成 |
| **R9** | B-1 | 新增 `popup/PopupListStates.tsx`（骨架屏 + 错误态含重试），popup 改为三态 | 按计划完成 |
| **R10** | B-2 | `useOtherWindows` 暴露 `status: loading\|ready\|error`，分段渲染对应状态与重试 | 按计划完成 |
| **R16** | 前置 | 选定**方案 B**：复用 `recordClosedBatch` + 新增 `kind='restore'`。理由：撤销栈既有语义（撤销 = 重新打开已关闭的标签）恰好能把恢复出来的标签再开回来，无需新建反向机制；`kind` 在 schema 中是 `z.string()`，无需改 schema | — |
| **R8** | IX-3 | `snapshotStore.restore` 做**前后 tabId 差分**，把本次新建的标签以 `kind='restore'` 入撤销栈；`UndoHistoryPanel.kindLabel` 支持新 kind；`RestoreConfirmDialog` 顶部注释同步 | 按计划完成 |
| **R7** | IA-3 | 统一到 `rankForKeep`（最近访问 > 激活 > 固定 > 位置靠前 > id 大）；`KeeperPolicy.select` 委托之，删除原「勿混用」警示；文案同步；新增 14 例 parity 测试 | **行为变更**，需 CHANGELOG |
| **R12** | IX-4 | 新增 `ui/common/ContextMenu.tsx`（Portal + `role=menu` + Esc + 打开聚焦首项 + 点击外部关闭 + 贴边收拢）；`TabRow` 加 `onContextMenu`，含复制网址 / 加入稍后读 / 固定 / 休眠 / 复制标签 / 关闭 | 按计划完成 |
| **R13** | A-1 | `Dialog.tsx` 新增 `applyBackgroundInert`：模态栈首个入栈时惰性化背景，栈清空时解除；不支持 `inert` 的内核退化 `aria-hidden`；嵌套弹窗不会误解除 | 按计划完成 |
| **R14** | A-2 | **判定为不改**（见下方「两项有意未做」） | ⚠️ 偏离 |
| **R15** | P-1 | 只做低风险部分：`.fixed-area` 加底部滚动边界阴影（`background-attachment: local`），滚到底时切 `.is-scrolled-to-end` 撤掉；`ResizeObserver` 在 jsdom 下缺失已守卫 | ⚠️ 部分 |
| **R16** | F-1 | `FooterToolbar` 在重复徽章旁**独立成按钮**出现洞察入口（`insightCount > 0` 时，badge 显示条数），点击直达 `SnapshotsPanel` 的 report 页签并 `scrollIntoView` 到洞察锚点；`insightCount` 由 `computeInsights` 计算，与面板内条目同口径。选型说明：选「独立入口」而非「在清理重复徽章上叠加查看详情」—— 后者点击已是执行动作，叠加会让一个按钮有两种语义 | 按计划完成 |
| **R17** | S-2 | `redactUrls` 从单条 `http(s)://` 扩为四条（协议头 URL / 裸域名+路径 / 无点分级 `host:port` / `user:pass@` 凭据），并先占位保护「文件名:行号」再脱敏；新增 11 例（7 脱敏 + 4 误伤防护） | 按计划完成 |
| **R18** | S-3 | 新增 `trimReadLaterWithEvicted` / `trimSnapshotsWithEvicted` / `pushBatchWithEvicted` 三个纯函数（core 层不做 UI 反馈，交调用方）。**三类淘汰全部闭环**：稍后读 / 快照 / 撤销栈各有「淘汰 → 监听 → `notifyEviction`」通路。另新增 `notifyEviction(key, message)`：模块级 `notifiedEvictions` Set 按 key **会话内只提示一次** —— 三类淘汰的共同形态是「每操作一次再淘汰一条」（批量关 50 个标签 / 连续暂存 / 逐份导入 Workona），逐次 `set` toast 会互相顶掉导致用户一条都看不到。用模块级 Set 而非 store 字段：它是「提示过没有」的记录，不是可序列化 UI 状态，放进 store 会被快照测试与 setState 复位连带清掉。新增 17 例（9 eviction-reporting + 4 snapshot-eviction-notify + 4 eviction-notify） | 按计划完成，另**修复一个自比较 bug** |

#### R18 三类淘汰的定性区分（不可混为一谈）

| 类别 | 上限是否已披露 | 严重度 | 本次补的是 |
|------|----------------|--------|------------|
| ① 稍后读 | **完全未披露**（`READLATER_LIMIT` 无任何运行时告知） | 高 | 披露 + 淘汰瞬间告知 |
| ② 快照 | **完全未披露**（`maxAutoSnapshots` / `snapshotLimit` 无运行时告知） | 高 | 披露 + 淘汰瞬间告知 |
| ③ 撤销栈 | **已披露且用户可调**（`models.ts` 的 `undoStackLimit`，5–50，设置页有入口，`PRIVACY.md` 已披露） | 低 | **仅「那一刻的告知」**，不是披露 |

| **R19** | P-2 | 新增 `tests/perf/language-mode-perf.test.ts`（6 用例，预热 + 中位数 + 分档阈值）。**结论：无性能问题，无需优化**：500 标签下单次派生 0.048ms、首帧全 unknown 0.065ms、批量写回 0.016ms、planAutoGroups 0.093ms、planRegroup 0.103ms —— 全部亚毫秒级，比阈值低 3–4 个数量级。且 `App.tsx` 已用「批量探测 Promise.all + 一次 setLanguages」而非逐条 set，当初担忧的 N 轮派生问题在代码里已解决。**不建议升入 P1/P2**。度量边界：`detectLanguage` 的真实 IPC 往返无法在 wxt fake-browser 替身下测出，已在测试注释标注，未臆造数字 | 按计划完成（只测量） |
| **R2 遗留** | — | `docs/` 判定为**准对外发布物**（git 已跟踪，`README.md:177-188` 文档表逐条链接这 4 个文件），按最小改动处理：product-design.md:404/:560 同步范围补上「常驻磁贴」（附 `MirrorPayloadSchema` 证据）；4 个文档各加一处口径提示。本轮不在 `docs/` 追加新文档；`deliverables/` 为对外交付物 | 完成（最小改动） |

#### 附：docs/ 数值核正记录（以实测为准）

| 声明 | 实测 | 处置 |
|------|------|------|
| 「App.tsx 约 3600 行」 | **docs/ 中不存在该表述**（全仓 grep 无命中，唯一 3600 是 `7*24*3600*1000` 周报常量）。实测 App.tsx **1442 行** | 该说法来自口头/其他渠道，非文档 |
| P0 缺陷 3 项 | **应为 4 项**：IX-1 / IX-2 / IX-3 + **DS-13**（§3.7 标 P0 且 TL;DR 称「本次最该先改的一条」，但汇总行漏计） | 已在 docs 汇总行更正。**注：DS-13 是 `docs/` 旧报告的缺陷编号，本 `deliverables/` 三份文档用的是 IA/IX/B/C/A/P/S/F 编号体系，两者不通用** |
| P1 9 / P2 4 | 按缺陷表 ID 去重为 **P1 13 / P2 22** | 统计口径不同源（汇总行按 §4 建议条目，核正按 §3 缺陷表 ID），**未强行改数**，仅记录差异 |
| src 102 `.ts` + 59 `.tsx` = 24909 行 | 实测 **102 `.ts` + 61 `.tsx`** | 标注以实测为准 |
| 测试文件 99 | 实测 **104** | 标注以实测为准 |

### 两项有意未做（需你确认是否立项）

**R14（行主按钮拆分角色）—— 判定为不改。**
核查发现 `RowItem` **已有** `activatorRef` / `buttonAttributes` / `buttonListeners` 机制把拖拽激活器挂在主按钮上，dnd-kit `KeyboardSensor` 的专用手柄也已存在（`drag-grip` 是视觉提示，Space + 方向键走键盘）。原缺陷描述「三种角色混在一起」在**当前实现里已部分缓解**。强行拆分为独立 DOM 手柄会改变 `PointerSensor` 的 4px 命中语义与既有 UI 快照，风险高于收益。**建议作为独立重构项立项并同步全部快照。**

**R15 的虚拟化部分 —— 判定为不改。**
dnd-kit `SortableContext` 要求全部 item 挂载，与行级虚拟化存在**根本冲突**；改为「分区级虚拟化」属结构性重构，会波及 `sectionCards` / `TabRow` / 拖拽落点计算与全部相关快照。**建议独立立项。** 本次只完成其中低风险的滚动边界部分。

### 过程中修掉的额外缺陷（非计划内）

1. **`trimSnapshotsWithEvicted` 自比较 bug**：排序写成 `b.createdAt - b.createdAt`（自己减自己），排序完全失效 —— 会导致保留的快照顺序错误。已修正为 `y.createdAt - x.createdAt`。
2. **`ResizeObserver` 在 jsdom 下不存在**：直接 `new` 会让 28 个 FixedArea 测试全崩。已加类型守卫，缺失时退化为「滚动时才更新」。
3. **快照需要更新**：R11 的空态包裹层、R15 的 `is-scrolled-to-end` 类都会改变渲染树，三个快照已更新（属预期变更，非掩盖失败）。

---

## 1. 待办计划总览

| 优先级 | 编号 | 举措 | 对应缺陷 | 成本 | 状态 | 任务 ID |
|--------|------|------|----------|------|------|---------|
| **P0** | R4 | 卸载挽留 + 导出引导前置 | S-1 | 1 | ✅ | `task-1` |
| **P1** | R5 | 撤销历史可达性补全（分区折叠/入口） | IA-1 | 1.5 | ⬜ 未立项 | — （R3 已提供常驻入口，本项待观察后再定） |
| **P1** | R6 | 设置项搜索覆盖手写开关 | IA-2 | 0.5 | ✅ | `task-2` |
| **P1** | R7 | 统一重复 keeper 策略口径 | IA-3 | 2 | ✅ | `task-7` |
| **P1** | R8 | 快照恢复纳入撤销栈 | IX-3 | 3 | ✅ | `task-6`（方案 B，评审见 `task-16`） |
| **P1** | R9 | popup 补加载态 / 错误态 | B-1 | 1 | ✅ | `task-4` |
| **P1** | R10 | 其他窗口段补加载态 / 失败态 | B-2 | 1 | ✅ | `task-5` |
| **P1** | R11 | 空态补快照恢复引导 | B-3 | 0.5 | ✅ | `task-3` |
| **P2** | R12 | 标签行右键上下文菜单 | IX-4 | 2 | ✅ | `task-8` |
| **P2** | R13 | 模态背景 inert | A-1 | 0.5 | ✅ | `task-9` |
| **P2** | R14 | 行主按钮拆分角色 | A-2 | 1.5 | ⚠️ 见下 | `task-10` |
| **P2** | R15 | 虚拟化阈值与嵌套滚动 | P-1 | 2 | ⚠️ 部分 | `task-11` |
| **P2** | R16 | 洞察入口前置 | F-1 | 1 | ✅ | `task-12` |
| **P2** | R17 | 诊断脱敏正则加固 | S-2 | 0.5 | ✅ | `task-13` |
| **P2** | R18 | 静默淘汰补提示 | S-3 | 2 | ✅ | `task-14` |
| **P3** | R19 | 语言模式 N 异步探测优化（**推断**） | P-2 | 1 | ✅ 已测量：**无需优化** | `task-15` |

**合计剩余**：约 21 人日（P0 1 + P1 9.5 + P2 9 + P3 1）

**附加任务（不在 R 序列内）**：
| 编号 | 举措 | 成本 | 任务 ID |
|------|------|------|---------|
| — | 【前置评审】R8 快照恢复可逆性：方案 A / B 决策（阻塞 R8） | 0.5 日 | ✅ `task-16` |
| — | R2 遗留：复核 `docs/` 下的同步口径旧文案 | 0.5 日 | ✅ `task-18` |

> 本计划已同步登记为可跟踪任务（共 18 条，含 1 条已完成的归档记录 `task-17`）。
> 任务板是执行入口；本文件是完整依据（证据、步骤、验收标准）。

---

## 2. P0 · 高价值低成本（建议立即做）

### R4 · 卸载挽留 + 导出引导前置

**缺陷**：S-1 —— 卸载扩展 = 固定空间、快照、撤销栈全部随 `chrome.storage.local` 一起消失；无 `setUninstallURL`，用户卸载前得不到任何提示。

**证据**：`grep -rn 'setUninstallURL' src` 零命中；`OnboardingTour.tsx:91-100` 的导出提醒只在引导最后一屏、且 `onboarded` 后不再出现。

**落地步骤**：
1. 在 `background.ts` 注册 `chrome.runtime.setUninstallURL(url)`，指向一个**静态**提示页。
   - 建议放 `public/uninstall.html`（构建产物内，不依赖任何运行时服务）。
   - 页面内容：说明卸载将删除全部本地数据 + 引导「先导出备份」+ 导出入口指向设置页。
   - **约束**：该 URL 必须与「零自有服务器」承诺一致——只能是静态页或商店/仓库锚点，不得带任何查询参数回传（否则构成事实上的遥测）。
2. 设置页「数据」分区顶部常驻「建议定期导出」提示，**不依赖 `onboarded` 标记**。
3. `ClearDataDialog` 内已有导出入口，核对其在设置页的可达性。

**验收标准**：
- 卸载时浏览器打开提示页（Chrome/Edge 均生效）；
- `scripts/privacy-check.mjs` 仍报「网络通道调用 0」——重点检查提示页不含任何外链资源与跟踪参数；
- 新装用户完成引导后，设置页仍可见导出提醒。

**成本**：1 人日
**风险**：提示页若引入外链字体/CDN 会击穿隐私门禁——必须内联样式。

---

## 3. P1 · 中等价值（建议下个迭代）

### R5 · 撤销历史可达性补全（IA-1）

**缺陷**：首屏信息过载；撤销历史藏在底栏护盾图标后，用户看不到「我有多少可反悔的」。

**证据**：`App.tsx:1139` `<FixedArea />` 无条件渲染；`FooterToolbar.tsx` 撤销入口仅为一个徽章数字。

**落地步骤**：
1. 底栏撤销按钮**长按或右键**弹出最近 3 条批次（复用 `UndoHistoryPanel` 的列表渲染片段）；
2. 撤销栈非空时，底栏护盾图标加**可感知的状态**（如徽章配色变化），与「空栈」区分；
3. **推断**：多数用户只在误关后第一次寻找入口——考虑在首次成功关闭批次后，toast 的「撤销」按钮旁增加一次性「查看历史」入口（可随 `tipSeen` 类标记关闭）。

**验收标准**：新用户误关标签后，无需引导即可在 2 次点击内找到撤销入口。
**成本**：1.5 人日

### R6 · 设置项搜索覆盖手写开关（IA-2）

**缺陷**：`syncMirrorEnabled` 是在 `SettingsPage.tsx:367-368` **手写**的 `Toggle`，不在 `buildSections()` 返回的规格数组内，因此设置页搜索**搜不到它**。

**证据**：`SettingsPage.tsx:222-227` 的搜索过滤只匹配 `spec.labelKey` / `spec.hintKey`；`settingSections.tsx:175` 的 `buildSections` 共 35 个 `key:` 行 + 7 个 `kind:'custom'` 行，`syncMirrorEnabled` 两者都不是。

**落地步骤**：把该开关改造成 `buildSections` 内的 `kind:'custom'` 行（参照 `settings.language` :287-302 的写法），使其进入搜索索引。

**验收标准**：设置页搜索「同步」能命中该开关。
**成本**：0.5 人日

### R7 · 统一重复 keeper 策略口径（IA-3）

**缺陷**：两套「保留哪个」的策略口径不同，且无 UI 文案解释。

**证据**：
- `core/dup/DuplicateIndex.ts` 的 `KeeperPolicy.select`：激活 > 固定 > 位置靠前
- `core/dup/DedupeByUrl.ts` 的 `rankForKeep`：lastAccessed > 激活 > 固定 > 位置靠前 > id
- `DuplicateIndex.ts:66-68` 有「勿混用」警示注释，但**这是给开发者看的，用户看不到**

**落地步骤**：
1. 先做**决策**而非直接改代码：确认「同网址唯一化」（`uniqueUrlTabs`）与「一键清理重复」是否应当口径一致。**推断**：两者用户预期相同（"留最近用过的那个"），倾向统一到 `rankForKeep`。
2. 统一后，在清理确认弹窗文案中**显式说明保留规则**（R1 已加的 `duplicates.cleanConfirm` 正好是承载位）。
3. 补一个跨两份策略的行为测试，锁死「同一输入两种策略给出同一 keeper」。

**验收标准**：`planDuplicateCleanup` 与 `DedupeByUrl` 对同一组标签给出相同保留项；文案说明与实际行为一致。
**成本**：2 人日（含决策与测试）
**风险**：改 keeper 策略会改变既有用户的清理结果——属行为变更，需在 CHANGELOG 说明。

### R8 · 快照恢复纳入撤销栈（IX-3）

**缺陷**：`RestoreConfirmDialog.tsx:8-11` 注释明确「恢复不在撤销栈覆盖范围内」，因此恢复前必须确认；但恢复**新建**的标签无法反悔——只能手动一个个关。

**落地步骤**：
1. 方案 A（推荐）：恢复时记录「本次新建了哪些 tabId」，提供**单条「撤销本次恢复」**入口（关闭这批新建标签），而非进常规撤销栈——因为常规撤销栈语义是「恢复已关闭的标签」，方向相反。
2. 方案 B：直接复用 `recordClosedBatch`，把新建的标签记为一批可关闭项。
3. 无论哪种，恢复成功 toast 上应给出该入口。

**验收标准**：恢复快照后可一键撤销该次恢复，且不污染「关闭→撤销」的既有语义。
**成本**：3 人日
**风险**：方案 A/B 的语义差异会影响 `undoStore` 的 `kind` 体系（现有 `kindClose` / `kindArchive`），需同步 `UndoHistoryPanel` 的 `kindLabel`。

### R9 · popup 补加载态 / 错误态（B-1）

**缺陷**：popup 形态只有 `EmptyState`，**加载中与「真的没有标签」渲染成同一屏**。

**证据**：`popup/App.tsx:38-40` 初始化失败仅 `logDegraded` 无 UI；`:215-218` 单个 `EmptyState` 用 `query ? search.noResults : search.typeHint` 二元切换。

**落地步骤**：引入与侧边栏同构的三态（`LoadingSkeleton` / `LoadErrorState` / `EmptyState`），复用 `sidepanel/ListStates.tsx` 的组件。

**验收标准**：popup 打开时先见骨架屏；`chrome.tabs.query` 失败时显示错误态 + 重试。
**成本**：1 人日

### R10 · 其他窗口段补加载态 / 失败态（B-2）

**缺陷**：`OtherWindowsSection` 在查询在途或持续失败时**永久空白**，用户无法区分「没有其他窗口」与「加载失败」。

**证据**：`useOtherWindows.ts` 持有独立 hook（不进 tabStore，见 `useOtherWindows.ts:6-13` 注释）；`App.tsx:1195-1201` 仅以 `showOtherWindows && !isFiltering` 条件渲染。

**落地步骤**：hook 暴露 `status: 'loading' | 'ready' | 'error'`，分段内渲染对应状态；错误态给重试按钮。

**验收标准**：禁用 `tabs` 权限模拟失败时，该区域显示错误提示而非空白。
**成本**：1 人日

### R11 · 空态补快照恢复引导（B-3）

**缺陷**：`EmptyTabs` 只给「新建标签」一个动作；用户若因崩溃/误关导致空窗口，看不到「从快照恢复」这条更相关的路。

**证据**：`sidepanel/ListStates.tsx` 的 `EmptyTabs`；`snapshots.crashGuidance` 文案**只**在 `UndoHistoryPanel.tsx:105-114` 中使用。

**落地步骤**：`EmptyTabs` 在「存在快照」时追加「从快照恢复」按钮（与 `UndoHistoryPanel` 同款引导块）。

**验收标准**：有快照且窗口为空时，空态出现恢复入口。
**成本**：0.5 人日

---

## 4. P2 · 打磨项

### R12 · 标签行右键上下文菜单（IX-4）

**证据**：`grep -rn 'onContextMenu' src` 零命中（浏览器级右键菜单已由 `contextMenus.ts` 实现，但那是浏览器原生菜单，非面板内）。
**落地**：`TabRow` 加 `onContextMenu`，复用 `Dialog` 的 Portal 模式渲染轻量菜单，含「关闭 / 休眠 / 固定 / 加入稍后读 / 复制网址」。
**验收**：菜单含键盘可达（Esc 关闭 + 焦点恢复），`prefers-reduced-motion` 下无动画。
**成本**：2 人日

### R13 · 模态背景 inert（A-1）

**证据**：`Dialog.tsx:157-179` 的 `DialogShell` 有 `useModalA11y`（焦点陷阱 + 恢复），但遮罩外的背景内容仍可被读屏/键盘访问。
**落地**：打开时给背景根节点加 `inert` 属性（现代浏览器支持），或以 `aria-hidden` + 焦点陷阱兜底。
**验收**：模态打开时 Tab 循环不离开对话框；读屏不朗读背景内容。
**成本**：0.5 人日

### R14 · 行主按钮拆分角色（A-2）

**证据**：`TabRow.tsx` 行主按钮同时承担「激活标签」「拖拽」「键盘漫游」三种角色，`aria` 语义与拖拽手柄职责混在一起。
**落地**：把拖拽手柄显式化为独立可聚焦元素（`DndRoot` 的 `KeyboardSensor` 已要求专用手柄），主按钮只保留「激活」。
**验收**：读屏朗读行内元素时语义清晰；键盘拖拽与键盘激活互不干扰。
**成本**：1.5 人日

### R15 · 虚拟化阈值与嵌套滚动（P-1）

**证据**：`sectionCards.tsx:22-25` `VIRTUAL_THRESHOLD=60` / `FORCE_VIRTUAL_THRESHOLD=120`（已从 200 下调）；`TabRow.tsx:106-110` 虚拟化时 `canReorder=false`；`main.css:1133-1135` `.fixed-area { max-height: min(34vh, 280px) }` 形成嵌套滚动。
**落地**：
1. 评估 dnd-kit `SortableContext` 需要全部 item 挂载与虚拟化的根本冲突——考虑「分区级虚拟化」而非「行级」；
2. 固定空间嵌套滚动区加明确的滚动边界提示（避免用户以为到底了）。
**验收**：500 标签窗口下拖拽仍可用且不掉帧；固定空间滚动到底有视觉边界。
**成本**：2 人日

### R16 · 洞察入口前置（F-1）

**证据**：`tabInsights.ts:1-26` 三类洞察（重复重灾区 / 休眠候选 / 滞留预警）纯本地计算，但渲染在 `SnapshotsPanel.tsx:341,449-509` 的「周报」页签——用户需先打开快照面板再切页签才能看到。
**落地**：在重复徽章/休眠按钮上给出「查看详情」直达洞察，或把洞察提升为独立入口。
**验收**：从底栏任一相关徽章可 1 次点击到达对应洞察。
**成本**：1 人日

### R17 · 诊断脱敏正则加固（S-2）

**证据**：`diagnostics.ts:60-73` `redactUrls` 用于脱敏，但正则边界需复核（如无协议头的 `example.com/path`、含端口/用户信息的形式）。
**落地**：补针对「裸域名 + 路径」形式的用例，加固正则；确保日志不落标签标题与完整 URL。
**验收**：新增用例覆盖裸域名、带端口、带 `user:pass@` 三种形式，全部脱敏。
**成本**：0.5 人日

### R18 · 静默淘汰补提示（S-3）

**证据**：稍后读超限淘汰最旧（`core/readlater/trim.ts`）、快照超限淘汰（`platform/snapshot/snapshots.ts:72-80`，`trimSnapshots` 是纯函数**无 notify 通道**）、撤销栈超限 `.shift()` 丢弃（`core/undo/UndoStack.ts:44,52,64-66`）。
**定性说明**：撤销栈那条**不是隐藏行为**——栈深上限已披露且用户可调（`models.ts:137` 范围 5–50，`settingSections.tsx` 有 UI），性质是「有界栈 + 淘汰瞬间无提示」，严重度低于前两条。
**落地**：为纯函数 `trim*` 增加「返回被淘汰项」并由调用方 notify；撤销栈淘汰时给一次性提示。
**验收**：三类淘汰发生时用户均收到提示，且提示不刷屏（同会话内合并）。
**成本**：2 人日

---

## 5. P3 · 观察项

### R19 · 语言模式 N 异步探测优化（P-2，**推断**）

**证据**：`groupMode: 'language'` 需要逐标签探测语言，存在 N 次异步探测。
**说明**：**推断**为性能风险点，尚未实测量化。
**落地**：先补一个 100/500 标签的 `language` 模式基准测试（参照 `tests/perf/search-perf.test.ts:82-109` 的写法），**确认是否真有问题再优化**。
**验收**：拿到实测数据后再决定是否进入 P1/P2。
**成本**：1 人日（仅测量）

---

## 6. 落地顺序建议

```
【已完成】R2 文案口径 → R3 重做入口 → R1 确认闸门
         （均为低风险，已过全量门禁）

【第一批】R4 卸载挽留        1 日   ← 数据丢失风险，最高优先级
         R6 设置搜索        0.5 日 ← 与 R2 同批，改同一区域
         R11 空态引导       0.5 日 ← 与 R1 同为「边界场景补全」
         小计 2 日

【第二批】R9 popup 状态     1 日
         R10 其他窗口状态   1 日
         R8 恢复可撤销      3 日   ← 语义变更，需单独评审
         小计 5 日

【第三批】R7 keeper 统一    2 日   ← 行为变更，需 CHANGELOG
         R5 撤销可达性      1.5 日
         小计 3.5 日

【打磨批】R12–R18          9 日   ← 可按人力拆分子项并行

【观察】  R19               1 日   ← 先测量再决策
```

**建议**：第一批与第二批的「状态补全」类（R9/R10/R11）可打包为一个「边界场景」迭代；R7/R8 属**行为/语义变更**，建议独立评审并附 CHANGELOG 说明。

---

## 7. 每次改动必跑的门禁

```bash
pnpm check          # typecheck → lint → check:i18n → check:ui → test → build → check:privacy
```

CI 额外跑 `format:check` 与 `pnpm audit --audit-level=high`（`.github/workflows/ci.yml`）。

**本轮验证过的经验（供后续改动参考）**：
1. **新增 i18n 键必须中英双写**，否则 `check:i18n` 会报「en 多余键 / zh 死键」——本轮 R1 就因 zh 漏写被拦下一次。
2. **新增必填回调参数会被类型检查捕获**——`useGlobalHotkeys` 加 `redoLast` 后，`tests/entrypoints/use-global-hotkeys.test.tsx` 的 fixture 立即报错。这是好事：说明类型约束有效。
3. **确认弹窗必须挂在 JSX 末尾**，否则从其他面板触发时会叠在其下方不可见。
4. **键盘快捷键的文本编辑闸门要覆盖所有分支**，不能只保护其中一个（本轮 `⌘⇧Z` 踩过）。

---

## 8. 不做的事（明确排除）

以下属于**有意的设计取舍**，不应作为「缺陷」修复：

| 项 | 理由 |
|----|------|
| 引入任何埋点/遥测 | 产品宪法（`README.md:7`、`PRIVACY.md:9-16`）；代价是无法量化使用数据，故本文档不含任何使用量指标 |
| 放宽权限或新增与隐私承诺冲突的能力 | `CONTRIBUTING.md:92` 明确「不会接受」 |
| 为绕过门禁修改 ESLint / Prettier / 覆盖率配置 | `CONTRIBUTING.md:93` 明确「不会接受」；覆盖率阈值是棘轮，只许收紧 |
| 把「数据永不离开设备」写进文案 | 与开启同步时的事实不符，`PRIVACY.md:15` 已给出准确表述 |
| 撤销栈覆盖「恢复」以外的动作 | DD-1 决策：恢复是新建，语义不同，边界靠确认闸门补偿 |

---

## 附录 · 缺陷编号索引

| 编号 | 一句话 | 状态 |
|------|--------|------|
| IA-1 | 首屏信息过载，撤销入口过深 | ⬜ R5 |
| IA-2 | 同步开关不在设置搜索索引内 | ⬜ R6 |
| IA-3 | 两套重复 keeper 策略口径不同 | ⬜ R7 |
| IX-1 | 批量破坏性动作无确认/预览 | ✅ R1 |
| IX-2 | 重做无常驻入口 | ✅ R3 |
| IX-3 | 快照恢复不可撤销 | ⬜ R8 |
| IX-4 | 标签行无右键菜单 | ⬜ R12 |
| B-1 | popup 无加载/错误态 | ⬜ R9 |
| B-2 | 其他窗口段无加载/错误态 | ⬜ R10 |
| B-3 | 空态缺快照恢复引导 | ⬜ R11 |
| C-1 | 同步范围文案漏磁贴（13 处） | ✅ R2 |
| C-2 | SyncMirror 文件头注释陈旧 | ✅ R2 |
| C-3 | 重做 i18n 键不可达 | ✅ R3 |
| A-1 | 模态背景未 inert | ⬜ R13 |
| A-2 | 行主按钮三重角色 | ⬜ R14 |
| P-1 | 虚拟化与拖拽冲突、嵌套滚动 | ⬜ R15 |
| P-2 | 语言模式 N 次异步探测（**推断**） | ⬜ R19 |
| S-1 | 卸载即全量数据丢失 | ⬜ R4 |
| S-2 | 诊断脱敏正则边界 | ⬜ R17 |
| S-3 | 静默淘汰无提示 | ⬜ R18 |
| F-1 | 洞察埋在快照周报页签 | ⬜ R16 |
| F-2 | HostRules 使用情况（经核实**非缺陷**） | — 无需处理 |
