// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { translate } from '@/i18n';
import { ControlIdContext } from '@/ui/common/controlId';
import { Chip } from '@/ui/common/Chip';
import { Checkbox } from '@/ui/common/Checkbox';
import { CollapseChevron } from '@/ui/common/CollapseChevron';
import { ColorSwatchGroup } from '@/ui/common/ColorSwatchGroup';
import { RowActionButton } from '@/ui/common/RowActionButton';
import { RowItem } from '@/ui/common/RowItem';
import { StatusBadges } from '@/ui/common/StatusBadges';
import { Icons } from '@/ui/common/Icon';
import type { TabRecord } from '@/core/tab-types';

/**
 * L1/L2 中间层原语的行为规格。
 *
 * 为什么单列一个文件：这五个组件没有业务语义，各自一个测试文件会让「原语层」
 * 的契约散在五个地方；它们共有的约定（可访问名只写一次、禁用态、单一配色口径）
 * 本来就是同一组决策。
 *
 * 查询一律按 role / 可访问名，不按 class —— 只有「CSS 钩子」（.is-danger /
 * .chip--cjk / 旋转类）与配色映射这类**契约本身**才断言类名。
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RowActionButton', () => {
  it('label 同时落到 title 与 aria-label（调用方不再写两遍）', () => {
    // Given: 一个只给了 label 的行内按钮
    render(<RowActionButton icon={Icons.close} label="关闭标签" />);

    // When: 按可访问名查询
    const button = screen.getByRole('button', { name: '关闭标签' });

    // Then: title 与 aria-label 同源
    expect(button).toHaveAttribute('title', '关闭标签');
    expect(button).toHaveAttribute('aria-label', '关闭标签');
  });

  it('tooltip 只覆盖 title，可访问名仍是 label', () => {
    // Given: 悬停提示比可访问名长（收藏夹的概念说明入口）
    render(<RowActionButton icon={Icons.infoAlert} label="查看概念说明" tooltip="什么是收藏夹" />);

    // When: 按可访问名查询
    const button = screen.getByRole('button', { name: '查看概念说明' });

    // Then: 长文案只出现在 title
    expect(button).toHaveAttribute('title', '什么是收藏夹');
  });

  it('disabled 时点击不触发 onClick', () => {
    // Given: 导入事务期间被禁用的「恢复为原生标签组」
    const onClick = vi.fn();
    render(
      <RowActionButton
        icon={Icons.toNativeGroup}
        label="恢复为原生标签组"
        disabled
        onClick={onClick}
      />
    );

    // When: 用户仍然点了它（原生 disabled 不吃 click，但 React 的 onClick 也不该跑）
    fireEvent.click(screen.getByRole('button', { name: '恢复为原生标签组' }));

    // Then: 无副作用
    expect(screen.getByRole('button', { name: '恢复为原生标签组' })).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('danger 走 .is-danger 唯一入口，ariaExpanded 透传给 disclosure 按钮', () => {
    // Given: 一个危险态的关闭按钮 + 一个展开态开关
    render(
      <>
        <RowActionButton icon={Icons.close} label="关闭标签" danger />
        <RowActionButton icon={Icons.chevron} label="展开详情" ariaExpanded />
      </>
    );

    // When: 取到两个按钮
    const close = screen.getByRole('button', { name: '关闭标签' });
    const disclosure = screen.getByRole('button', { name: '展开详情' });

    // Then: 危险态挂 CSS 钩子；展开态播报 aria-expanded
    expect(close.classList.contains('is-danger')).toBe(true);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  });

  it('自定义图标节点（会旋转的折叠箭头）取代默认 icon', () => {
    // Given: 快照行的展开开关，图标随展开态旋转
    render(
      <RowActionButton label="查看快照内标签" onClick={() => undefined}>
        <CollapseChevron collapsed={false} className="h-4 w-4" />
      </RowActionButton>
    );

    // When: 按钮内渲染的是 CollapseChevron
    const button = screen.getByRole('button', { name: '查看快照内标签' });

    // Then: 只有一个 svg，且带展开方向的旋转类
    const svg = button.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('class')).toContain('rotate-90');
  });
});

describe('Chip', () => {
  it('纯展示时是 span，不给它按钮语义', () => {
    // Given: 一个状态徽章
    render(<Chip cjk>已存在</Chip>);

    // When: 查按钮角色
    // Then: 没有按钮，文本仍在
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('已存在')).toBeInTheDocument();
  });

  it('传 onClick 即渲染为可点按钮（可访问名由可见文字承载）', () => {
    // Given: 「不再显示」这类可点徽章
    const onClick = vi.fn();
    render(
      <Chip cjk onClick={onClick}>
        不再显示
      </Chip>
    );

    // When: 点击
    fireEvent.click(screen.getByRole('button', { name: '不再显示' }));

    // Then: 回调触发
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('label 同时给 title 与 aria-label（无可见文字的图标徽章）', () => {
    // Given: 只有图标的休眠徽章
    render(<Chip label="已休眠（点击唤醒）" />);

    // When: 按可访问名查
    // Then: 鼠标与读屏两条路都通
    const badge = screen.getByLabelText('已休眠（点击唤醒）');
    expect(badge).toHaveAttribute('title', '已休眠（点击唤醒）');
  });

  it('tone 是徽章配色的唯一口径（前景/背景组合一次给定）', () => {
    // Given: 四种色调
    const { container } = render(
      <>
        <Chip tone="neutral">中性</Chip>
        <Chip tone="accent">强调</Chip>
        <Chip tone="warn">警示</Chip>
        <Chip tone="brand">品牌</Chip>
      </>
    );

    // When: 取四个徽章的 class
    const classes = [...container.querySelectorAll('span')].map((el) => el.className);

    // Then: 每档一套前景/背景，且不出现第二处手写配色
    expect(classes[0]).toContain('bg-gray-100 text-gray-600');
    expect(classes[1]).toContain('bg-accent-100 text-accent-700');
    expect(classes[2]).toContain('bg-warn-100 text-warn-700');
    expect(classes[3]).toContain('bg-accent-50 text-accent-700');
  });
});

describe('Checkbox', () => {
  it('勾选变化以布尔值上报，且可访问名来自 ariaLabel', () => {
    // Given: 快照详情里的条目勾选框
    const onChange = vi.fn();
    render(<Checkbox checked={false} ariaLabel="示例页面" onChange={onChange} />);

    // When: 点击勾选
    fireEvent.click(screen.getByRole('checkbox', { name: '示例页面' }));

    // Then: 上报 true
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('disabled 落到原生 disabled（禁用的交互门闩由浏览器守住）', () => {
    // Given: 禁用的勾选框
    render(<Checkbox checked ariaLabel="示例页面" disabled onChange={() => undefined} />);

    // When: 取勾选框
    const box = screen.getByRole('checkbox', { name: '示例页面' });

    // Then: 带原生 disabled（真实浏览器据此拦截点击与 change；
    //       jsdom 的 fireEvent 是直接派发、会绕过这道门闩，故此处不断言回调）
    expect(box).toBeDisabled();
  });

  it('id 取外层 ControlIdContext（设置页 Row 下发，供 label for 关联）', () => {
    // Given: 外层下发了控件 id
    render(
      <ControlIdContext.Provider value="setting-row-1">
        <Checkbox checked={false} onChange={() => undefined} />
      </ControlIdContext.Provider>
    );

    // When: 取勾选框
    // Then: 与下发的 id 一致
    expect(screen.getByRole('checkbox')).toHaveAttribute('id', 'setting-row-1');
  });
});

describe('ColorSwatchGroup', () => {
  const options = [
    { value: 'forest', label: '石墨绿', hex: '#347554' },
    { value: 'ocean', label: '雾霾蓝', hex: '#3a6ea8' }
  ];

  it('是具名 radiogroup，组内只有一个 radio 被选中', () => {
    // Given: 主题色板，当前选中 forest
    render(
      <ColorSwatchGroup
        label="主题色"
        value="forest"
        options={options}
        onSelect={() => undefined}
      />
    );

    // When: 取组与选项
    const group = screen.getByRole('radiogroup', { name: '主题色' });
    const radios = screen.getAllByRole('radio');

    // Then: 两个选项，选中态互斥
    expect(group).toBeInTheDocument();
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(radios[1]).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: '石墨绿' })).toBe(radios[0]);
  });

  it('点击色块上报新色号', () => {
    // Given: 主题色板
    const onSelect = vi.fn();
    render(
      <ColorSwatchGroup label="主题色" value="forest" options={options} onSelect={onSelect} />
    );

    // When: 点第二个色块
    fireEvent.click(screen.getByRole('radio', { name: '雾霾蓝' }));

    // Then: 上报 ocean
    expect(onSelect).toHaveBeenCalledWith('ocean');
  });

  it('色值以 --swatch 变量注入，不在内联样式里写字面色值', () => {
    // Given: 主题色板
    render(
      <ColorSwatchGroup
        label="主题色"
        value="forest"
        options={options}
        onSelect={() => undefined}
      />
    );

    // When: 看第一个色块的行内样式
    const style = screen.getByRole('radio', { name: '石墨绿' }).getAttribute('style') ?? '';

    // Then: 只有变量注入，没有 backgroundColor 字面色值
    expect(style).toContain('--swatch');
    expect(style).not.toMatch(/background-color/i);
  });

  it('roving tabindex：整组只有一个 Tab 停靠点（选中项）', () => {
    // Given: 当前选中 forest
    render(
      <ColorSwatchGroup
        label="主题色"
        value="forest"
        options={options}
        onSelect={() => undefined}
      />
    );

    // When: 取两个 radio
    const radios = screen.getAllByRole('radio');

    // Then: 选中项 tabIndex=0，其余 -1（键盘用户不被逐个色块绊住）
    expect(radios[0]).toHaveAttribute('tabindex', '0');
    expect(radios[1]).toHaveAttribute('tabindex', '-1');
  });

  it('方向键漫游：ArrowRight 选中下一项并把焦点移过去', () => {
    // Given: 当前选中 forest，聚焦第一个色块
    const onSelect = vi.fn();
    render(
      <ColorSwatchGroup label="主题色" value="forest" options={options} onSelect={onSelect} />
    );
    const radios = screen.getAllByRole('radio');
    radios[0]!.focus();

    // When: 按右方向键
    fireEvent.keyDown(radios[0]!, { key: 'ArrowRight' });

    // Then: 上报 ocean，焦点跟随到第二个色块（radio 惯例：方向键即选并移动焦点）
    expect(onSelect).toHaveBeenCalledWith('ocean');
    expect(document.activeElement).toBe(radios[1]);
  });

  it('Home/End 跳首尾，不循环', () => {
    // Given: 三个色号，聚焦中间项
    const three = [...options, { value: 'violet', label: '暮山紫', hex: '#6f4ba6' }];
    const onSelect = vi.fn();
    render(<ColorSwatchGroup label="主题色" value="ocean" options={three} onSelect={onSelect} />);
    const radios = screen.getAllByRole('radio');
    radios[1]!.focus();

    // When: End → 末项；Home → 首项
    fireEvent.keyDown(radios[1]!, { key: 'End' });
    expect(onSelect).toHaveBeenLastCalledWith('violet');
    expect(document.activeElement).toBe(radios[2]);

    fireEvent.keyDown(radios[2]!, { key: 'Home' });
    expect(onSelect).toHaveBeenLastCalledWith('forest');
    expect(document.activeElement).toBe(radios[0]);
  });
});

describe('StatusBadges 休眠徽章可访问名', () => {
  const discardedTab = { discarded: true } as TabRecord;

  it('已休眠徽章用 sr-only 文本承载可访问名（span 的 aria-label 在 generic role 上无效）', () => {
    // Given: 一个已休眠标签
    const { container } = render(
      <StatusBadges tab={discardedTab} duplicateCount={0} isSplitCompanion={false} />
    );

    // When: 找 sr-only 文案
    // Then: 存在稳定可读的文本节点，且雪花图标本身 aria-hidden（不重复播报）
    const srOnly = container.querySelector('.sr-only');
    expect(srOnly).not.toBeNull();
    // 测试环境 i18n 默认语言为 en，用 translate 取当前语言的译文再比对。
    expect(srOnly?.textContent).toBe(translate('已休眠（点击唤醒）'));
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('与其他状态徽章同构：休眠雪花也是 chip，不是裸图标', () => {
    // Given: 已休眠标签
    const { container } = render(
      <StatusBadges tab={discardedTab} duplicateCount={0} isSplitCompanion={false} />
    );

    // When: 查 chip 语义类
    // Then: 存在 .chip 包裹（并列徽章高度/度量一致）
    expect(container.querySelector('.chip')).not.toBeNull();
  });
});

describe('CollapseChevron', () => {
  it('收起态不旋转，展开态转 90°（方向只由 collapsed 一处决定）', () => {
    // Given: 同一支箭头的两种状态（图标是 aria-hidden，按标签查询）
    const { container } = render(
      <>
        <span data-testid="collapsed">
          <CollapseChevron collapsed />
        </span>
        <span data-testid="expanded">
          <CollapseChevron collapsed={false} />
        </span>
      </>
    );

    // When: 取两个箭头
    const collapsedSvg = container.querySelector('[data-testid="collapsed"] svg');
    const expandedSvg = container.querySelector('[data-testid="expanded"] svg');

    // Then: 收起朝右、展开朝下
    expect(collapsedSvg?.getAttribute('class')).not.toContain('rotate-90');
    expect(expandedSvg?.getAttribute('class')).toContain('rotate-90');
  });
});

describe('RowItem 密度档位', () => {
  const renderRow = (density?: 'tight' | 'compact' | 'cozy' | 'large') =>
    render(<RowItem faviconTitle="示例" title="示例标签" density={density} />);

  it('超紧凑 / 宽松 / 大字号各落到自己的语义类', () => {
    const { container, rerender } = renderRow('tight');
    expect(container.querySelector('.row-item')).toHaveClass('density-tight');

    rerender(<RowItem faviconTitle="示例" title="示例标签" density="cozy" />);
    expect(container.querySelector('.row-item')).toHaveClass('density-cozy');

    rerender(<RowItem faviconTitle="示例" title="示例标签" density="large" />);
    expect(container.querySelector('.row-item')).toHaveClass('density-large');
  });

  it('compact 是基准档：不加任何 density-* 类（避免继承别的档位）', () => {
    const { container } = renderRow('compact');
    const row = container.querySelector('.row-item');
    expect(row).not.toHaveClass('density-tight');
    expect(row).not.toHaveClass('density-cozy');
    expect(row).not.toHaveClass('density-large');
  });
});
