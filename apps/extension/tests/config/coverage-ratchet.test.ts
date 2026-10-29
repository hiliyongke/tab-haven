import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import extensionConfig from '../../vitest.config';

/**
 * 覆盖率棘轮守卫。
 *
 * `vitest.config.ts` 里那十几档阈值此前只是**配置常数**：把 `src/core/**` 的
 * `lines: 90` 改成 `70` 并与被测代码同 PR 提交，`pnpm check` 与 CI 全绿 ——
 * 「为绕过门禁修改覆盖率配置不接受」（CONTRIBUTING）这条纪律没有任何机器校验。
 *
 * 这里把阈值与 `coverage-baseline.json` 的基线逐档比对：任一档被调小即失败，
 * 失败信息写明「哪档、哪个指标、从多少降到多少」。
 */

interface Metric {
  lines?: number;
  statements?: number;
  branches?: number;
  functions?: number;
}

const METRICS = ['lines', 'statements', 'branches', 'functions'] as const;

const baselinePath = fileURLToPath(new URL('../../coverage-baseline.json', import.meta.url));
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
  thresholds: Record<string, Metric>;
};

const current = (
  extensionConfig as unknown as {
    test?: { coverage?: { thresholds?: Record<string, Metric> } };
  }
).test?.coverage?.thresholds;

describe('覆盖率棘轮（vitest.config ↔ coverage-baseline）', () => {
  it('基线文件非空且能取到当前阈值（空集合会让比对恒绿）', () => {
    // Given/When/Then: 两侧抽取本身必须命中
    expect(Object.keys(baseline.thresholds).length).toBeGreaterThan(0);
    expect(current).toBeDefined();
    expect(Object.keys(current ?? {}).length).toBeGreaterThan(0);
  });

  it('每一档的每一项指标都不低于基线', () => {
    // Given: 基线与当前阈值
    const thresholds = current ?? {};
    const regressions: string[] = [];

    // When: 逐档逐项比对
    for (const [glob, floor] of Object.entries(baseline.thresholds)) {
      const actual = thresholds[glob];
      if (!actual) {
        regressions.push(`${glob}：阈值被整档删除（基线 ${JSON.stringify(floor)}）`);
        continue;
      }
      for (const metric of METRICS) {
        const floorValue = floor[metric];
        const actualValue = actual[metric];
        if (floorValue === undefined || actualValue === undefined) continue;
        if (actualValue < floorValue) {
          regressions.push(`${glob} ${metric}: ${floorValue} → ${actualValue}`);
        }
      }
    }

    // Then: 任何一档被调小都必须失败
    expect(regressions, `覆盖率阈值被调小：\n  ${regressions.join('\n  ')}`).toEqual([]);
  });

  it('基线覆盖了当前全部阈值档位（新增档位要同步基线）', () => {
    // 反向也要守：新增一档而不写基线，等于给未来的下调留了一条没有下限的口子。
    const missing = Object.keys(current ?? {}).filter((glob) => !(glob in baseline.thresholds));
    expect(
      missing,
      `以下阈值档位在 coverage-baseline.json 中没有基线: ${missing.join(', ')}`
    ).toEqual([]);
  });
});

/**
 * 阈值档的 glob 必须至少命中一个文件。
 *
 * vitest 对「0 命中」的阈值档不报错（4.x 实测），目录改名后该档静默失效，
 * 而上面的棘轮仍只比数字 —— 两道门会一起绿。这条断言把「档位还在」变成可验证事实。
 */
describe('覆盖率阈值档位命中校验', () => {
  const SRC = fileURLToPath(new URL('../../src', import.meta.url));

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });

  /** 只支持 `**` 与 `*`：阈值档只用到这两种。 */
  const globToRegExp = (glob: string): RegExp => {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      // 先用占位串吃掉 `**`，否则随后的单星替换会把它拆成两段。
      .replace(/\*\*/g, '@@DOUBLE_STAR@@')
      .replace(/\*/g, '[^/]*')
      .replace(/@@DOUBLE_STAR@@/g, '.*');
    return new RegExp(`^${escaped}$`);
  };

  it('每一档都命中至少一个源文件（glob 失效会让该档恒绿）', () => {
    const files = walk(SRC).map(
      (file) => `src/${file.slice(SRC.length + 1).replaceAll('\\', '/')}`
    );
    // global 是全局汇总，不是路径 glob。
    const globs = Object.keys(current ?? {}).filter((glob) => glob !== 'global');
    expect(globs.length).toBeGreaterThan(0);
    const misses = globs.filter((glob) => {
      const pattern = globToRegExp(glob);
      return !files.some((file) => pattern.test(file));
    });
    expect(misses, `以下阈值档未命中任何文件:\n  ${misses.join('\n  ')}`).toEqual([]);
  });
});
