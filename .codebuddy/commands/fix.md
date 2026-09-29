---
description: 最小改动修 bug：定位根因→最小修复→回归测试→汇报，不顺手改既有约定
argument-hint: '<问题描述或报错信息>'
allowed-tools: Read, Grep, Glob, ListDir, Write, Edit, Bash
---

修复以下问题，严格遵守最小改动纪律：

$ARGUMENTS

流程：

1. **定位根因**：以当前代码现状为准（不翻 git 历史猜因），用搜索与阅读定位，给出 `file:line` 与根因一句话说明。
2. **最小修复**：只修根因，不改变既有设计约定（阈值、窗口、状态集、接口形状等）。增强项/顺手优化/计划外发现的同类隐患——记入汇报末尾，不直接改。
3. **分层自检**：修复落在哪一层，是否符合 architecture 规则的依赖方向。
4. **回归验证**：为修复补一个行为规格测试（tests/ 对应层镜像目录）；跑 `pnpm test:watch <相关测试>` 与 `pnpm typecheck && pnpm lint`。
5. **汇报**：根因、改动清单（`file:line`）、验证结果、遗留隐患清单（待用户决定是否处理）。

修改文件只用 read_file + replace_in_file / write_to_file，不用脚本批量改。不执行任何 git 操作。
