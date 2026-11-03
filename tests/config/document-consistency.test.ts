import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

function read(path: string): string {
  return readFileSync(`${root}${path}`, 'utf8');
}

function permissionsFromManifest(): string[] {
  const source = read('apps/extension/wxt.config.ts');
  const block = source.match(/permissions:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
  return [...block.matchAll(/'([a-zA-Z]+)'/g)].map((match) => match[1]!);
}

function documentedPermissions(text: string): string[] {
  return [...text.matchAll(/^\|\s*`([a-zA-Z]+)`/gm)].map((match) => match[1]!);
}

describe('对外文档一致性', () => {
  it('manifest 权限、PRIVACY 与商店理由表逐项一致', () => {
    const manifest = permissionsFromManifest();
    const privacy = documentedPermissions(read('PRIVACY.md'));
    const store = documentedPermissions(read('CHROMEWEBSTORE.md'));
    expect(manifest.length).toBeGreaterThan(5);
    expect(new Set(manifest)).toEqual(new Set(privacy));
    expect(new Set(manifest)).toEqual(new Set(store));
  });

  it('commands 不再被列为权限，且可选主机权限单独声明', () => {
    const privacy = read('PRIVACY.md');
    const store = read('CHROMEWEBSTORE.md');
    expect(privacy).toContain('`commands`');
    expect(privacy).toContain('不是权限');
    expect(documentedPermissions(privacy)).not.toContain('commands');
    expect(store).toContain('`<all_urls>`');
  });

  it('隐私、商店、安全政策都使用同一主动请求/浏览器同步口径', () => {
    const privacy = read('PRIVACY.md');
    const store = read('CHROMEWEBSTORE.md');
    const security = read('SECURITY.md');
    for (const text of [privacy, store, security]) {
      expect(text).not.toContain('无任何例外');
      expect(text).toMatch(/浏览器账号同步|browser account sync|sync mirror/i);
    }
    expect(privacy).toContain('[SECURITY.md](./SECURITY.md)');
    expect(security).toContain('https://github.com/hiliyongke/tab-haven/security/advisories/new');
  });

  it('Node engines、retired 生成物与本地门禁命令口径一致', () => {
    const rootPackage = JSON.parse(read('package.json')) as {
      engines: { node: string };
      scripts: Record<string, string>;
    };
    const kitPackage = JSON.parse(read('packages/i18n-kit/package.json')) as {
      engines: { node: string };
    };
    const sitePackage = JSON.parse(read('apps/site/package.json')) as {
      engines: { node: string };
      scripts: Record<string, string>;
    };
    expect(kitPackage.engines.node).toBe(rootPackage.engines.node);
    expect(sitePackage.engines.node).toBe(rootPackage.engines.node);
    expect(rootPackage.scripts.check).toContain('site:test');
    const legacyNpmCommand = /(?:^|&&\s*)npm run /;
    expect(rootPackage.scripts.check).not.toMatch(legacyNpmCommand);
    expect(sitePackage.scripts.check).not.toMatch(legacyNpmCommand);
    expect(read('.gitignore')).toContain('/apps/extension/i18n/retired/');
    expect(read('README.md')).not.toContain('i18n/retired` 是词典源');
    expect(read('README.md')).toContain('TABS_SITE_URL');
    expect(read('README.md')).not.toContain('在 `apps/site/site.config.ts` 配置真实站点根 URL');
    expect(read('CHROMEWEBSTORE.md')).toContain('`TABS_SITE_URL`');
  });

  it('对外文档不保留过程性占位与变更史叙述', () => {
    const docs = ['README.md', 'CHANGELOG.md', 'CHROMEWEBSTORE.md', 'PRIVACY.md', 'SECURITY.md'];
    const processWording =
      /本轮|上一轮|下一轮|同日|首轮|第二轮|排查报告|修复计划|分析报告|过程资料|临时探针|发布时填写|发布决策|不得写成|本段|此前修复|现已修复/;
    for (const path of docs) {
      expect(read(path), `${path} 含过程性文字`).not.toMatch(processWording);
    }
  });
});
