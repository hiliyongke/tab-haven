import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toHashKey } from 'i18n-kit';
import { dictFile, readJson, resolvePaths, scan, type KitPaths } from 'i18n-kit/node';

/**
 * 行为规格：扫描命令（`packages/i18n-kit/src/commands/scan.ts`）。
 *
 * 扫描器是整条链路的入口——它写出的词典决定了 `apply` 的产物、`check` 的判定。
 * 下面每条都钉死一类「命令看着成功、界面却露中文」的事故：
 *   - 词典没落盘（dry 被当成真跑）→ 后面全链路用的是空词典；
 *   - 失效译文没清理 → check 的「孤立译文」一直红；
 *   - 译文没归档 → 文案改回旧版本时译文永久丢失。
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
    // 事故原型：只写词典不写待翻译清单，译文缺口没有任何载体暴露，
    // 直到英文模式露中文才被发现。
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
    // 事故原型：dry 只用于「看看会新增什么」，若顺手写盘，预览动作会污染词典；
    // 但返回值必须仍带原文，否则调用方只能看到一串哈希 key。
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
    // 事故原型：直接删译文 → 文案改回旧版本时译文永久丢失，而译文可复用正是哈希 key 的收益。
    const paths = fixture();

    const result = scan(paths);

    expect(result.removed).toEqual([stale]);
    expect(result.pruned).toEqual({});
    expect(readJson(dictFile.retired(paths, 'en'))[stale]).toBe('Retired copy');
    expect(readJson(dictFile.translation(paths, 'en'))[stale]).toBe('Retired copy');
  });

  it('Given 同上 When 扫描 --prune Then 失效条目从译文文件移除，在译条目不受影响', () => {
    // 事故原型：归档后译文文件里那份成了「词典中不存在的孤立译文」，
    // check 规则 2 一直红而没有任何自动修法（开发者只能手删 key）。
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
   * 事故原型：`--src` 配错（或目录下没有 .ts/.tsx）时抽词结果为空。若照常写入，
   * 整包源词典会被写成 `{}` —— 随后 apply 把两个运行时词条也编译成 `{}`，
   * 界面整包露中文，而词典是资产、没有备份，无从回溯。
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
