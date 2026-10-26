import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { redactUrlsForTest } from '@/platform/log';
import * as storageKeys from '@/platform/storage/keys';

/**
 * 存储键脱敏白名单 ↔ 键名声明处的一致性。
 *
 * `platform/log.ts` 为了保护诊断消息里的存储键（「数据读取失败（tabs.snapshots.v1）」
 * 否则会塌成 `<url>.v1`）持有一份键名白名单。keys.ts 的键以常量导入（零重复），
 * 但 `registry.ts` 的分区键与 schema 同处一行、刻意不收进 keys.ts，那一份只能复述。
 *
 * 复述即漂移风险：新增分区键而忘了补白名单，诊断里这个键会重新开始塌缩 ——
 * 而塌缩是**静默**的（不报错、不失败，只是看不出是哪个键坏了）。
 * 这里用「脱敏后键名是否原样保留」这一行为断言兜住，比比对字符串更贴近真问题。
 */

const srcRoot = fileURLToPath(new URL('../../src/', import.meta.url));

/**
 * 取出文件里所有 `tabs.` / `tabs:` 字面量。
 *
 * 分区键的声明处是 `platform/registry.ts`（组合根），不是 `platform/storage/` 下。
 */
function tabsLiterals(file: string): string[] {
  const text = readFileSync(`${srcRoot}${file}`, 'utf8');
  return [...text.matchAll(/['"](tabs[.:][a-zA-Z0-9._-]+)['"]/g)].map((match) => match[1]!);
}

/** keys.ts 导出的存储键常量（排除 `tabs-` 前缀的闹钟名）。 */
function exportedKeys(): string[] {
  // 先放宽为 Record<string, unknown>：模块导出值的类型是各字面量的联合，
  // 直接对它做 `value is string` 谓词收窄会被判定为类型不相交。
  const values: unknown[] = Object.values(storageKeys as Record<string, unknown>);
  return values.filter(
    (value): value is string => typeof value === 'string' && /^tabs[.:]/.test(value)
  );
}

describe('存储键脱敏白名单', () => {
  it('keys.ts 声明的每个键脱敏后原样保留（不是 <url>）', () => {
    const keys = exportedKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(redactUrlsForTest(`数据读取失败（${key}）`), key).toBe(`数据读取失败（${key}）`);
    }
  });

  it('registry.ts 声明的每个分区键脱敏后原样保留（新增键忘了补白名单即失败）', () => {
    const keys = tabsLiterals('platform/registry.ts');
    // 先确认扫描本身有效（抽不到键的话这条用例会恒绿）
    expect(keys).toContain('tabs.snapshots.v1');
    for (const key of keys) {
      expect(redactUrlsForTest(`数据读取失败（${key}）`), key).toBe(`数据读取失败（${key}）`);
    }
  });
});
