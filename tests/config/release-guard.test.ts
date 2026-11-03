import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

function read(path: string): string {
  return readFileSync(`${root}${path}`, 'utf8');
}

describe('发布链路守卫', () => {
  it('tag 发布工作流包含版本核对、正式官网构建与附件校验', () => {
    const workflow = read('.github/workflows/release.yml');
    expect(existsSync(`${root}scripts/release-preflight.mjs`)).toBe(true);
    expect(existsSync(`${root}scripts/release-notes.mjs`)).toBe(true);
    expect(workflow).toContain("tags: ['v*']");
    expect(workflow).toContain('node scripts/release-preflight.mjs');
    expect(workflow).toContain('SITE_BUILD_TARGET=release pnpm site:build:release');
    expect(workflow).toContain('fail_on_unmatched_files: true');
    expect(workflow.indexOf('run: pnpm site:check')).toBeLessThan(
      workflow.indexOf('SITE_BUILD_TARGET=release pnpm site:build:release')
    );
  });

  it('发布前置检查强制要求版本、tag、域名与商店联系字段', () => {
    const preflight = read('scripts/release-preflight.mjs');
    for (const required of [
      'TABS_SITE_URL',
      'TABS_PUBLISHER_NAME',
      'TABS_CONTACT_EMAIL',
      'TABS_SUPPORT_URL',
      'TABS_PRIVACY_POLICY_URL',
      'CHANGELOG.md 缺少',
      'CHROMEWEBSTORE.md 版本历史缺少',
      '缺少绝对地址的私有漏洞报告入口'
    ]) {
      expect(preflight).toContain(required);
    }
  });

  it('CI 固定动作版本有可审计的显式说明，且官网安全测试不漏跑', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('pnpm site:test');
    expect(ci).toContain('pnpm site:check');
    expect(ci).toContain('actions/checkout@v4');
    expect(ci).toContain('pnpm/action-setup@v4');
    expect(ci).toContain('actions/setup-node@v4');
  });

  it('文档明示未核实的浏览器兼容与 Action SHA 发布前核验项', () => {
    const review = read('CHROMEWEBSTORE.md') + read('CODE-REVIEW.md') + read('README.md');
    expect(review).toContain('Chrome 114');
    expect(review).toContain('Action');
    expect(review).toContain('Advisories');
  });

  it('干净工作区不依赖预先生成的 WXT 类型或扩展 ZIP', () => {
    const rootPackage = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    const extensionPackage = JSON.parse(read('apps/extension/package.json')) as {
      scripts: Record<string, string>;
    };
    const sitePackage = JSON.parse(read('apps/site/package.json')) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts['site:check']).toContain('pnpm zip');
    expect(extensionPackage.scripts.typecheck).toContain('wxt prepare');
    expect(sitePackage.scripts.check).toContain('verify-dist.mjs');
    expect(existsSync(`${root}apps/site/verify-dist.mjs`)).toBe(true);
  });
});
