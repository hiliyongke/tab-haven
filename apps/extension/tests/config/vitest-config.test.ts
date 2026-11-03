import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));

describe('Vitest 的 WXT 配置', () => {
  it('固定 WXT dev server 端口，避免测试启动探测随机端口', () => {
    const source = readFileSync(`${root}vitest.config.ts`, 'utf8');
    const wxtConfig = readFileSync(`${root}wxt.config.ts`, 'utf8');
    const port = wxtConfig.match(/const DEV_SERVER_PORT = (\d+);/)?.[1];

    expect(port).toBeDefined();
    expect(source).toMatch(/const DEV_SERVER_PORT = (\d+);/);
    expect(source.match(/const DEV_SERVER_PORT = (\d+);/)?.[1]).toBe(port);
    expect(source).toMatch(/wxtInlineConfig:\s*InlineConfig\b/);
    expect(source).toMatch(
      /dev:\s*\{\s*server:\s*\{\s*port:\s*DEV_SERVER_PORT,\s*strictPort:\s*true\s*\}\s*\}/s
    );
    expect(source).toMatch(/const wxtPlugins = await WxtVitest\(wxtInlineConfig\)/);
    expect(source).toMatch(/plugins: wxtPlugins/);
    expect(source).not.toMatch(/defineConfig\(async \(\)/);
    expect(source).not.toMatch(/plugins:\s*\[WxtVitest\(\)\]/);
  });
});
