---
description: 发布前串联流程：门禁全绿→版本一致性→双变体构建→隐私审计→打包清单汇报
argument-hint: "[版本号，如 1.2.0]"
allowed-tools: Read, Grep, Glob, ListDir, Edit, Bash
---

执行发布前流程。目标版本号（可空）：$ARGUMENTS

流程（任一环节失败即停下报告，不带病推进）：

1. **门禁**：`pnpm check` 全绿；失败转 `skills/quality-gates` 修复后复跑。
2. **版本一致性**：若给了版本号，核对 `package.json` 的 version 是否一致；不一致则修改并说明（改 version 属发布动作，需用户确认后执行）。
3. **双变体构建**：`pnpm build`（标准版）+ `pnpm build:compat`（兼容版），确认 `.output/` 产物完整。
4. **隐私审计**：按 `/privacy-audit` 全量清单核验（或委派 privacy-auditor），发布前必须「通过」。
5. **打包**：`pnpm zip`（上架用）；如需离线分发再 `pnpm crx`（复用 `.output/tabs.pem` 签名）。
6. **汇报**：产物路径与大小清单、审计结论、自上一版本的变更摘要（基于 `git log` 只读生成，可附 CHANGELOG 草稿供用户确认）。

**禁止动作**：不执行 git tag / git push / 商店上传；不修改隐私检查白名单；不带失败门禁打包。
