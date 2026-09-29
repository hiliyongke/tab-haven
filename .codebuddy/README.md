# .codebuddy — AI Coding 工作流配置总览

本目录是 Tabs 项目的 CodeBuddy IDE 项目级 AI 配置，覆盖「需求分析 → 编码 → 测试 → 评审 → 门禁 → 合规 → 提交 → 发布」全流程。所有配置均为纯文本、随 git 版本控制、团队共享。日常开发主入口是 `/feature`（全流程串联）；单点需求用各环节命令。

## 目录结构

```
.codebuddy/
├── README.md                 # 本文件（配置总览，不加载进 AI 上下文）
├── rules/                    # 规则：约束 AI 行为的规范
│   ├── code-style/RULE.mdc        # [always] 代码风格与命名
│   ├── architecture/RULE.mdc      # [always] 分层架构红线
│   ├── privacy-security/RULE.mdc  # [always] 隐私与安全红线
│   ├── ai-collaboration/RULE.mdc  # [always] AI 协作约定（最小改动/git 禁区/核验/汇报）
│   ├── testing/RULE.mdc           # [按需] 测试规范（写 tests/ 时加载）
│   └── git-commit/RULE.mdc        # [按需] 提交规范（生成提交信息时加载）
├── agents/                   # 专属智能体（Markdown + YAML frontmatter）
│   ├── requirements-analyst.md    # 需求分析（agentic / 只读）
│   ├── test-engineer.md           # 测试工程师（agentic / 可写 tests/、跑测试）
│   ├── code-reviewer.md           # 代码评审（agentic / 只读）
│   └── privacy-auditor.md         # 隐私审计（agentic / 只读 + 检查脚本）
├── skills/                   # 技能库：操作指南（SKILL.md + 可选 resources）
│   ├── wxt-dev-workflow/SKILL.md      # 开发/构建/打包/变体工作流
│   ├── behavior-spec-testing/SKILL.md # Given/When/Then 测试写法手册
│   ├── schema-evolution/SKILL.md      # 持久化数据变更五步流程
│   ├── quality-gates/SKILL.md         # 各门禁失败的定位与修法
│   ├── ui-component/SKILL.md          # 组件复用清单与新组件规范（防重复造轮子）
│   └── change-recipes/SKILL.md        # 高频变更任务文件地图（设置项/快捷键/菜单/manifest/入口）
├── commands/                 # 自定义斜杠命令（文件名即命令名）
│   ├── feature.md      # /feature <需求>     —— 新功能全流程串联（开发主入口）
│   ├── spec.md         # /spec <需求>        —— 需求分析与实施计划
│   ├── fix.md          # /fix <问题>         —— 最小改动修 bug
│   ├── test.md         # /test <路径>        —— 补行为规格测试
│   ├── review.md       # /review [范围]      —— 四维度代码评审
│   ├── check.md        # /check [单项]       —— 跑门禁并修复
│   ├── commit.md       # /commit [提示]      —— 生成提交信息草稿（不动 git）
│   ├── privacy-audit.md # /privacy-audit     —— 隐私红线自查
│   └── release.md      # /release [版本号]   —— 发布前串联（门禁→双变体→审计→打包）
└── memory/                   # 跨会话项目记忆（CodeBuddy 自动维护，勿手改）
```

项目根另有 `CODEBUDDY.md`（项目速览，每会话全文加载，是 AI 的入口文件）。

## 各模块配置格式速查

| 模块    | 文件形式               | 必填 frontmatter             | 可选 frontmatter                                           | 触发/调用方式                                                                                                             |
| ------- | ---------------------- | ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Rule    | `rules/<名>/RULE.mdc`  | `description`、`alwaysApply` | `enabled`                                                  | always=true 每会话全文加载；false 由 AI 按 description 相关性加载，或对话中 `@规则名` 手动附加                            |
| Agent   | `agents/<名>.md`       | `name`、`description`        | `model`、`tools`、`agentMode`、`enabled`、`enabledAutoRun` | `agentic`：主 Agent 按 description 自动委派（独立上下文）；`manual`：Agent 选择框手动选用                                 |
| Skill   | `skills/<名>/SKILL.md` | `name`、`description`        | `allowed-tools`、`disable`                                 | AI 按 description 自动触发；三级加载（元数据常驻 → 主体触发加载 → references/scripts/assets 按需）                        |
| Command | `commands/<名>.md`     | `description`                | `argument-hint`、`allowed-tools`、`model`                  | 输入框为空时输 `/` 选择；参数占位符 `$ARGUMENTS`（全部）与 `$1 $2…`（按位）；子目录形成命名空间 `dir/name.md → /dir:name` |

约束要点：

- 官方建议 always 类规则控制在 3-5 个（本项目 4 个），其余按需加载，避免上下文膨胀。
- 单条规则控制在 500 行内；大文档拆到 Skill 的 `references/` 按需加载。
- Agent/Skill 的 `tools` / `allowed-tools` 遵循最小权限：只读型（analyst/reviewer/auditor）不授写权限。
- 规则改动后需**新建会话**生效（规则只在会话开始时加载）。

### 官方文档未明示点（待实测校准）

以下三点来自官方文档空白，当前按最合理方案落地，使用中若行为不符按此校准：

1. **Commands 项目级目录**：`.codebuddy/commands/` 是 CodeBuddy Code（CLI）规范；IDE 官方页仅说明「界面创建的是项目级指令」并兼容用户级 `~/.codebuddy/commands/`，未明示项目级目录路径。若 IDE 不识别本目录的命令，回退方案：把命令正文改写为 `alwaysApply: false` 的规则，用 `@规则名` 手动触发。
2. **Agent `tools` 工具名**：官方示例仅出现 `WebFetch, WebSearch`；`Read / Grep / Glob / ListDir / Write / Edit / Bash` 按 CLI 惯例填写，需以 IDE 设置页 Agent 编辑器中的实际工具清单校正，否则白名单可能静默失效。
3. **规则 `alwaysApply: false` 的激活语义**：官方有三种激活类型（总是/智能体请求/手动 @），但未给出区分后两者的 frontmatter 字段；当前按「description 语义匹配自动加载 + 支持 `@规则名` 手动附加」理解。

