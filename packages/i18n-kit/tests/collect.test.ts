import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectFromFile, type CollectOptions } from 'i18n-kit/node';

/**
 * 行为规格：源码词条抽取（`packages/i18n-kit/src/collect.ts`）。
 *
 * 扫描器与守卫共用这一份抽取结果 —— 抽不到就等于「英文模式露中文」，
 * 而且 check / lint 会因为用的是同一份结果而同时给出绿灯。下面每一条
 * 都钉死一类曾真实发生的漏抽。
 */

const dir = mkdtempSync(join(tmpdir(), 'i18n-collect-'));

/** 把一段源码写成临时文件并抽取。 */
function collect(
  code: string,
  name = 'fixture.tsx',
  options?: CollectOptions
): ReturnType<typeof collectFromFile> {
  const file = join(dir, name);
  writeFileSync(file, code, 'utf8');
  return collectFromFile(file, dir, options);
}

const sentences = (code: string): string[] => collect(code).entries.map((entry) => entry.sentence);

describe('collectFromFile: t() 调用点', () => {
  it('Given 字面量原文 When 抽取 Then 登记该原文', () => {
    expect(sentences(`t('编辑标签组');`)).toEqual(['编辑标签组']);
  });

  it('Given 三元表达式两支 When 抽取 Then 两支都登记（漏一支即该分支露中文）', () => {
    // 要防的失效：三元整体被跳过时，运行时两支都会走到却只有一支登记。
    expect(sentences(`t(tab.pinned ? '取消固定' : '固定标签');`)).toEqual(['取消固定', '固定标签']);
  });

  it('Given 逻辑表达式 When 抽取 Then 各分支字面量同样登记', () => {
    expect(sentences(`t(label || '未命名分组');`)).toEqual(['未命名分组']);
  });

  it('Given 插值模板串 When 抽取 Then 报「无法计算 key」而不是静默放过', () => {
    const result = collect('t(`共 ${count} 个标签`);');
    expect(result.entries).toHaveLength(0);
    expect(result.errors.join('\n')).toContain('模板串含插值');
  });

  it('Given context 选项 When 抽取 Then 登记 context（同一原文可有两种译法）', () => {
    const entry = collect(`t('固定标签', { context: 'action' });`).entries[0];
    expect(entry?.sentence).toBe('固定标签');
    expect(entry?.context).toBe('action');
  });

  it('Given 不含汉字的字面量 When 抽取 Then 不登记（语义 key 直通，不进词典）', () => {
    expect(sentences(`t('settings.theme');`)).toEqual([]);
  });
});

describe('collectFromFile: 常量表与 Trans', () => {
  it('Given `*`Key 属性 When 抽取 Then 属性值登记（常量表经 t(var) 渲染的通道）', () => {
    // 约定：属性名以 `Key` 结尾才会被抽走——这是常量表进词典的唯一通道，
    // 靠 `@i18n-ignore` 豁免 zh-linter 只会压住告警、词条仍然进不来。
    expect(sentences(`const X = [{ labelKey: '聚焦搜索' }];`)).toEqual(['聚焦搜索']);
  });

  it('Given 非 `*Key` 属性 When 抽取 Then 不登记（避免把数据常量误当文案）', () => {
    expect(sentences(`const X = [{ keys: '聚焦搜索' }];`)).toEqual([]);
  });

  it('Given <Trans> 子节点 When 抽取 Then 按同层序号串化后登记', () => {
    expect(sentences(`const a = <Trans>已选 <Slot content={count} /> 个标签</Trans>;`)).toEqual([
      '已选 <1></1> 个标签'
    ]);
  });

  it('Given 文件顶部 @i18n-noscan When 抽取 Then 整文件跳过', () => {
    const result = collect(`// @i18n-noscan\nt('编辑标签组');`);
    expect(result.skipped).toBe(true);
    expect(result.entries).toHaveLength(0);
  });
});

describe('collectFromFile: 常量表通道可配置', () => {
  it('Given 自定义 keySuffixes When 抽取 Then 该后缀的属性值也登记（title / placeholder 这类非 t() 通道）', () => {
    // 要防的失效：`{ title: … }` / `{ labelTitle: … }` 这类常量表最终也会传进 t()，
    // 但默认只认 `*Key`，于是只能靠 @i18n-ignore 压住 lint 告警——告警没了，词条依然进不来。
    const entries = collect(`const X = [{ labelTitle: '聚焦搜索' }];`, 'fixture.tsx', {
      keySuffixes: ['Key', 'Title']
    });
    expect(entries.entries.map((entry) => entry.sentence)).toEqual(['聚焦搜索']);
  });

  it('Given 不传 keySuffixes When 抽取 Then 仍只认 `*Key`（默认值即现状，不引入新约定）', () => {
    const entries = collect(`const X = [{ labelKey: '聚焦搜索', title: '换个写法' }];`);
    expect(entries.entries.map((entry) => entry.sentence)).toEqual(['聚焦搜索']);
  });

  it('Given 显式空后缀列表 When 抽取 Then 常量表通道整体关闭', () => {
    const entries = collect(`const X = [{ labelKey: '聚焦搜索' }];`, 'fixture.tsx', {
      keySuffixes: []
    });
    expect(entries.entries).toHaveLength(0);
  });
});
