---
description: 需求分析：把模糊需求变成含验收标准与影响面的实施计划（不写代码）
argument-hint: '<需求描述>'
allowed-tools: Read, Grep, Glob, ListDir, WebFetch
---

对以下需求做实施前分析，产出决策材料（不写任何代码）：

$ARGUMENTS

流程：

1. 先读 `CODEBUDDY.md` 与 `.codebuddy/rules/architecture`、`privacy-security`，确认需求不触碰产品宪法（本地优先/零网络/免费核心）；若冲突，直接判定不可行并说明依据。
2. 阅读相关代码，梳理影响面：涉及层与文件清单（`file:line`），点名是否触发三类特殊流程——持久化变更（core/schema + PRIVACY.md）、权限变更（wxt.config.ts + PRIVACY.md）、新增文案（双语 locale）。
3. 产出 Markdown 计划：结论先行 → 问题陈述与 Goals/Non-Goals → 用户故事与验收标准 → 方案对比（取舍 + 粗略人日）→ 风险与开放问题。
4. 结尾列出需要用户拍板的决策点，等待确认后再进入编码。

复杂需求可委派 requirements-analyst agent 完成第 2-3 步。
