// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { GROUP_MODES } from '@/core/schema/models';
import { buildSections } from '@/entrypoints/options/settingSections';

const t = (key: string): string => key;

describe('设置分组配置', () => {
  it('Given 恒等翻译与侧边栏位置，When 构建分组，Then 返回五个稳定锚点且每区都有设置行', () => {
    const sections = buildSections(t, 'left');
    expect(sections.map((section) => section.id)).toEqual([
      'settings.appearance',
      'settings.behavior',
      'settings.memory',
      'settings.groupSearch',
      'settings.advanced'
    ]);
    for (const section of sections) {
      expect(section.titleKey.length).toBeGreaterThan(0);
      expect(section.specs.length).toBeGreaterThan(0);
    }
  });

  it('Given 聚合方式下拉项，When 读取取值，Then 与 GROUP_MODES 同源同序', () => {
    const groupMode = buildSections(t, 'right')
      .flatMap((section) => section.specs)
      .find((spec) => spec.kind === 'select' && spec.key === 'groupMode');
    expect(groupMode?.kind).toBe('select');
    if (groupMode?.kind === 'select') {
      expect(groupMode.options.map((option) => option.value)).toEqual([...GROUP_MODES]);
    }
  });

  it('Given 数值型下拉项，When 调用 parse，Then 把字符串转为数字', () => {
    const threshold = buildSections(t, 'left')
      .flatMap((section) => section.specs)
      .find((spec) => spec.kind === 'select' && spec.key === 'aggregationThreshold');
    expect(threshold?.kind).toBe('select');
    if (threshold?.kind === 'select') {
      expect(threshold.parse?.('3')).toBe(3);
    }
  });
});
