---
description: 新功能全流程：需求分析→计划确认→分层落码→测试→自评审→门禁→提交草稿，一键串联
argument-hint: '<功能需求描述>'
allowed-tools: Read, Grep, Glob, ListDir, Write, Edit, Bash, WebFetch
---

按全流程交付以下功能：

$ARGUMENTS

## 阶段 1：需求分析（产出计划，停在此处等确认）

1. 对照 `privacy-security` 规则做宪法审查（本地优先/零网络/免费核心），冲突即驳回并说明。
2. 梳理影响面：涉及层与文件（`file:line`）；点名是否触发三类特殊流程——持久化（`core/schema` + `PRIVACY.md`）、权限（`wxt.config.ts` + `PRIVACY.md`）、文案（双语 locale）。
3. 产出计划：Goals/Non-Goals、用户故事与验收标准、落码步骤拆解、粗略人日。
4. **计划交用户确认后才进入阶段 2**；复杂需求可委派 requirements-analyst。

## 阶段 2：分层落码

- 遵守 architecture / code-style / privacy-security 三条 always 规则。
- 动手前先查 `.codebuddy/skills/change-recipes`（高频任务文件地图）与 `.codebuddy/skills/ui-component`（组件复用清单），避免漏改与重复造轮子。
- 持久化变更必须走 `.codebuddy/skills/schema-evolution` 五步流程。

## 阶段 3：测试

core 改动补行为规格测试（`rules/testing` + `skills/behavior-spec-testing`）；可委派 test-engineer。

## 阶段 4：自评审与门禁

1. 按 `/review` 五维度自查（或委派 code-reviewer），Blocker/Major 清零。
2. 跑 `pnpm check` 全绿；失败按 `skills/quality-gates` 修，禁止改门禁配置。

## 阶段 5：交付

汇报：改动清单（`file:line`）、测试结果、门禁记录、遗留事项；用 `/commit` 生成提交信息草稿交用户。**全程不执行任何 git 写操作。**
