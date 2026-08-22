# TabHaven 架构文档

> 本文档曾被 CHANGELOG 与多处代码注释引用但缺失，2026-08-22 补写。
> 详细产品规格见 `docs/PRD.md`；已知问题与技术债务见 `docs/AUDIT.md`。

## 1. 技术栈与形态

- 浏览器侧边栏扩展（Chrome MV3，`minimum_chrome_version: 114`），WXT 构建
- React 19 + TypeScript + Tailwind CSS 4 + zustand + i18next + zod + fuzzysort
- 入口：`sidepanel`（主界面）、`popup`（快速切换器，降级形态）、`options`（设置页）、`background`（Service Worker）

## 2. 分层职责

```
src/
├── entrypoints/   各入口（sidepanel/popup/options/background）
├── ui/            展示组件（tabs / fixed / search / dialog / common）
├── stores/        zustand 状态（dataStore / tabStore / undoStore / selectionStore）
├── core/          纯领域逻辑（URL 检视、站点聚合、去重、撤销栈、迁移、固定空间模型）
├── platform/      浏览器 API 适配（tabs / storage / theme / sync / reuse / migrate / undo）
└── i18n/          文案（zh-CN / en）
```

依赖方向：`ui → stores → core/platform`；`core` 不触碰 `browser.*`；
`platform` 是唯一允许触碰 `browser.*` 的层；`core` 不依赖 `react`。

## 3. 数据流

- **标签镜像**：`TabSyncService`（platform/sync）在 UI 页面内监听浏览器 tab/tabGroups
  事件，节流（40ms）+ 合并为快照广播；`tabStore` 只做「快照 → 订阅者」镜像中转。
  真相源始终是浏览器。
- **固定空间**：`dataStore` 经 `DataRepository`（chrome.storage.local + zod 校验 +
  坏数据隔离）读写文件夹 / 永久固定图标 / 设置 / 折叠状态；
  共享仓库单例见 `platform/storage/repositories.ts`（storage key 唯一出处）。
- **会话绑定**：`platform/storage/session.ts` 提供串行化的 `mutateSession`
  （read-modify-write 防竞态），存 chrome.storage.session（面板/浏览器重启失效）。
- **消息层**：`platform/messages.ts` 用 zod discriminatedUnion 定义 3 种消息
  （allow-duplicate-once UI→SW；duplicate-reused / focus-search SW→UI）。
- **快照联动**：挂起条目转正 + 绑定维护（`dataStore.reconcileWithTabs`）由
  sidepanel/popup 入口层编排（避免 tabStore ↔ dataStore 循环依赖）。

## 4. 主题与 i18n

- 三态主题（system/light/dark）：`ThemeApplier` 双通道（chrome.storage 权威 +
  localStorage 镜像防闪烁），`theme-init` 渲染前同步。
- 语言：`settings.language`（运行时切换）→ 浏览器 UI 语言 → zh-CN 兜底；
  `SettingsSync` 更新 `<html lang>`。

## 5. 已知约束

- **MV3 Service Worker 回收**：`ReuseCoordinator` 的任务与豁免令牌是内存态，
  SW 空闲回收后丢失；自动休眠用 `chrome.alarms` 保活。
- **自动分组默认只展示**：按网站/来源树/语言的聚合默认是展示层虚拟分组，不修改浏览器；用户开启 `settings.autoGroupNative` 后，按网站或语言的聚合才会同步为原生 `tabGroups`，关闭开关会解散由该功能创建的组；固定文件夹仍通过显式操作桥接。
- **兼容变体**：`TABHAVEN_VARIANT=compat` 剥离 sidePanel（面向 <114 内核），
  在 `build:manifestGenerated` hook 后处理。
