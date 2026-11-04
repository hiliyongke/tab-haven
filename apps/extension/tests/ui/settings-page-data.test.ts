// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import type { SettingSpec } from '@/entrypoints/options/settingSections';
import {
  MAX_IMPORT_BYTES,
  partitionLabel,
  matchesSettingSpec,
  collectVisibleSections,
  buildStaticOutlineItems,
  buildOutlineItems,
  importFailureMessage,
  type VisibleSection
} from '@/entrypoints/options/settingsPageData';

const t = (key: string): string => key;

const toggleSpec: SettingSpec = {
  kind: 'toggle',
  key: 'showUrl',
  labelKey: '显示网址',
  hintKey: '在标签标题下方显示完整网址'
};

describe('设置页数据与纯函数', () => {
  it('Given 已知分区名，When 取界面称呼，Then 返回对应中文原文', () => {
    expect(partitionLabel('folders', t)).toBe('收藏夹');
    expect(partitionLabel('snapshots', t)).toBe('快照');
  });

  it('Given 未知分区名，When 取界面称呼，Then 原样返回不丢信息', () => {
    expect(partitionLabel('unlisted', t)).toBe('unlisted');
  });

  it('Given 空查询词，When 匹配设置行，Then 恒为命中', () => {
    expect(matchesSettingSpec(toggleSpec, '', t)).toBe(true);
  });

  it('Given 查询词命中标题，When 匹配设置行，Then 返回 true', () => {
    expect(matchesSettingSpec(toggleSpec, '网址', t)).toBe(true);
  });

  it('Given 查询词无命中，When 匹配设置行，Then 返回 false', () => {
    expect(matchesSettingSpec(toggleSpec, '不存在的设置', t)).toBe(false);
  });

  it('Given 分区标题命中，When 收集可见分区，Then 整区设置行都保留', () => {
    const sections = [{ id: 'x', titleKey: '分组与搜索', specs: [toggleSpec] }];
    const visible = collectVisibleSections(sections, DEFAULT_SETTINGS, '分组', t);
    expect(visible[0]?.specs).toHaveLength(1);
  });

  it('Given 查询无命中且分区标题未命中，When 收集可见分区，Then 该行被过滤', () => {
    const sections = [{ id: 'x', titleKey: '外观与布局', specs: [toggleSpec] }];
    const visible = collectVisibleSections(sections, DEFAULT_SETTINGS, '不存在', t);
    expect(visible[0]?.specs).toHaveLength(0);
  });

  it('Given 静态区块表，When 按查询过滤，Then 仅保留命中的区块', () => {
    expect(buildStaticOutlineItems(t, '')).toHaveLength(6);
    const hit = buildStaticOutlineItems(t, '快捷键');
    expect(hit).toHaveLength(1);
    expect(hit[0]?.id).toBe('settings.shortcuts');
  });

  it('Given 静态区块与可见分区，When 组装目录，Then 前三项静态 + 动态分区 + 其余静态', () => {
    const staticItems = buildStaticOutlineItems(t, '');
    const visible: VisibleSection[] = [
      {
        section: { id: 'settings.appearance', titleKey: '外观与布局', specs: [] },
        specs: [toggleSpec]
      }
    ];
    const items = buildOutlineItems(staticItems, visible, t);
    expect(items).toHaveLength(7);
    expect(items[0]?.id).toBe('presets.title');
    expect(items[3]?.id).toBe('settings.appearance');
  });

  it('Given 版本不匹配错误，When 生成导入失败提示，Then 指向当前版本备份', () => {
    expect(
      importFailureMessage('export-version-mismatch', new Error('export-version-mismatch'), t)
    ).toContain('当前版本');
  });

  it('Given 未知错误，When 生成导入失败提示，Then 回退到通用提示', () => {
    expect(importFailureMessage('', new Error('boom'), t)).toBe('导入失败：备份文件无效或无法读取');
  });

  it('Given 导入体积上限，When 读取常量，Then 为 5MB', () => {
    expect(MAX_IMPORT_BYTES).toBe(5 * 1024 * 1024);
  });
});
