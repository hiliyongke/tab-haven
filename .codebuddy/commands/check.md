---
description: 跑聚合门禁 pnpm check，失败则按门禁逐项定位修复（禁止改门禁配置绕过）
argument-hint: '[可选：只跑某一项，如 typecheck/lint/i18n/ui/test/privacy]'
allowed-tools: Read, Grep, Glob, ListDir, Write, Edit, Bash
---

执行质量门禁并处理失败项。

范围参数（可选）：$ARGUMENTS

- 为空 → 跑完整 `pnpm check`（typecheck → lint → check:i18n → check:ui → test → build → check:privacy）。
- 指定单项 → 跑对应 `pnpm typecheck` / `pnpm lint` / `pnpm check:i18n` / `pnpm check:ui` / `pnpm test` / `pnpm build && pnpm check:privacy`。

失败处理：

1. 加载 `.codebuddy/skills/quality-gates`，按该门禁的标准套路定位根因。
2. 修代码后复跑该项，通过再继续下一项。
3. **铁律**：只允许修代码或报告冲突；禁止改门禁配置、加 lint-disable、放宽覆盖率阈值、给隐私脚本加白名单。
4. 无法修复时：输出根因分析 + 与需求/配置的冲突点，交用户拍板。

收尾汇报：每项门禁的通过/修复记录（修了哪些 `file:line`）。
