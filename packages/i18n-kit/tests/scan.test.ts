import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toHashKey } from 'i18n-kit';
import { dictFile, readJson, resolvePaths, scan, type KitPaths } from 'i18n-kit/node';

/**
 * 行为规格：扫描命令（`packages/i18n-kit/src/commands/scan.ts`）。
 *
 * 扫描器写出的词典、待翻译清单与失效译文归档决定 `apply` 和 `check` 的输入。
 * 以下用例约束扫描的当前行为：
 *   - 正常扫描写入词典与待翻译清单，dry 只返回预览结果；
 *   - 失效译文默认归档并保留在译文文件中，`--prune` 可移除译文文件条目；
 *   - 抽取为空且已有词典时报告错误并保护已有数据。
 */

/** 造一个最小工程：按相对路径写文件，返回可直接喂给命令的 KitPaths。 */
function project(files: Record<string, string>): KitPaths {
  const root = mkdtempSync(join(tmpdir(), 'i18n-scan-'));
  for (const [name, content] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
  }
  // 源码目录必须存在（walk 会读它），空工程也算合法输入
  mkdirSync(join(root, 'src'), { recursive: true });
  return resolvePaths(root, { src: 'src', dict: 'i18n', locales: 'locales', lngs: ['en'] });
}

const json = (value: Record<string, string>): string => `${JSON.stringify(value, null, 2)}\n`;

describe('scan: 首次扫描', () => {
  it('Given 源码里有中文原文 When 扫描 Then 词典与待翻译清单同时落盘', () => {
    // 待翻译清单保存缺少译文的原文，为后续补译提供明确输入。
    const paths = project({
      'src/App.tsx': `export const App = () => [t('编辑标签组'), t('固定标签')];`
    });

    const result = scan(paths);

    expect(result.errors).toEqual([]);
    expect(result.scannedFiles).toBe(1);
    expect(result.total).toBe(2);
    expect(result.added).toHaveLength(2);

    const source = readJson(dictFile.source(paths));
    expect(Object.values(source).sort()).toEqual(['编辑标签组', '固定标签'].sort());
    // 译文尚未填写：清单里就是母语原文，交给人工或流程填回
    expect(readJson(dictFile.untranslated(paths, 'en'))).toEqual(source);
    expect(result.pending.en).toBe(2);
  });

  it('Given 已登记原文 When 再次扫描 Then 不重复新增，且已译条目不进待翻译清单', () => {
    const key = toHashKey('编辑标签组');
    const paths = project({
      'src/App.tsx': `export const App = () => t('编辑标签组');`,
      'i18n/source/zh-CN.json': json({ [key]: '编辑标签组' }),
      'i18n/translation/en.json': json({ [key]: 'Edit group' })
    });

    const result = scan(paths);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.pending.en).toBe(0);
    expect(readJson(dictFile.untranslated(paths, 'en'))).toEqual({});
  });
});

describe('scan: --dry', () => {
  it('Given --dry When 扫描 Then 不落盘，但 result.dictionary 能取到新增原文', () => {
    // dry 仅返回预览结果：新增原文保存在 result.dictionary 中，源词典与待翻译清单不写盘。
    const paths = project({ 'src/App.tsx': `export const App = () => t('编辑标签组');` });

    const result = scan(paths, { dry: true });

    expect(result.added).toEqual([toHashKey('编辑标签组')]);
    expect(result.dictionary[toHashKey('编辑标签组')]).toBe('编辑标签组');
    expect(existsSync(dictFile.source(paths))).toBe(false);
    expect(existsSync(dictFile.untranslated(paths, 'en'))).toBe(false);
  });
});

describe('scan: 失效词条', () => {
  const live = toHashKey('固定标签');
  const stale = toHashKey('已下线的文案');

  const fixture = (): KitPaths =>
    project({
      'src/App.tsx': `export const App = () => t('固定标签');`,
      'i18n/source/zh-CN.json': json({ [live]: '固定标签', [stale]: '已下线的文案' }),
      'i18n/translation/en.json': json({ [live]: 'Pin tab', [stale]: 'Retired copy' })
    });

  it('Given 源码里已删除的原文 When 扫描（不带 --prune） Then 译文归档但译文文件保留', () => {
    // 默认扫描将失效译文写入归档并保留其在译文文件中的条目，以便原文再次出现时复用。
    const paths = fixture();

    const result = scan(paths);

    expect(result.removed).toEqual([stale]);
    expect(result.pruned).toEqual({});
    expect(readJson(dictFile.retired(paths, 'en'))[stale]).toBe('Retired copy');
    expect(readJson(dictFile.translation(paths, 'en'))[stale]).toBe('Retired copy');
  });

  it('Given 同上 When 扫描 --prune Then 失效条目从译文文件移除，在译条目不受影响', () => {
    // --prune 只从译文文件移除失效条目；在译条目保持不变，归档中的译文仍可复用。
    const paths = fixture();

    const result = scan(paths, { prune: true });

    expect(result.pruned).toEqual({ en: 1 });
    const translation = readJson(dictFile.translation(paths, 'en'));
    expect(translation[stale]).toBeUndefined();
    expect(translation[live]).toBe('Pin tab');
    // 剪枝只动译文文件：归档仍在，改回旧文案还能捞回来
    expect(readJson(dictFile.retired(paths, 'en'))[stale]).toBe('Retired copy');
  });
});

describe('scan: 抽空保护', () => {
  /**
   * 抽空保护：已有词典且抽取结果为空时，扫描报告错误并保持源词典和译文文件不变。
   * 空词典工程仍允许首次扫描并写入空词典，见下例。
   */
  it('Given 既有词典且本次一条都没抽到 When 扫描 Then 报错且不落盘', () => {
    const key = toHashKey('编辑标签组');
    const paths = project({
      // project 会创建空的 src 目录：模拟「扫了个没有源码的目录」
      'i18n/source/zh-CN.json': json({ [key]: '编辑标签组' }),
      'i18n/translation/en.json': json({ [key]: 'Edit group' })
    });

    const result = scan(paths);

    expect(result.total).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    // 词典与译文必须原样保留（一次配置失误不该清空一份资产）
    expect(readJson(dictFile.source(paths))[key]).toBe('编辑标签组');
    expect(readJson(dictFile.translation(paths, 'en'))[key]).toBe('Edit group');
  });

  it('Given 全新工程（尚无词典）When 首次扫描就抽空 Then 不报错（不阻塞空项目初始化）', () => {
    const paths = project({});

    const result = scan(paths);

    expect(result.total).toBe(0);
    expect(result.errors).toEqual([]);
    expect(existsSync(dictFile.source(paths))).toBe(true);
  });
});
