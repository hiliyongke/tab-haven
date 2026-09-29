---
name: behavior-spec-testing
description: 行为规格测试编写指南。当需要为 core/platform/stores/ui 编写或补齐 Vitest 测试时使用，提供 Given/When/Then 模板、各层测试手法、坏数据注入与快照约定。硬性门槛（覆盖率 ratchet 等）以 rules/testing 为准。
allowed-tools: Read, Grep, Glob, ListDir, Write, Edit, Bash
disable: false
---

# 行为规格测试编写指南

## 何时使用

写新测试、补覆盖率、为 bug 修复补回归测试时。约束类问题（阈值、目录映射）见 `.codebuddy/rules/testing`，本技能只给写法。

## 标准模板

```ts
describe('<被测对象>', () => {
  it('<场景：当…时，应…>', () => {
    // Given —— 准备输入与前置状态
    // When  —— 执行唯一被测动作
    // Then  —— 断言可观察结果（不断言内部实现）
  });
});
```

- describe 命名领域对象（`DuplicateIndex`），it 命名业务场景（`保留激活标签，关闭同域重复项`），中英文沿用同文件既有风格。
- 一个 it 只验一个行为；分支多的函数按场景拆 it，不写巨型用例。

## 分层手法

| 层 | 手法 |
| --- | --- |
| `tests/core/` | 纯函数直接构造输入断言输出；表驱动（`it.each`）覆盖枚举分支 |
| `tests/platform/` | 用 `fake-browser`；先读同目录已有测试头部注释了解与真实 Chrome 的偏差声明 |
| `tests/stores/` | 操作序列 → 断言 store 状态 + 持久化副作用（spy DataRepository） |
| `tests/ui/` | testing-library 按 role/文案查询；`userEvent` 模拟交互；断言行与 a11y |
| `tests/perf/` | 性能阈值断言，阈值变更必须注释理由 |

## 坏数据注入套路（持久化相关必做）

1. 构造缺字段 / 类型错误 / 超体积上限的数据；
2. 断言被 schema 拒绝或隔离，且不影响其他数据；
3. 断言错误路径有可恢复入口（不静默丢弃）。

## 验证与收尾

```bash
pnpm test:watch tests/<层>/<文件>   # 单文件快验
pnpm test                           # 全量 + 覆盖率（ratchet，不许降）
```

汇报新增测试文件、场景清单与覆盖率变化。

## 输入 / 输出

- 输入：被测模块路径 + 关注点（新功能 / bug 回归 / 补覆盖率）。
- 输出：`tests/` 下新增或修改的测试文件 + 执行结果摘要。
