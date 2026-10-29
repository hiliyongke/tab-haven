import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseConfigFileTextToJson } from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * 守护 tsconfig 的别名配置写法：`baseUrl` 自 TS 6.0 起弃用、7.0 移除，
 * 而去掉它之后 `paths` 的映射必须以 `./` 开头，否则 tsc 报 TS5090。
 * 测试范围仅限 tsconfig 配置，不涉及 src 模块。
 */

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Given: 项目根 tsconfig.json（JSONC，含注释，不能直接 JSON.parse） */
function readCompilerOptions(): Record<string, unknown> {
  const fileName = `${projectRoot}tsconfig.json`;
  const { config, error } = parseConfigFileTextToJson(fileName, readFileSync(fileName, 'utf8'));
  expect(error).toBeUndefined();
  return (config?.compilerOptions ?? {}) as Record<string, unknown>;
}

function readPaths(): Record<string, string[]> {
  return (readCompilerOptions().paths ?? {}) as Record<string, string[]>;
}

describe('tsconfig 别名配置', () => {
  it('不使用已弃用的 baseUrl', () => {
    // When: 读取 compilerOptions
    const options = readCompilerOptions();

    // Then: 不存在 baseUrl 键
    expect(options).not.toHaveProperty('baseUrl');
  });

  it('paths 每条映射都是相对本文件的路径', () => {
    // When: 遍历所有别名映射
    const mappings = Object.values(readPaths()).flat();

    // Then: 缺少 baseUrl 时 tsc 要求映射以 ./ 开头
    expect(mappings.length).toBeGreaterThan(0);
    for (const mapping of mappings) {
      expect(mapping.startsWith('./')).toBe(true);
    }
  });

  it('@/* 指向真实存在的源码目录', () => {
    // When: 取 @/* 的第一条映射
    const target = readPaths()['@/*']?.[0];

    // Then: 去掉 glob 后缀后应是存在的目录
    const dir = target?.replace(/\/\*$/, '');
    expect(dir).toBe('./src');
    expect(existsSync(`${projectRoot}${dir?.slice(2)}`)).toBe(true);
  });
});
