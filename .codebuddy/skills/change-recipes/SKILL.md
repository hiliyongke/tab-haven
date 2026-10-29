---
name: change-recipes
description: 高频变更任务文件地图。当加设置项、加快捷键、加右键菜单、改存储结构、改 manifest/权限、新加入口页面时使用——给出每类任务的必改文件、联动文件与对应门禁，防止漏改（如加设置项漏 locale 或 PRIVACY.md）。
allowed-tools: Read, Grep, Glob, ListDir, Write, Edit, Bash
disable: false
---

# 高频变更任务文件地图

每类任务按「必改 → 联动 → 门禁」执行，全部项打勾才算完成。

## 1. 新增/修改设置项

- 必改：`apps/extension/src/core/schema/models.ts` —— 在 `SettingsSchema` 中定义字段、默认值与边界。
- 联动：`apps/extension/src/entrypoints/options/settingSections.tsx` —— 在设置项声明中加入控件配置，复用既有设置组件。
- 联动：源码文案使用 `t('中文原文')`；运行 `pnpm i18n` 更新词条与运行时产物，不手改 `apps/extension/src/i18n/locales/`。
- 联动：设置若涉及持久化数据 → `PRIVACY.md` 第 3 节。
- 测试：`apps/extension/tests/core/` 补 schema 接受与拒绝场景。
- 门禁：`pnpm typecheck && pnpm check:i18n && pnpm test`。

## 2. 新增持久化数据类型 / 改备份格式

转 `skills/schema-evolution` 五步流程（schema → EXPORT_FILE_VERSION → PRIVACY.md → 隔离测试 → 门禁），本卡不展开。

## 3. 新加快捷键命令

- 必改：`wxt.config.ts` 的 `manifest.commands` 加条目（suggested_key + `__MSG_*__` 描述键）。
- 联动：`apps/extension/src/entrypoints/background.ts` 的 `commands.onCommand` 分发逻辑。
- 联动：`public/_locales/` 的 manifest 文案（zh-CN 与 en 双写 `__MSG_command*__` 键）。
- 门禁：`pnpm build` 验证 manifest 生成 + `pnpm check:i18n`。

## 4. 新加右键菜单项

- 必改：`apps/extension/src/platform/background/contextMenus.ts` —— 注册菜单项；标题使用 manifest locale 消息键。
- 联动：`apps/extension/src/entrypoints/background.ts` 的 `contextMenus.onClicked` 分发。
- 联动：确认与 `settings.contextMenusEnabled` 开关的联动。
- 联动：更新 `public/_locales/` 中的 manifest 文案。
- 测试：`apps/extension/tests/background/` 补菜单注册与点击行为。

## 5. 改 manifest / 权限

- 必改：`wxt.config.ts`（permissions / optional_host_permissions / manifest 配置）。
- 必改：`PRIVACY.md` 权限表，保持用途与实际行为一致。
- 注意：新增权限须经用户批准，并评估其对隐私边界的影响。
- 门禁：`pnpm build && pnpm check:privacy`。

## 6. 新加入口页面（形态）

- 必改：`apps/extension/src/entrypoints/<name>/`（`index.html` + `main.tsx` 薄壳），由 WXT 发现入口。
- 联动：涉及 action / side_panel 行为时核对 `wxt.config.ts` 的 manifest 配置及 background 的侧边栏行为。
- 复用：共享 `stores` / `ui` / `core`，入口不沉淀业务逻辑。
- 测试：`apps/extension/tests/entrypoints/` 补入口行为测试。

## 通用收尾（所有任务）

1. `pnpm check` 全绿；
2. 汇报必改/联动清单的实际落实情况（逐项 `file:line`）；
3. 操作性结论（预览方式等）写进 `README.md`。

## 输入 / 输出

- 输入：任务类型 + 需求描述。
- 输出：按地图逐项落实的改动 + 门禁结果 + 落实清单汇报。
