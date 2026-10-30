import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('../bin/i18n-kit.mjs', import.meta.url));

describe('i18n-kit CLI 输出', () => {
  it('退出前完整刷新帮助文本', () => {
    const result = spawnSync(process.execPath, [cliPath, 'help'], { encoding: 'utf8' });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('目录覆盖: --root --src --dict --locales --lngs en,ja');
  });
});
