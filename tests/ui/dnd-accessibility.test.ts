// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Active, Over } from '@dnd-kit/core';
import { buildDragAccessibility } from '@/ui/dnd/DndRoot';
import { DragType } from '@/ui/dnd/types';
import i18n from '@/i18n';

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
    const { screenReaderInstructions } = buildDragAccessibility(i18n.t);

    expect(screenReaderInstructions.draggable).toBe(i18n.t('dnd.instructions'));
  });

  it('抓取 / 移动 / 放置 / 取消各阶段都播报当前语言文案', () => {
    const { announcements } = buildDragAccessibility(i18n.t);
    const active = activeOf(TAB_A);
    const over = activeOf(TAB_B) as unknown as Over;

    expect(announcements.onDragStart({ active })).toBe(i18n.t('dnd.grabbed', { title: '标签 A' }));
    expect(announcements.onDragOver({ active, over })).toBe(
      i18n.t('dnd.over', { title: '标签 B' })
    );
    expect(announcements.onDragEnd({ active, over })).toBe(
      i18n.t('dnd.dropped', { title: '标签 B' })
    );
    expect(announcements.onDragEnd({ active, over: null })).toBe(i18n.t('dnd.droppedNowhere'));
    expect(announcements.onDragCancel({ active, over: null })).toBe(i18n.t('dnd.cancelled'));
  });

  it('拖到无目标处不播报 over 文案（避免噪音）', () => {
    const { announcements } = buildDragAccessibility(i18n.t);

    expect(announcements.onDragOver({ active: activeOf(TAB_A), over: null })).toBeUndefined();
  });

  it('文件夹拖拽用名称播报', () => {
    const { announcements } = buildDragAccessibility(i18n.t);

    expect(announcements.onDragStart({ active: activeOf(FOLDER) })).toBe(
      i18n.t('dnd.grabbed', { title: '工作' })
    );
  });
});
