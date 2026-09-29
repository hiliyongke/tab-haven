---
description: 基于当前改动生成 Conventional Commits 中文提交信息草稿（只生成草稿，不执行 git 提交）
argument-hint: '[可选：提交主题提示]'
allowed-tools: Read, Grep, Glob, Bash
---

为当前改动生成提交信息草稿。用户提示（可空）：$ARGUMENTS

流程：

1. 用只读 git 命令了解改动：`git status`、`git diff --stat`、`git diff`（未暂存）与 `git diff --cached`（已暂存）。
2. 加载 `.codebuddy/rules/git-commit`，按 Conventional Commits 生成中文描述：`<type>(<scope>): <描述>`，scope 取层级目录或入口名。
3. 检查单核对：
   - [ ] 改动单一主题，无夹带；若有，拆成多条草稿建议
   - [ ] `pnpm check` 已全绿（未跑则提醒用户先跑）
   - [ ] 涉权限 → wxt.config.ts 与 PRIVACY.md 双改齐全；涉文案 → 双语 locale 同补；涉持久化 → schema 与 PRIVACY.md 第 3 节同步
4. 输出 1-3 个候选提交信息（必要时含正文：动机/影响面），标注推荐项。

**禁止执行 `git add` / `git commit` 等任何 git 写操作**——草稿交用户确认后由用户自行提交。
