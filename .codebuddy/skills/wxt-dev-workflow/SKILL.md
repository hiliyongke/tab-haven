---
name: wxt-dev-workflow
description: WXT 扩展开发工作流。当用户要启动开发调试、构建生产包、制作上架 ZIP/离线 CRX、切换 Edge 目标或兼容变体时使用。涵盖 dev/HMR 加载、build 变体差异、产物目录与常见坑。
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
- 侧边栏是主形态；popup 是兼容降级形态。改 UI 后 HMR 自动生效，**不要重启浏览器或让用户手动重载扩展**，除非改了 `wxt.config.ts` / manifest / 权限。

### 2. 构建与打包

```bash
pnpm build          # 标准版（Chrome/Edge/Brave，侧边栏）
pnpm build:compat   # 兼容版（TABS_VARIANT=compat，旧内核 Chromium 降级为弹窗）
pnpm zip            # 上架用 ZIP
pnpm crx            # 离线分发 CRX3（复用 .output/tabs.pem 签名；上架仍用 zip）
```

### 3. 常见坑速查

| 现象 | 原因与处理 |
| --- | --- |
| 改动不生效 | 确认跑的是 `pnpm dev`；改的是 entrypoints 入口结构时需重启 dev |
| 权限报错 | `wxt.config.ts` 权限变更后必须重启 dev 并重新加载扩展 |
| 类型找不到 `chrome` | 跑 `pnpm postinstall`（即 `wxt prepare`）重新生成 `.wxt/` 类型 |
| 兼容变体行为差异 | 该变体用 popup 替代 sidepanel，查 `platform/capabilities.ts` 的形态检测 |

## 输入 / 输出

- 输入：用户意图（调试 / 构建 / 打包 / 排错）+ 可选目标浏览器。
- 输出：对应命令序列 + 产物路径 + 验证步骤；涉及权限变更时同步提醒 `PRIVACY.md` 双改义务（见 privacy-security 规则）。

## 边界

发布上架动作（传商店、改商店文案）不属本技能；`pnpm check:privacy` 失败时转 quality-gates 技能。
