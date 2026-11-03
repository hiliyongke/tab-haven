import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

function read(path: string): string {
  return readFileSync(`${root}${path}`, 'utf8');
}

function frontmatter(path: string): string {
  const text = read(path);
  return text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
}

describe('AI coding 与 review 规范守卫', () => {
  it('code-rules 是 always 加载的严格规则，覆盖统一评审矩阵', () => {
    const rule = read('.codebuddy/rules/code-rules/RULE.mdc');
    const metadata = frontmatter('.codebuddy/rules/code-rules/RULE.mdc');
    expect(metadata).toContain('alwaysApply: true');
    expect(metadata).toContain('enabled: true');
    expect(rule).toContain('# 严格代码规范与 AI 评审约束');
    expect(rule).toContain('§1–§10');
    for (const section of [
      '## 1. 范围与最小改动',
      '## 2. 分层与依赖',
      '## 3. 类型、数据契约与持久化',
      '## 4. 异步、错误与资源生命周期',
      '## 5. UI、可访问性与交互',
      '## 6. 隐私、权限与安全',
      '## 7. 测试与质量门禁',
      '## 8. 文档、发布与配置一致性',
      '## 9. AI 协作与 Git',
      '## 10. 评审执行矩阵'
    ]) {
      expect(rule, `缺少 ${section}`).toContain(section);
    }
  });

  it('always 规则数量受控，且 code-rules 位于优先级链中', () => {
    const ruleFiles = [
      '.codebuddy/rules/code-rules/RULE.mdc',
      '.codebuddy/rules/code-style/RULE.mdc',
      '.codebuddy/rules/architecture/RULE.mdc',
      '.codebuddy/rules/privacy-security/RULE.mdc',
      '.codebuddy/rules/ai-collaboration/RULE.mdc'
    ];
    for (const path of ruleFiles) {
      expect(frontmatter(path), `${path} 必须 always 加载`).toContain('alwaysApply: true');
    }
    const configReadme = read('.codebuddy/README.md');
    expect(configReadme).toContain('5 条 always');
    expect(configReadme).toContain('`code-rules`');
    expect(read('CODEBUDDY.md')).toContain('.codebuddy/rules/code-rules/RULE.mdc');
    expect(read('CONTRIBUTING.md')).toContain('code-rules/RULE.mdc');
    expect(read('CODE-REVIEW.md')).toContain('code-rules` §10');
    expect(read('.github/PULL_REQUEST_TEMPLATE.md')).toContain('code-rules');
  });

  it('所有执行入口强制引用 code-rules 并要求可复核输出', () => {
    const commands = [
      '.codebuddy/commands/feature.md',
      '.codebuddy/commands/spec.md',
      '.codebuddy/commands/fix.md',
      '.codebuddy/commands/test.md',
      '.codebuddy/commands/review.md',
      '.codebuddy/commands/check.md',
      '.codebuddy/commands/commit.md',
      '.codebuddy/commands/privacy-audit.md',
      '.codebuddy/commands/release.md'
    ];
    for (const path of commands) {
      expect(read(path), `${path} 未引用 code-rules`).toContain('code-rules/RULE.mdc');
    }

    const agents = [
      '.codebuddy/agents/requirements-analyst.md',
      '.codebuddy/agents/test-engineer.md',
      '.codebuddy/agents/code-reviewer.md',
      '.codebuddy/agents/privacy-auditor.md'
    ];
    for (const path of agents) {
      expect(read(path), `${path} 未引用 code-rules`).toContain('code-rules/RULE.mdc');
    }

    const review = read('.codebuddy/commands/review.md');
    const reviewer = read('.codebuddy/agents/code-reviewer.md');
    expect(review).toContain('§1–§10');
    expect(review).toContain('Request changes');
    expect(reviewer).toContain('§1–§10');
    for (const required of ['file:line', '规则编号', '可复现现象', '影响', '最小修法', '验收']) {
      expect(reviewer, `评审输出缺少 ${required}`).toContain(required);
    }
  });

  it('规则、命令与技能不保留过程性资料或宽泛失败掩盖', () => {
    const paths = [
      '.codebuddy/README.md',
      '.codebuddy/commands/review.md',
      '.codebuddy/commands/check.md',
      '.codebuddy/agents/code-reviewer.md',
      '.codebuddy/skills/quality-gates/SKILL.md'
    ];
    const externalDocs = [
      'README.md',
      'CHANGELOG.md',
      'CHROMEWEBSTORE.md',
      'PRIVACY.md',
      'SECURITY.md'
    ];
    const processWording =
      /本轮修复|上一轮|下一轮|临时方案|待确认|发布时填写|会话 handoff|临时探针/;
    for (const path of paths) {
      expect(read(path), `${path} 含过程性文字`).not.toMatch(processWording);
    }
    for (const path of externalDocs) {
      expect(read(path), `${path} 含过程性文字`).not.toMatch(processWording);
    }
    const rule = read('.codebuddy/rules/code-rules/RULE.mdc');
    expect(rule).toContain('不得把过程性资料写入仓库');
    expect(rule).toContain('1.5 文档、注释与 UI 文案不得写');
    expect(read('.gitignore')).toContain('REVIEW-*.md');
    expect(read('.gitignore')).toContain('release-notes.md');
    expect(existsSync(`${root}.workbuddy`)).toBe(false);
    expect(existsSync(`${root}.pnpm-store`)).toBe(false);
  });
});
