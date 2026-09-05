# 贡献指南

感谢你愿意为 Tabs 出力。本文说明如何提交改动，以及哪些约定是硬性的。

## 快速开始

```bash
pnpm install
pnpm dev          # 开发模式，加载 .output/chrome-mv3 到 chrome://extensions
pnpm check        # 提交前跑这一条即可（等价于 CI 全流程）
```

`pnpm check` = 格式 → 类型 → 规范 → 文案键 → 测试（含覆盖率阈值）→ 构建 → 隐私回归。
**任何一项失败，CI 都会拒绝合并。**

提交时 pre-commit 钩子会自动对暂存文件跑 lint-staged（ESLint + Prettier）。
若钩子未生效，先执行一次：

```bash
npx simple-git-hooks
```

## 硬性约定

这些不是风格偏好，而是会被门禁拦下的约束：

### 1. 分层方向不可逆

```
core（纯领域逻辑，零 chrome/DOM/React）
  ↑
platform（唯一触碰 chrome.* 的层）
  ↑
stores / ui / entrypoints
```

- `core/**` 不得出现 `chrome.*`、`browser.*`、DOM、React，**也不得 import `platform/**`**；
- `ui/**` 不得绕过 `platform/**` 直连浏览器 API。

### 2. 校验的唯一口径是 schema 层，不是 UI 层

凡是需要校验的数据（尤其是会被编译成浏览器规则或落盘的），校验必须写在
`core/schema` 的 zod schema 里，**不能只做在 UI 输入处** —— 备份导入会绕过 UI。

历史上这里出过真实事故：`noCachePatterns` 只在设置页编辑器归一化，
导致一份含 `https://*` 的备份文件就能生成覆盖全部 HTTP(S) 流量的 DNR 规则。

### 3. 权限清单冻结

新增权限必须**同时**改 `wxt.config.ts` 与 `PRIVACY.md`，否则 `check:privacy` 失败。
`<all_urls>` 等主机权限同样在冻结清单内。

### 4. 文案双写

新增 UI 文案必须同时补 `zh-CN` 与 `en` 两份 locale，键集合必须一致，否则 `check:i18n` 失败。

### 5. 持久化数据变更要同步两处

改动持久化数据结构时，必须同步更新：

- `core/schema` 里的 zod schema；
- `CHANGELOG.md`。

若改动的是**导出备份格式**，还须递增 `EXPORT_FILE_VERSION` 并保留旧结构的解析路径 ——
版本号一旦发布就无法回补，这是唯一零成本的时机。

## 测试

- `core/**` 是纯函数层，改动应有对应的行为测试（Given/When/Then 语义）；
- 覆盖率阈值是 **ratchet 基线**：只许收紧，不许放松。若你的改动拉低了覆盖率，请补测试而不是调阈值；
- 涉及 `fake-browser` 的测试请注意它与真实 Chrome 的偏差，详见各测试文件头部注释。

## 提交信息

采用 [Conventional Commits](https://www.conventionalcommits.org/)，描述用中文：

```
feat(sidepanel): 新增按域名聚合的折叠记忆
fix(background): newTabPosition 全局生效
docs: 完善发布文档与 CI 配置
chore: 清理误提交的覆盖率产物
```

## 不会接受的改动

- 引入任何出站网络请求（包括埋点、崩溃上报、CDN 资源）
- 放宽现有权限，或新增与隐私承诺冲突的能力
- 为绕过门禁而修改 ESLint / Prettier / 覆盖率配置
- 在文件中添加 lint-disable 注释