## 协作关系：模块如何配合

```
功能  /feature ───────────► 开发主线：spec 分析 → 确认 → 编码 → 测试 → 评审 → 门禁 → 提交草稿
                              （各阶段调用下列对应模块；阶段 1 产出计划后须用户确认才落码）
需求  /spec ──────────────► requirements-analyst（只读分析，产出计划）
编码  主 Agent 编码 ◄──────── rules: architecture / privacy-security / code-style / ai-collaboration（always 约束）
                              │ 操作中按需触发
                              ├─ skill: change-recipes（高频任务文件地图，动手前必查）
                              ├─ skill: ui-component（组件复用清单，写 UI 前必查）
                              ├─ skill: schema-evolution（改持久化数据时）
                              ├─ skill: wxt-dev-workflow（起 dev/构建/变体）
                              └─ rules: testing（写测试时加载）
测试  /test ────────────────► test-engineer + skill: behavior-spec-testing
评审  /review ──────────────► code-reviewer（四维度，file:line 清单）
门禁  /check ───────────────► skill: quality-gates（失败逐项修）
合规  /privacy-audit ───────► privacy-auditor（发布前/权限变更后）
发布  /release ─────────────► 门禁 → 双变体构建 → 隐私审计 → zip/crx 打包（不 tag、不上传商店）
提交  /commit ──────────────► rules: git-commit（草稿交用户，AI 不动 git）
```

约定：**Rules 管「必须遵守什么」，Skills 管「具体怎么做」，Agents 管「委派给谁做」，Commands 管「一键启动哪个流程」**。内容不重复存放——规则引用技能（如 architecture 规则指向 schema-evolution 流程），命令引用规则与技能。

## 优先级

1. **作用域优先级**：项目级（`.codebuddy/`）> 用户级（`~/.codebuddy/`）。官方明确 Commands 项目级覆盖同名用户级；Rules/Agents/Skills 官方未明示同名冲突规则，按就近原则以项目级为准，遇异常以实测为准。
2. **内容冲突时的效力排序**（本项目自定义）：`privacy-security` > `architecture` > `ai-collaboration` > `code-style` > 其他按需规则 > 技能指南。即：隐私红线不可被任何便利理由覆盖。
3. **加载顺序**：`CODEBUDDY.md` 全文 → always 规则全文 → 按需规则（名称+描述常驻，相关时读原文）→ Skill 元数据（触发后加载主体）→ Agent（委派时载入其系统提示词）。

## 全流程覆盖矩阵

| 阶段             | 入口                  | 主要模块                                                                           | 质量保障                                              |
| ---------------- | --------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 功能交付（主线） | `/feature`            | 串联下列全部模块                                                                   | 计划确认制；五阶段流水线                              |
| 需求分析         | `/spec`               | requirements-analyst、architecture/privacy-security 规则                           | 宪法冲突前置拦截；影响面点名 schema/权限/文案三类流程 |
| 编码             | 自然语言 / 手动 @规则 | 4 条 always 规则、change-recipes、ui-component、schema-evolution、wxt-dev-workflow | 分层红线 + 最小改动 + 复用优先                        |
| 测试             | `/test`               | test-engineer、testing 规则、behavior-spec-testing                                 | 覆盖率 ratchet；fake-browser 偏差声明                 |
| 评审             | `/review`             | code-reviewer                                                                      | Blocker 分级；全称判断先核验                          |
| 门禁             | `/check`              | quality-gates                                                                      | 禁改配置绕过门禁                                      |
| 合规             | `/privacy-audit`      | privacy-auditor                                                                    | 逐项证据化核验                                        |
| 提交             | `/commit`             | git-commit 规则                                                                    | 草稿确认制；AI 无 git 写权限                          |
| 发布             | `/release`            | quality-gates、privacy-auditor、wxt-dev-workflow                                   | 审计通过才打包；不 tag 不上传                         |

## 扩展指南（新增配置怎么做）

- **加规则**：`rules/<名>/RULE.mdc`，先想清激活方式——核心约束才 `alwaysApply: true`（保持 ≤5 个），场景化规范用 `false` 并把 `description` 写清触发场景。
- **加 Agent**：`agents/<名>.md`，单一职责；`description` 写清「专长 + 范围 + 触发条件」；`tools` 只授必需项，工具名以 IDE Agent 编辑器实际清单为准（见上文「官方文档未明示点」）。
- **加 Skill**：`skills/<名>/SKILL.md`，指令性语言写步骤；长文档放 `references/`，脚本放 `scripts/`，模板放 `assets/`。
- **加 Command**：`commands/<名>.md`（文件名即命令名），正文是提示词模板，参数用 `$ARGUMENTS`/`$1`；同类命令多时用子目录命名空间。
- **通用原则**：新内容优先挂到既有模块（如在既有规则里加一节），避免碎片化；与既有文件重复的信息改为互相引用。

## 维护约定

- 配置随代码评审一起变更：改了工程规范（CONTRIBUTING/门禁/目录结构）→ 同步改本目录对应规则或技能。
- 发现 AI 行为偏差 → 优先改规则描述或技能步骤，而不是在对话里反复纠正。
- 本目录不存项目记忆（`memory/` 由 CodeBuddy 自动维护）、不放业务文档（放 `docs/` 或仓库根）。
