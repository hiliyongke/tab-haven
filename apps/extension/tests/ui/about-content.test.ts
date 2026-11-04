// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '@/core/commands';
import {
  CAPABILITY_GROUPS,
  ENTRY_POINTS,
  PANEL_SHORTCUTS,
  GLOBAL_SHORTCUTS,
  PRIVACY_BADGES,
  PRIVACY_FACTS,
  PERMISSION_FACTS,
  TRUST_EXTRA_FACTS,
  TECH_FACTS,
  SECTION_TITLE_CLASS,
  CARD_CLASS
} from '@/entrypoints/about/aboutData';

describe('关于页静态内容', () => {
  it('Given 能力总览常量表，When 读取能力域，Then 12 个域都有图标、标题原文与成对说明', () => {
    expect(CAPABILITY_GROUPS).toHaveLength(12);
    for (const group of CAPABILITY_GROUPS) {
      expect(group.icon).toBeTruthy();
      expect(group.titleKey.length).toBeGreaterThan(0);
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(item.titleKey.length).toBeGreaterThan(0);
        expect(item.bodyKey.length).toBeGreaterThan(0);
      }
    }
  });

  it('Given 浏览器级快捷键表，When 与 COMMANDS 对照，Then 条目与命令同源且逐条带键位数组', () => {
    expect(GLOBAL_SHORTCUTS).toHaveLength(COMMANDS.length);
    for (const shortcut of GLOBAL_SHORTCUTS) {
      expect(shortcut.labelKey.length).toBeGreaterThan(0);
      expect(Array.isArray(shortcut.keys)).toBe(true);
    }
  });

  it('Given 其余说明常量表，When 读取条目，Then 均非空且样式类可用', () => {
    expect(ENTRY_POINTS.length).toBeGreaterThan(0);
    expect(PANEL_SHORTCUTS.length).toBeGreaterThan(0);
    expect(PRIVACY_BADGES.length).toBeGreaterThan(0);
    expect(PRIVACY_FACTS.length).toBeGreaterThan(0);
    expect(PERMISSION_FACTS.length).toBeGreaterThan(0);
    expect(TRUST_EXTRA_FACTS.length).toBeGreaterThan(0);
    expect(TECH_FACTS.length).toBeGreaterThan(0);
    expect(SECTION_TITLE_CLASS.length).toBeGreaterThan(0);
    expect(CARD_CLASS.length).toBeGreaterThan(0);
  });
});
