// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { preserveFocusBeforeCollapse, restoreFocus } from '@/ui/domContract';

/**
 * 焦点归还不变量（§4②/§4③）：
 *  - restoreFocus：触发元素仍在 DOM 就还给它；已卸载则延后落到面板内首个可聚焦元素，
 *    避免「关闭该标签」后触发行消失导致焦点掉回 <body>。
 *  - preserveFocusBeforeCollapse：折叠前若焦点在被折叠分区 body 内，移到存活的分区头
 *    toggle；正常点击 toggle 时焦点本就在 toggle，此函数须为空操作。
 */

afterEach(() => {
  document.body.innerHTML = '';
});

describe('restoreFocus 浮层焦点归还', () => {
  it('trigger 仍在 DOM：同步把焦点还给它', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    restoreFocus(trigger);

    expect(document.activeElement).toBe(trigger);
  });

  it('trigger 已卸载：延后把焦点落到 .app 内首个可聚焦元素（不掉 body）', async () => {
    // Given: 面板根 + 一个可聚焦元素，trigger 是一个已断开的节点
    const app = document.createElement('div');
    app.className = 'app';
    const fallback = document.createElement('button');
    app.appendChild(fallback);
    document.body.appendChild(app);
    const detached = document.createElement('button'); // 未挂载

    // When: 归还到已卸载的 trigger
    restoreFocus(detached);
    // queueMicrotask：等待兜底聚焦执行
    await Promise.resolve();

    // Then: 焦点落在面板内可聚焦元素，不是 body
    expect(document.activeElement).toBe(fallback);
  });

  it('trigger 为 null：同样回落，不抛错', async () => {
    const app = document.createElement('div');
    app.className = 'app';
    const input = document.createElement('input');
    app.appendChild(input);
    document.body.appendChild(app);

    restoreFocus(null);
    await Promise.resolve();

    expect(document.activeElement).toBe(input);
  });
});

describe('preserveFocusBeforeCollapse 折叠前焦点保持', () => {
  it('焦点在分区 body 内：移到存活的分区头 toggle', () => {
    // Given: 一个 section-card，头有 toggle，body 内有可聚焦行按钮
    const card = document.createElement('section');
    card.className = 'section-card';
    const toggle = document.createElement('button');
    toggle.className = 'toggle';
    const body = document.createElement('div');
    body.className = 'section-body';
    const rowButton = document.createElement('button');
    body.appendChild(rowButton);
    card.appendChild(toggle);
    card.appendChild(body);
    document.body.appendChild(card);
    rowButton.focus();
    expect(document.activeElement).toBe(rowButton);

    // When: 折叠前调用
    preserveFocusBeforeCollapse();

    // Then: 焦点移到存活的 toggle（body 即将卸载）
    expect(document.activeElement).toBe(toggle);
  });

  it('焦点已在 toggle 上（正常点击折叠）：空操作，焦点不动', () => {
    const card = document.createElement('section');
    card.className = 'section-card';
    const toggle = document.createElement('button');
    toggle.className = 'toggle';
    const body = document.createElement('div');
    body.className = 'section-body';
    card.appendChild(toggle);
    card.appendChild(body);
    document.body.appendChild(card);
    toggle.focus();

    preserveFocusBeforeCollapse();

    // Then: 焦点仍在 toggle（没有乱跳）
    expect(document.activeElement).toBe(toggle);
  });

  it('焦点在分区外：空操作，不抢焦点', () => {
    const outside = document.createElement('button');
    const card = document.createElement('section');
    card.className = 'section-card';
    const toggle = document.createElement('button');
    toggle.className = 'toggle';
    card.appendChild(toggle);
    document.body.appendChild(outside);
    document.body.appendChild(card);
    outside.focus();

    preserveFocusBeforeCollapse();

    expect(document.activeElement).toBe(outside);
  });
});
