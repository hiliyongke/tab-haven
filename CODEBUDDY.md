# Tabs — AI 协作速览

> 本地优先、无账号无云端的标签工作台（Chrome/Edge MV3 侧边栏扩展）。
> 本文件是 AI 的项目入口；完整规范见 `README.md`、`CONTRIBUTING.md`、`PRIVACY.md`，AI 工作流配置见 `.codebuddy/`。

## 技术栈

WXT + React 19 + TypeScript + Tailwind CSS 4 + zustand + zod + Vitest；pnpm 11，Node >= 26。

## 分层架构（方向不可逆）

```
core（纯领域逻辑，零 chrome/DOM/React，不 import platform）
  ↑ platform（唯一触碰 chrome.* 的层）
  ↑ stores / ui / entrypoints（sidepanel / options / about / background）
```

详见 CONTRIBUTING「硬性约定」与 README「架构」；此处只保留方向图以便速查。

- 测试随包走：`apps/extension/tests/` 按层镜像（`core|platform|stores|ui|background|entrypoints|perf|config`）、`packages/i18n-kit/tests/` 是工具包自带测试；根 `tests/config/` 只放跨包守卫（依赖单副本）。风格统一为行为规格（Given/When/Then）。

## 四条硬红线（违反即门禁失败 / 拒绝合并）

1. **零网络**：不引入任何出站请求（埋点、CDN、上报均禁止），`pnpm check:privacy` 把关。
2. **权限冻结**：新增权限必须同时改 `wxt.config.ts` 与 `PRIVACY.md`。
3. **校验唯 schema**：数据校验只写在 `core/schema` 的 zod 层，不能只写在 UI 输入处。
4. **文案只写中文**：源码里写母语原文（`t('编辑标签组')`），跑 `pnpm i18n` 由 `packages/i18n-kit` 自动抽词、编译运行时词条（哈希 key `i18n_xxx`，平铺）；`apps/extension/src/i18n/locales/` 是产物，勿手改。

## 常用命令

| 命令                            | 作用                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm dev`                      | 开发模式（HMR，加载 `.output/chrome-mv3`）                                        |
| `pnpm check`                    | 聚合门禁：typecheck → lint → check:i18n → check:ui → test → build → check:privacy |
| `pnpm test` / `pnpm test:watch` | Vitest 行为规格测试（含覆盖率 ratchet）                                           |
| `pnpm format`                   | Prettier 格式化（pre-commit 钩子自动跑 lint-staged）                              |

提交信息用 Conventional Commits、描述用中文；**AI 默认不执行任何 git 操作**（详见 `.codebuddy/rules/git-commit`）。

## AI 配置地图

- `.codebuddy/rules/` — 编码/架构/隐私/协作规则（4 条 always + 2 条按需）
- `.codebuddy/agents/` — 需求分析、测试、评审、隐私审计 4 个专属 Agent
- `.codebuddy/skills/` — WXT 工作流、行为规格测试、schema 演进、门禁修复、UI 组件复用、高频变更地图 6 项自研技能 + Chrome 官方 `chrome-extensions` 技能
- `.codebuddy/commands/` — `/feature` `/spec` `/fix` `/test` `/review` `/check` `/commit` `/privacy-audit` `/release`
- `.codebuddy/README.md` — 配置总览（结构、格式、协作关系、优先级、扩展指南）
