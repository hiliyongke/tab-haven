# TabHaven 技术债审计与清理记录

> 2026-08-23 以 legacy-modernizer 流程全量审计（v1.0.0 基线，60 个源文件）。
> 结论：无遗留框架、无过时 API、无安全债；债务集中在巨型组件、memo 失效的性能反模式与架构一致性。

## 审计结论

| 维度 | 状态 |
|------|------|
| 过时 API / 遗留框架 | 无（React 19 / TS 5.9 / Tailwind 4 / WXT 0.21，依赖全部现代） |
| 安全 | 无已知漏洞依赖，无敏感信息硬编码 |
| 事件监听 / 定时器清理 | 全部配对（8/8），无泄漏 |
| 测试覆盖盲区 | stores 编排层与 UI 层（本次已补 stores 行为测试；UI 组件测试仍未覆盖） |

## 已处理（2026-08-23）

### P0 架构一致性
- [x] `background.ts` storage key 硬编码 → 改用 `settingsRepository.keyName`
- [x] `dataStore` / `RestoreEngine` 的复用豁免消息绕过类型契约 → 改用 `AllowDuplicateOnceMessageSchema.parse` 构造
- [x] `dataStore.createTabInFixedFolder` 跨 store 引用 → windowId 参数注入（当前无调用方，接口保留）

### P1 性能与巨型组件
- [x] SectionList memo 失效（callbacks 内联重建）→ handler 全部 getState 化 + `useMemo` 稳定引用
- [x] `DuplicateIndex` 每次渲染构建两次 → 单次 `useMemo` 缓存复用
- [x] `App.tsx` 833 行 → 拆出 `useTabDragHandlers` hook、`FooterToolbar`、`ListStates`（降为约 500 行）
- [x] `SectionCard` 330 行 → 拆为 `PinnedSectionCard` / `UngroupedSectionCard` / `CollapsibleSectionCard` / `PlayingIndicator` / `SectionRows`（强调色推导统一为 `useSectionAccent`）

### P2 代码质量
- [x] `SettingsPage` 324 行手写重复行 → spec 配置化驱动（`SettingRow` 渲染器），UI 不变
- [x] `FolderOps` 三个重复 reorder 函数 → 泛化 `moveElement`
- [x] `syncFolderToNativeGroup` O(n²) 窗口查询 → 一次查询复用
- [x] `writeFolders` / `writePins` 全量写放大 → `createCoalescedWriter` 合并写入（setState 即时 + 落盘合并）
- [x] `SettingsSchema.language` 无约束 → `z.string().min(2).max(32)`
- [x] undo / 自动分组仓库 storage key 收编进 `repositories.ts` 唯一权威出处
- [x] 文档债：补写本文件；修正 `wxt.config.ts` 对架构文档「6.2 节」的失效引用
- [x] stores 编排层行为测试：`tests/stores/undoStore.test.ts`（跳过固定/五元组/部分失败/弹栈恢复）、`tests/stores/dataStore.test.ts`（全局唯一/绑定建立与清理/导入校验/挂起转正）

## 二轮清理（2026-08-23，tech-debt 命令）

死代码清理 + 重复逻辑提取（src 8337 → 8201 行，63 → 62 文件，typecheck/lint 全绿）：

### 死代码删除（生产零引用）
- 平台层 4 条死链：`tabs.ts` 的 `goBack`/`goForward`/`highlightTabs`/`createTabInGroup` + tabStore 对应包装与 import
- store 死 action：`tabStore.refreshTabSnapshot`、`dataStore.createTabInFixedFolder`（未接入功能）、`dataStore.addTabToFolder`（纯代理）
- 死组件：`ui/common/ThemeSync.tsx`（从未挂载，被 SettingsSync 取代）
- 死常量：`tab-types.GROUP_COLORS`（SectionList 有局部同名）、`Icons.list`/`Icons.star`
- `messages.ts` 未使用全量联合 `TabHavenMessageSchema` 与 4 个消息类型

### 类型导出收紧（约 30 处去 export，保留内部使用）
Sections/SiteGrouping/SearchEngine/DuplicateIndex/DedupeByUrl/messages/session/DataRepository/ThemeApplier/TabSyncService/AllowanceLedger/ReusePolicy/ReuseCoordinator/dnd-types/RowItem/PinnedTile/SectionList/accent/dataStore
（注：`readSession` 恢复 export——background/dataStore/测试有引用）

### 重复逻辑提取
`UrlInspector.webComparisonKey(url, pendingUrl)` 统一 8 处「web 页 + comparisonKey」判定（dataStore×4、Reconcile、DuplicateIndex、DedupeByUrl、ReusePolicy、ReuseCoordinator）。

### 保留（仅测试引用，回归网依赖）
`groupColorForLabel`、`KeeperPolicy.default`、`DEFAULT_UNDO_STACK_LIMIT`、`removeItemsWithUrl`、`planUrlDedupe`、`updateSession`。

## 三、UI 组件提取（2026-08-23，P1-P3）

目标：收敛 JSX 内联原子类，业务代码只见语义组件（满足「不写原子化语法」诉求，Tailwind 保留为基础设施）。

### 新增/上移的通用组件（ui/common/）
- `Button`（primary/secondary/danger/danger-ghost/soft + sm/md）——收敛 4 处弹窗按钮对 + SettingsPage 导出导入 + StatusToast 撤销
- `IconButton`（icon/title/box/tone/disabled/isOn/danger/badge）——收敛 FooterToolbar 6 个 + popup/settings 入口等 8+ 处图标按钮
- `TextField`（md/lg 变体，text/number/search）——收敛 Dialog/FolderEditDialog/SettingsPage/popup 搜索输入
- `RowActions`——合并 TabRow/FixedArea 逐字相同的行操作展开容器类名
- `EmptyState`——sidepanel/popup 空态统一
- `Toggle`/`Select`——从 SettingsPage 上移
- `SectionHead`——从 SectionList 下沉，**解除 GroupCard/CategoryModule 与 SectionList 的循环依赖**

### 一致性修复
- SettingsPage 2 处 `window.confirm` → 自制 `ConfirmDialog`（focus trap + Esc），新增 i18n `dialog.confirmTitle`（zh/en）
- StatusToast：撤销按钮 → Button soft；关闭按钮裸 `×` → 统一关闭图标
- popup 结果行补 `cursor-pointer`
- main.css 顶部新增 z-index 分层规范注释表（20/28/30/40）

## 遗留与建议

| 项 | 说明 | 优先级 |
|----|------|--------|
| UI 组件测试 | `SectionCard` 渲染分支、拖拽分派（hook 已提取，可测性已提升）仍无直接测试 | 中 |
| `session.ts` `result!` 非空断言 | 语义脆弱，可改为显式错误路径 | 低 |
| `tabGroups` 类型桥接 | 受控集中，wxt 类型覆盖不足的必要 workaround，保持现状 | 低 |
| 统一诊断日志 | 28 处防御性 catch 无日志，排查依赖浏览器内部日志 | 低 |
