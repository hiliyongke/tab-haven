// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Active, Over } from '@dnd-kit/core';
import { buildDragAccessibility } from '@/ui/dnd/DndRoot';
import { DragType } from '@/ui/dnd/types';
import { translate } from '@/i18n';

/**
 * 拖拽读屏播报（本地化）。
 *
 * 回归点：dnd-kit 内置指令/公告是英文，若这里回退成内置默认值，
 * 中文界面下的读屏用户会听到与界面语言不一致的提示 —— 只能靠本测试拦住。
 * 各回调藏在 DndContext 内部，因此断言直接驱动导出的构建函数。
 */

function activeOf(data: unknown): Active {
  return { id: 1, data: { current: data } } as unknown as Active;
}

const TAB_A = {
  type: DragType.Tab,
  tabId: 1,
  containerKey: 'section-a',
  canReorder: true,
  title: '标签 A'
};
const TAB_B = { ...TAB_A, tabId: 2, title: '标签 B' };
const FOLDER = { type: DragType.Folder, folderId: 'f1', name: '工作' };

describe('拖拽读屏播报（本地化）', () => {
  it('指令使用界面语言文案（而非 dnd-kit 内置英文）', () => {
    const { screenReaderInstructions } = buildDragAccessibility(translate);

    expect(screenReaderInstructions.draggable).toBe(
      translate('按空格键开始拖拽，用方向键移动，再次按空格键放置，按 Esc 取消')
    );
  });

  it('抓取 / 移动 / 放置 / 取消各阶段都播报当前语言文案', () => {
    const { announcements } = buildDragAccessibility(translate);
    const active = activeOf(TAB_A);
    const over = activeOf(TAB_B) as unknown as Over;

    expect(announcements.onDragStart({ active })).toBe(
      translate('已抓取 {{title}}', { title: '标签 A' })
    );
    expect(announcements.onDragOver({ active, over })).toBe(
      translate('移动到 {{title}}', { title: '标签 B' })
    );
    expect(announcements.onDragEnd({ active, over })).toBe(
      translate('已放置 {{title}}', { title: '标签 B' })
    );
    expect(announcements.onDragEnd({ active, over: null })).toBe(translate('已放置回原位'));
    expect(announcements.onDragCancel({ active, over: null })).toBe(translate('已取消拖拽'));
  });

  it('拖到无目标处不播报 over 文案（避免噪音）', () => {
    const { announcements } = buildDragAccessibility(translate);

    expect(announcements.onDragOver({ active: activeOf(TAB_A), over: null })).toBeUndefined();
  });

  it('结构性不可投放的落点播报「不能放置」，而不是「移动到」', () => {
    // 读屏用户看不到落点禁用态，语言是唯一的信息来源：
    // 先说「移动到 X」、松手后无事发生，等于把视觉层的假高亮原样复制给语音层。
    const { announcements } = buildDragAccessibility(translate);
    const active = activeOf(TAB_A);
    const siteSection = {
      type: DragType.Section,
      sectionKey: 'site-a',
      title: '站点 A',
      tabIds: [1]
    };
    const over = activeOf(siteSection) as unknown as Over;

    expect(announcements.onDragOver({ active, over })).toBe(translate('该位置不能放置'));
    expect(announcements.onDragEnd({ active, over })).toBe(translate('该位置不能放置'));
  });

  it('文件夹拖拽用名称播报', () => {
    const { announcements } = buildDragAccessibility(translate);

    expect(announcements.onDragStart({ active: activeOf(FOLDER) })).toBe(
      translate('已抓取 {{title}}', { title: '工作' })
    );
  });
});
