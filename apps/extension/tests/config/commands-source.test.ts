import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '@/core/commands';

/**
 * 守护浏览器级快捷键的单一口径（`core/commands` ↔ `wxt.config.ts`）。
 *
 * 快捷键此前有两份硬编码：manifest 里一份、设置页与关于页各一份展示文案，
 * 且两处的 Mac 修饰键口径还不一致。改了 `suggested_key` 而漏改界面，
 * 用户看到的说明就是错的，而门禁全绿。
 *
 * `wxt.config.ts` 写的是字面量（manifest 是构建期产物，无法运行时 import），
 * 故这里不消除复制，而是让复制**必须对齐**：键位或 id 任一方向漂移即失败。
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
