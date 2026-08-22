---
description: 评审当前改动：对照架构/隐私/风格/测试四个维度输出 file:line 问题清单
argument-hint: '[路径或范围，默认评审工作区全部未提交改动]'
allowed-tools: Read, Grep, Glob, ListDir, Bash
---

评审以下范围的改动：

$ARGUMENTS

若范围为空，用 `git status` / `git diff`（只读）确定工作区改动清单。

流程与维度（按序）：

1. **红线**：网络请求 / 新权限 / 绕过 schema 校验 / 单语文案 / lint-disable —— 命中即 Blocker。
2. **架构**：core 是否混入 chrome/DOM/React；ui 是否绕过 platform；platform 是否沉淀领域决策。
3. **正确性**：边界、坏数据、异步竞态、撤销/恢复对称性。
4. **一致性**：命名与范式是否沿用既有；是否夹带无关改动。
5. **测试**：core 改动有无行为测试；覆盖率是否下降。

要求：

- 读完整文件再下结论，不只看 diff 片段；下全称判断（"完全没有…"）前先 grep 验证。
- 每条问题：`file:line` + 严重度（Blocker/Major/Minor/Nit）+ 依据（引用 .codebuddy/rules 条款）+ 具体改法。
- 输出格式：结论先行（Approve / Approve with nits / Request changes）→ 问题清单 → 做得对的点。

只评审不修改。大型改动可委派 code-reviewer agent。
