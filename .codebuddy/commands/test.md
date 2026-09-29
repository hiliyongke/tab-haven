---
description: 为指定模块补齐行为规格测试并验证覆盖率不降级
argument-hint: '<目标路径或模块名> [关注点：新功能/bug回归/补覆盖率]'
allowed-tools: Read, Grep, Glob, ListDir, Write, Edit, Bash
---

为以下目标补齐测试：

$ARGUMENTS

流程：

1. 加载 `.codebuddy/rules/testing` 与 `.codebuddy/skills/behavior-spec-testing`，沿用目标模块同层已有测试的结构与命名。
2. 列测试场景清单（正常路径 / 边界 / 坏数据注入），先给清单再落码。
3. 分层手法：core 纯函数表驱动；platform 用 fake-browser（先读既有测试头部注释的偏差声明）；stores 断言状态+持久化副作用；ui 用 testing-library 断言行。
4. 验证：`pnpm test:watch <目标文件>` 通过后跑全量 `pnpm test`，确认覆盖率 ratchet 未降（只升不降，禁止调阈值）。
5. 汇报：新增/修改测试文件、场景清单、覆盖率变化。

只写 `tests/**`；发现实现 bug 时输出 `file:line` + 根因，交还用户，不擅自改 `src/**`。
复杂任务可委派 test-engineer agent。
