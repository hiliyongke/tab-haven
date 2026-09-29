---
name: ui-component
description: UI 组件开发指南。当新增或修改 React 组件、设置页控件、弹窗、列表时使用——提供现成组件复用清单（防重复造轮子）、新组件落位规范、设计令牌与 a11y 要求、设置页声明式 SettingSpec 模式。
allowed-tools: Read, Grep, Glob, ListDir, Write, Edit
disable: false
---

# UI 组件开发指南

## 何时使用

写新组件、改组件结构、加设置项控件、做弹窗/列表时。硬性约束见 `rules/code-style` 与 `rules/architecture`（ui 层不得直连 chrome API），本技能给落位与复用指引。

## 第一步：查复用（禁止跳过）

| 域     | 路径                             | 现成组件                                                                                                                                                                                           |
| ------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 通用   | `src/ui/common/`                 | Button、IconButton、TextField、Select、Toggle、Icon、Favicon、EmptyState、StatusToast、StatusBadges、SectionHead、RowItem、RowActions、ErrorBoundary、CommandPalette、OnboardingTour、SettingsSync |
| 弹窗   | `src/ui/dialog/Dialog.tsx`       | Dialog、ConfirmDialog                                                                                                                                                                              |
| 拖拽   | `src/ui/dnd/DndRoot.tsx`         | DndRoot（dnd-kit 封装）                                                                                                                                                                            |
| 列表   | `src/ui/tabs/VirtualRowList.tsx` | 虚拟滚动长列表                                                                                                                                                                                     |
| 业务域 | `src/ui/tabs                     | fixed                                                                                                                                                                                              | search/` | TabRow、FolderRow、PinnedTile、SearchBar 等 |

行为与需求有出入时优先扩展现成组件（加 props），不新开近似组件。

## 新组件规范

1. **落位**：通用组件放 `ui/common/`；领域组件放对应域目录；文件名 PascalCase。
2. **样式**：只用设计令牌（Tailwind 语义类 / CSS 变量），`check:ui` 拦未受控色板字号；主题三态都要成立。
3. **文案**：全部 `t()`，新增键同时补 `src/i18n/locales/zh-CN/` 与 `src/i18n/locales/en/`。
4. **a11y**：交互元素有 role/aria 标签、键盘可达（焦点顺序与 Esc/Enter 行为），测试按角色查询验证。
5. **状态**：跨组件状态进 zustand store；浏览器数据经 `platform/**`，组件内不出现 `chrome.*`。

## 设置页特殊模式（重要）

设置页**不手写表单**：`src/entrypoints/options/settingSections.tsx` 是声明式驱动——在 `SettingSpec`（约 line 55）/ `BooleanSettingKey`（约 line 26）类型扩展后，往 `buildSections`（约 line 174）加一条 spec 即可，控件渲染由 `SettingRow` 统一完成。新增设置项的完整链路见 `skills/change-recipes`。

## 验证

```bash
pnpm check:ui        # 设计令牌守卫
pnpm test:watch tests/ui/<对应测试>   # 行为测试
```

## 输入 / 输出

- 输入：组件需求或设计描述。
- 输出：复用结论（用了哪个现成组件 / 为何必须新建）+ 组件代码 + 双语 locale 键 + 对应 UI 测试。
