---
name: wxt-dev-workflow
description: WXT 扩展开发工作流。当用户要启动开发调试、构建生产包、制作上架 ZIP/离线 CRX 或切换 Edge 开发目标时使用。涵盖 dev/HMR 加载、生产构建、产物目录与常见问题。
allowed-tools: Read, Grep, Glob, Bash
disable: false
---

# WXT 扩展开发工作流

## 何时使用

启动开发服务器、构建、打包、排查「改动没生效」类问题时按本流程操作。

## 操作步骤

### 1. 开发调试

```bash
pnpm dev          # Chrome 目标，HMR
pnpm dev:edge     # Edge 目标
```

- 产物在 `.output/chrome-mv3/`，首次需手动加载：`chrome://extensions` → 开发者模式 → 加载已解压 → 选该目录。
- 侧边栏是主界面。改动 UI 后 HMR 通常会更新；修改 `wxt.config.ts` 或 manifest 权限后，按需重启开发服务器并重新加载扩展。

### 2. 构建与打包

```bash
pnpm build          # Chrome / Edge / Brave 生产构建
pnpm zip            # 上架用 ZIP
pnpm crx            # 离线分发 CRX3（签名密钥默认存放在用户配置目录；上架仍用 ZIP）
```

### 3. 常见问题

| 现象                | 原因与处理                                                       |
| ------------------- | ---------------------------------------------------------------- |
| 改动未生效          | 确认运行的是 `pnpm dev`，且扩展加载了 `.output/chrome-mv3/`      |
| 权限报错            | 检查 `wxt.config.ts` 权限定义，并重新构建、加载扩展              |
| 类型找不到 `chrome` | 运行 `pnpm postinstall`（即 `wxt prepare`）重新生成 `.wxt/` 类型 |

## 输入 / 输出

- 输入：用户意图（调试 / 构建 / 打包 / 排错）+ 可选目标浏览器。
- 输出：对应命令序列 + 产物路径 + 验证步骤；涉及权限变更时同步提醒 `PRIVACY.md` 双改义务（见 privacy-security 规则）。

## 边界

发布上架动作（传商店、改商店文案）不属本技能；`pnpm check:privacy` 失败时转 quality-gates 技能。
