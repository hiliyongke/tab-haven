import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toHashKey } from 'i18n-kit';
import { apply, check, dictFile, readJson, resolvePaths, type KitPaths } from 'i18n-kit/node';

/**
 * 行为规格：文案守卫（`packages/i18n-kit/src/commands/check.ts`）。
 *
 * check 是发布前的最后一道闸：它绿了才代表「英文模式不会露中文」。
 * 下面每条都钉死一类事故，且都先跑一条全绿基线——否则「有 issue」的断言
 * 可能只是因为夹具本身不合格，绿灯也有可能是假绿。
 */

const EDIT = '编辑标签组';
const PIN = '固定标签';
const EDIT_KEY = toHashKey(EDIT);
const PIN_KEY = toHashKey(PIN);
const TRANSLATIONS: Record<string, string> = { [EDIT_KEY]: 'Edit group', [PIN_KEY]: 'Pin tab' };

const json = (value: Record<string, string>): string => `${JSON.stringify(value, null, 2)}\n`;

/** 造一个最小工程：按相对路径写文件，返回可直接喂给命令的 KitPaths。 */
function project(files: Record<string, string>): KitPaths {
  const root = mkdtempSync(join(tmpdir(), 'i18n-check-'));
  for (const [name, content] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
  }
  mkdirSync(join(root, 'src'), { recursive: true });
  return resolvePaths(root, { src: 'src', dict: 'i18n', locales: 'locales', lngs: ['en'] });
}

const writeJson = (file: string, value: Record<string, string>): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, json(value), 'utf8');
};

/** 词典 / 译文 / 产物三者一致的工程（守卫应当全绿）。 */
function healthyProject(): KitPaths {
  const paths = project({
    'src/App.tsx': `export const App = () => [t('编辑标签组'), t('固定标签')];`,
    'i18n/source/zh-CN.json': json({ [EDIT_KEY]: EDIT, [PIN_KEY]: PIN }),
    'i18n/translation/en.json': json(TRANSLATIONS)
  });
  apply(paths);
  return paths;
}

describe('check: 基线', () => {
  it('Given 词典、译文、产物三者一致 When 守卫 Then 无 issue（证明下面的红不是夹具不合格）', () => {
    const result = check(healthyProject());

    expect(result.issues).toEqual([]);
    expect(result.stats.total).toBe(2);
    expect(result.stats.translated).toBe(2);
    expect(result.stats.unregistered).toBe(0);
  });
});

describe('check: 规则 1 产物已编译', () => {
  it('Given 词典改了但没跑 apply When 守卫 Then 报「与词典不一致」', () => {
    // 要防的失效：改了原文没编译，界面上仍是旧文案，而代码看不出问题——
    // 词条文件是构建产物，diff 里只是 JSON 没跟着变。
    const paths = healthyProject();
    writeJson(dictFile.source(paths), {
      ...readJson(dictFile.source(paths)),
      [toHashKey('新建标签组')]: '新建标签组'
    });

    const result = check(paths);

    expect(result.issues.some((issue) => issue.includes('与词典不一致'))).toBe(true);
  });
});

describe('check: 规则 2 无孤立译文', () => {
  it('Given 译文文件里有词典中不存在的 key When 守卫 Then 报「孤立译文」', () => {
    // 要防的失效：改文案后旧译文残留。它既不会渲染，也会让「译文补齐」的数量永远对不上。
    const orphan = toHashKey('已下线的文案');
    const paths = project({
      'src/App.tsx': `export const App = () => [t('编辑标签组'), t('固定标签')];`,
      'i18n/source/zh-CN.json': json({ [EDIT_KEY]: EDIT, [PIN_KEY]: PIN }),
      'i18n/translation/en.json': json({ ...TRANSLATIONS, [orphan]: 'Retired copy' })
    });
    apply(paths); // 产物与词典一致，排除规则 1 干扰

    const result = check(paths);

    expect(result.issues.some((issue) => issue.includes('孤立译文'))).toBe(true);
  });
});

describe('check: 规则 4 空译文白名单', () => {
  it('Given emptyAllowed 原文的译文为空 When 守卫 Then 仅该原因可豁免', () => {
    const paths = healthyProject();
    writeJson(dictFile.translation(paths, 'en'), { ...TRANSLATIONS, [EDIT_KEY]: '' });
    apply(paths);

    const result = check(paths, { emptyAllowed: [EDIT] });

    expect(result.issues).toEqual([]);
    expect(result.stats.exempt).toBe(1);
    expect(result.stats.pending).toBe(0);
  });

  it.each([
    ['与母语原文相同', EDIT],
    ['汉字占比', '编辑标签组！']
  ])('Given emptyAllowed 原文%s When 守卫 Then 不得豁免', (_reason, value) => {
    const paths = healthyProject();
    writeJson(dictFile.translation(paths, 'en'), { ...TRANSLATIONS, [EDIT_KEY]: value });
    apply(paths);

    const result = check(paths, { emptyAllowed: [EDIT] });

    expect(result.stats.exempt).toBe(0);
    expect(result.stats.pending).toBe(1);
    expect(result.issues.join('\n')).toContain('伪翻译');
  });
});

describe('check: 规则 3 无未登记原文', () => {
  it('Given 源码里出现词典中没有的原文 When 守卫 Then 报「未登记文案」', () => {
    // 要防的失效（本守卫存在的理由）：写了 t('中文') 没扫描，英文模式直接露中文。
    const paths = project({
      'src/App.tsx': `export const App = () => [t('编辑标签组'), t('未登记的文案')];`,
      'i18n/source/zh-CN.json': json({ [EDIT_KEY]: EDIT }),
      'i18n/translation/en.json': json({ [EDIT_KEY]: 'Edit group' })
    });
    apply(paths);

    const result = check(paths);

    expect(result.issues.some((issue) => issue.includes('未登记文案'))).toBe(true);
    expect(result.stats.unregistered).toBe(1);
    expect(result.unregisteredList.join('\n')).toContain('未登记的文案');
  });
});
