import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '@/core/commands';

/**
 * 浏览器快捷键行为规格：manifest 中的命令 id 与键位和 core/commands 一致；
 * 每条命令有唯一、非空的说明 key。
 */

const root = fileURLToPath(new URL('../..', import.meta.url));

/** 从 `wxt.config.ts` 里解出 manifest 声明的 commands（id → suggested_key）。 */
function manifestCommands(): Map<string, string> {
  const text = readFileSync(`${root}wxt.config.ts`, 'utf8');
  const found = new Map<string, string>();
  for (const match of text.matchAll(
    /'([a-z-]+)':\s*\{\s*suggested_key:\s*\{\s*default:\s*'([^']+)'\s*\}/g
  )) {
    found.set(match[1]!, match[2]!);
  }
  return found;
}

describe('浏览器级快捷键（core/commands ↔ wxt.config.ts）', () => {
  it('manifest 声明的键位与 core/commands 逐项一致', () => {
    // Given: 两侧各自声明的快捷键
    const manifest = manifestCommands();
    const source = new Map<string, string>(
      COMMANDS.map((command) => [command.id, command.suggestedKey])
    );

    // When/Then: 抽取本身必须命中（空集合会让比对恒绿）
    expect(manifest.size).toBeGreaterThan(0);
    expect([...manifest.keys()].sort()).toEqual([...source.keys()].sort());
    for (const [id, key] of manifest) {
      expect(source.get(id), `快捷键 ${id} 的键位与 manifest 不一致`).toBe(key);
    }
  });

  it('每条命令都有中文说明 key（界面文案非空，且不得是落盘常量）', () => {
    // 说明是界面文案：必须走 `labelKey` 常量表通道进词典，否则英文模式露中文。
    for (const command of COMMANDS) {
      expect(command.labelKey.length).toBeGreaterThan(0);
    }
    expect(new Set(COMMANDS.map((c) => c.labelKey)).size).toBe(COMMANDS.length);
  });
});
