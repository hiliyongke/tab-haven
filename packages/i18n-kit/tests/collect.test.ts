import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectFromFile, walk, type CollectOptions } from 'i18n-kit/node';

/**
 * 行为规格：源码词条抽取（`packages/i18n-kit/src/collect.ts`）。
 *
 * 扫描器与守卫共用抽取结果；抽取结果决定词典登记项与检查范围。
 * 以下用例定义抽取器对常见源码结构的当前行为。
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

describe('walk: 源码遍历', () => {
  it('Given 目录不可读取 When 遍历 Then 抛出文件系统异常而不是静默跳过', () => {
    expect(() => walk(join(dir, 'missing'))).toThrow();
  });
});

describe('collectFromFile: t() 调用点', () => {
  it('Given 字面量原文 When 抽取 Then 登记该原文', () => {
    expect(sentences(`t('编辑标签组');`)).toEqual(['编辑标签组']);
  });

  it('Given 三元表达式两支 When 抽取 Then 两支都登记（漏一支即该分支露中文）', () => {
    // 三元表达式的两支字符串字面量都会登记，确保每个可达分支都有词条。
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

  it('Given 字符串拼接原文 When 抽取 Then 报「无法计算 key」而不是静默放过', () => {
    // 字符串拼接无法静态确定完整原文；抽取器会报告错误，不将其静默当作有效词条。
    const result = collect(`t('共' + count + '个标签');`);
    expect(result.entries).toHaveLength(0);
    expect(result.errors.join('\n')).toContain('字符串拼接');
  });

  it('Given context 选项 When 抽取 Then 登记 context（同一原文可有两种译法）', () => {
    const entry = collect(`t('固定标签', { context: 'action' });`).entries[0];
    expect(entry?.sentence).toBe('固定标签');
    expect(entry?.context).toBe('action');
  });

  it('Given context 是非字面量 When 抽取 Then 报错而不是按无 context 算 key', () => {
    // context 非字面量时无法静态确定 key，抽取器报告错误以避免扫描与运行时的 key 不一致。
    const result = collect(`t('固定标签', { context: ctx });`);
    expect(result.errors.join('\n')).toContain('context 不是字面量');
  });

  it('Given 源码有可恢复的语法错误 When 抽取 Then 报「语法错误」且不丢掉能抽到的词条', () => {
    // Babel 的 errorRecovery 会将可恢复语法问题记录在 ast.errors 并继续生成 AST；
    // 抽取器报告语法错误，同时保留仍可抽取的有效词条。tsx 下的 `<T>` 构造该场景。
    const result = collect(`const f = <T>(x: T) => x;\nt('甲文案');`, 'recover.tsx');
    expect(result.errors.join('\n')).toContain('语法错误');
    expect(result.entries.map((entry) => entry.sentence)).toContain('甲文案');
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

  it('Given `*Key` 属性是含中文的插值模板串 When 抽取 Then 报错而非静默漏抽', () => {
    // 含中文的插值模板无法静态确定词条 key；常量表属性值与 t() 参数使用同一抽取规则，
    // 抽取器对该模板串报告错误，避免静默漏词或将其标记为已接管。
    const result = collect('const X = { labelKey: `共 ${count} 个标签` };');
    expect(result.entries).toHaveLength(0);
    expect(result.errors.join('\n')).toContain('模板串含插值');
  });

  it('Given `*Key` 属性是字符串拼接 When 抽取 Then 与 t() 通道同口径报错', () => {
    const result = collect(`const X = { labelKey: '共' + count + ' 个标签' };`);
    expect(result.entries).toHaveLength(0);
    expect(result.errors.join('\n')).toContain('字符串拼接');
  });

  it('Given `*Key` 属性是条件表达式 When 抽取 Then 每一支都入词条，不静默丢弃', () => {
    // 条件表达式的每个字面量分支都会登记，且不产生抽取错误。
    const result = collect(`const X = { labelKey: f ? '丙文案' : '丁文案' };`);
    expect(result.errors).toEqual([]);
    expect(result.entries.map((entry) => entry.sentence)).toEqual(['丙文案', '丁文案']);
  });

  it('Given <Trans> 子节点 When 抽取 Then 按同层序号串化后登记', () => {
    expect(sentences(`const a = <Trans>已选 <Slot content={count} /> 个标签</Trans>;`)).toEqual([
      '已选 <1></1> 个标签'
    ]);
  });

  it('Given <Trans> 条件子节点可能消失 When 抽取 Then 报 key 无法静态计算', () => {
    const result = collect(
      `const a = <Trans>已选 {pinned ? <Slot name="pin" /> : null} 个标签</Trans>;`
    );

    expect(result.errors.join('\n')).toContain('ConditionalExpression');
    expect(result.errors.join('\n')).toContain('无法静态计算 key');
  });

  it('Given <Trans> 嵌套元素内含动态条件 When 抽取 Then 递归报错而非假绿', () => {
    const result = collect(
      `const a = <Trans>已选 <b>{pinned ? <Slot /> : null}</b> 个标签</Trans>;`
    );

    expect(result.errors.join('\n')).toContain('ConditionalExpression');
  });

  it('Given <Trans> 条件两支均为固定空元素 When 抽取 Then 接受稳定占位', () => {
    const result = collect(
      `const a = <Trans>已选 {pinned ? <Slot name="pin" /> : <Slot name="unpin" />} 个标签</Trans>;`
    );

    expect(result.errors).toEqual([]);
    expect(result.entries.map((entry) => entry.sentence)).toEqual(['已选 <1></1> 个标签']);
  });

  it('Given 文件顶部 @i18n-noscan When 抽取 Then 整文件跳过', () => {
    const result = collect(`// @i18n-noscan\nt('编辑标签组');`);
    expect(result.skipped).toBe(true);
    expect(result.entries).toHaveLength(0);
  });
});

describe('collectFromFile: 常量表通道可配置', () => {
  it('Given 自定义 keySuffixes When 抽取 Then 该后缀的属性值也登记（title / placeholder 这类非 t() 通道）', () => {
    // 传入自定义后缀后，匹配属性中的原文进入抽取结果；未配置的后缀仍遵循默认规则。
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
