---
name: change-recipes
description: 高频变更任务文件地图。当加设置项、加快捷键、加右键菜单、改存储结构、改 manifest/权限、新加入口页面时使用——给出每类任务的必改文件、联动文件与对应门禁，防止漏改（如加设置项漏 locale 或 PRIVACY.md）。
allowed-tools: Read, Grep, Glob, ListDir, Write, Edit, Bash
disable: false
---

# 高频变更任务文件地图

每类任务按「必改 → 联动 → 门禁」执行，全部项打勾才算完成。

## 1. 新增/修改设置项

- 必改：`src/core/schema/models.ts` —— `SettingsSchema`（约 line 81）加字段（含默认值与上限），`DEFAULT_SETTINGS`（约 line 229）自动派生，检查是否需手动对齐。
- 联动：`src/entrypoints/options/settingSections.tsx` —— 扩展 `SettingSpec`/`BooleanSettingKey` 类型并在 `buildSections` 加声明式条目（不手写表单）。
- 联动：`src/i18n/locales/zh-CN/` + `src/i18n/locales/en/` 双写文案键。
- 联动：设置若属对外口径的存储数据 → `PRIVACY.md` 第 3 节。
- 测试：`tests/core/` 补 schema 接受/拒绝分支。
- 门禁：`pnpm typecheck && pnpm check:i18n && pnpm test`。

## 2. 新增持久化数据类型 / 改备份格式

转 `skills/schema-evolution` 五步流程（schema → EXPORT_FILE_VERSION → PRIVACY.md → 隔离测试 → 门禁），本卡不展开。

## 3. 新加快捷键命令

- 必改：`wxt.config.ts` 的 `manifest.commands` 加条目（suggested_key + `__MSG_*__` 描述键）。
- 联动：`src/entrypoints/background.ts`（约 line 287）`commands.onCommand` 分发逻辑。
- 联动：`public/_locales/` 的 manifest 文案（zh-CN 与 en 双写 `__MSG_command*__` 键）。
- 门禁：`pnpm build` 验证 manifest 生成 + `pnpm check:i18n`。

## 4. 新加右键菜单项

- 必改：`src/entrypoints/background/contextMenus.ts` —— `rebuildContextMenus` 注册；标题走 i18n 消息键（与 `_locales` 一一对应）。
- 联动：`src/entrypoints/background.ts`（约 line 335）`contextMenus.onClicked` 分发。
- 联动：确认与 `settings.contextMenusEnabled` 开关的联动（关开关时 `clearContextMenus`）。
- 联动：`public/_locales/` 双写。
- 测试：`tests/background/` 补菜单注册/点击行为。

## 5. 改 manifest / 权限

- 必改：`wxt.config.ts`（permissions / optional_host_permissions / manifest hook）。
- 必改：`PRIVACY.md` 权限表（同步口径，否则 `check:privacy` 失败）。
- 注意：兼容变体（`TABS_VARIANT=compat`）在 `build:manifestGenerated` hook 剥离 sidePanel；新权限要评估旧内核兼容性。
- 门禁：`pnpm build && pnpm check:privacy`，并重跑 `pnpm build:compat` 确认变体不炸。

## 6. 新加入口页面（形态）

- 必改：`src/entrypoints/<name>/`（`index.html` + `main.tsx` 薄壳），WXT 自动检测入口。
- 联动：`src/platform/capabilities.ts` 形态能力检测；涉及 action/side_panel 行为时核对 `wxt.config.ts` hook 注释的实测结论（openPanelOnActionClick 与 default_popup 互斥）。
- 复用：共享 `stores` / `ui` / `core`，入口不沉淀逻辑。
- 测试：`tests/entrypoints/` 补入口冒烟。

## 通用收尾（所有任务）

1. `pnpm check` 全绿；
2. 汇报必改/联动清单的实际落实情况（逐项 `file:line`）；
3. 操作性结论（预览方式等）写进 `README.md`。

## 输入 / 输出

- 输入：任务类型 + 需求描述。
- 输出：按地图逐项落实的改动 + 门禁结果 + 落实清单汇报。
