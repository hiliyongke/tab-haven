---
description: 隐私与安全红线自查：权限冻结、零网络、存储口径、输入信任边界逐项核验
argument-hint: "[可选：重点范围，如 权限/网络/存储/依赖]"
allowed-tools: Read, Grep, Glob, ListDir, Bash
---

对项目做隐私与安全合规自查。重点范围（可空，空则全量）：$ARGUMENTS

逐项核验（禁止凭印象下结论，每项给证据）：
1. **权限冻结**：比对 `wxt.config.ts` 的 permissions/host_permissions 与 `PRIVACY.md` 权限表。
2. **零网络**：grep `src/` 中 `fetch(`、`XMLHttpRequest`、`WebSocket`、`sendBeacon`、外链资源；执行 `pnpm build && pnpm check:privacy`。
3. **存储口径**：`core/schema` 持久化类型与 `PRIVACY.md` 第 3 节逐项对齐。
4. **输入信任边界**：备份导入、OneTab/Workona 解析、消息载荷是否全经 zod 校验；坏数据是否隔离。
5. **XSS/注入面**：grep `dangerouslySetInnerHTML`、`innerHTML`、`eval`、`new Function`。
6. **依赖**：`package.json` 依赖清单是否有网络行为风险的新面孔。

输出格式：审计结论（通过/不通过）→ 逐项结果表（项目 | 结论 | 证据 file:line）→ 违规项整改建议（严重度 + 改法 + 验收方式）→ 残留风险声明。

只审计不修改；大型审计可委派 privacy-auditor agent。
