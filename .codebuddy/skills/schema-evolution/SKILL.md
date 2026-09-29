---
name: schema-evolution
description: 持久化数据变更全流程。当新增/修改存储字段、变更导入导出备份格式、调整坏数据策略时使用——串联 core/schema 修改、PRIVACY.md 同步、EXPORT_FILE_VERSION 递增与隔离测试，防止口径失真与数据事故。
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
disable: false
---

# 持久化数据变更流程

## 何时使用

任何会让「落盘数据的形状」发生变化的改动：新增设置项、快照格式调整、备份导入导出变更、存储上限调整。

## 五步流程（顺序不可乱）

1. **改 schema**：在 `src/core/schema` 修改对应 zod schema——默认值、体积上限、坏数据隔离策略都在这里定义；TS 类型用 `z.infer` 同源导出，不另立接口。
2. **评估版本**：若影响导出备份格式 → 递增 `EXPORT_FILE_VERSION`（单一备份格式，`z.literal` 校验，版本不符即拒导，不做跨版本兼容）。
3. **同步隐私口径**：更新 `PRIVACY.md` 第 3 节「我们存储的数据」表（新增存储类型/字段必填）。
4. **补测试**：
   - 新 schema 的接受/拒绝分支；
   - 坏数据注入（缺字段、类型错、超限）→ 断言隔离而非扩散；
   - 导入事务性：失败整体回滚，无半持久化状态。
5. **跑门禁**：`pnpm test && pnpm check:privacy`（后者要求先 `pnpm build`）。

## 检查单（交付前逐项确认）

- [ ] schema 校验是唯一定义处，UI 输入处没有重复造校验逻辑
- [ ] 坏数据路径有测试且行为是「隔离 + 可恢复」，不是静默丢弃
- [ ] `PRIVACY.md` 对外口径与代码一致
- [ ] 备份格式变了 → `EXPORT_FILE_VERSION` 已递增
- [ ] 没有引入新存储却忘记登记

## 输入 / 输出

- 输入：数据形状变更需求描述或目标 schema 文件。
- 输出：schema + PRIVACY.md + 测试三处联动改动 + 门禁执行结果。
