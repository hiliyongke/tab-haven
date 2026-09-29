---
name: quality-gates
description: 质量门禁修复指引。当 pnpm check 任一环节（typecheck/lint/check:i18n/check:ui/test/build/check:privacy）失败时使用——按门禁逐项给出定位套路与标准修法，禁止通过改配置绕过门禁。
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
disable: false
---

# 质量门禁修复指引

## 何时使用

`pnpm check` 或其子项失败时。门禁顺序：typecheck → lint → check:i18n → check:ui → test → build → check:privacy。**按顺序修**，前置失败会让后续噪音放大。

## 各门禁定位与修法

### 1. `pnpm typecheck`（tsc --noEmit）

- 从第一条错误开始修，级联错误常同源。
- 缺 `chrome` 等 WXT 类型 → 先 `pnpm postinstall` 再生 `.wxt/`。
- 禁止用 `as any` / `@ts-ignore` 消错；类型对不上先查是不是该从 `z.infer` 同源导出。

### 2. `pnpm lint`（--max-warnings 0，警告也致命）

- `react-hooks/exhaustive-deps` 警告：补依赖或重构，**禁止 lint-disable**。
- 为绕过门禁改 eslint.config.js 属于拒绝项。

### 3. `pnpm check:i18n`

- 键集合不一致 → 对比 `zh-CN` 与 `en` locale，补齐缺失键或删除死键。
- 新文案没双写是头号原因。

### 4. `pnpm check:ui`（设计令牌守卫）

- 未受控色板/字号 → 换用设计令牌（Tailwind 语义类 / CSS 变量）；对比度不足 → 换令牌组合，不硬调数值。

### 5. `pnpm test`

- 看失败用例的 Given/When/Then 哪段对不上；
- 覆盖率下降 → 补测试（ratchet 不许调阈值）；快照漂移 → 确认渲染变更是有意的才更新快照。

### 6. `pnpm build`

- 多为入口/资源引用问题；先看 WXT 报错指向的 entrypoint。

### 7. `pnpm check:privacy`（需先 build）

- 权限差异 → `wxt.config.ts` 与 `PRIVACY.md` 对齐；
- 网络调用告警 → 定位引入点，删除或替换为本地实现；**不得为了让脚本通过而加白名单**。

## 铁律

门禁失败只允许两种出路：修代码，或报告用户说明为何需求本身冲突。**不允许**改门禁配置、加 disable 注释、放宽阈值。

## 输入 / 输出

- 输入：失败门禁的终端输出（或授权直接跑 `pnpm check`）。
- 输出：根因定位 + 修复 + 复跑通过的记录；无法修复时给出冲突说明。
