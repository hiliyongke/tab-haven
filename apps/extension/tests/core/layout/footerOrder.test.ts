import { describe, expect, it } from 'vitest';
import {
  FOOTER_BUTTON_KEYS,
  FOOTER_ID_PREFIX,
  footerButtonId,
  normalizeFooterOrder,
  type FooterButtonKey
} from '@/core/layout/footerOrder';

/**
 * 底栏按钮顺序的补全与去重（`core/layout/footerOrder`）。
 *
 * 这条规则此前没有独立测试，而它是「版本升级新增按钮后老用户会不会丢按钮」的
 * 唯一保障：持久化顺序是**用户数据**，来自备份 / 旧版本都可能携带未知 id 或缺键，
 * 补不全就表现为「更新后某个按钮凭空消失」。
 */

const idOf = (key: FooterButtonKey): string => footerButtonId(key);

describe('footerButtonId', () => {
  it('带 footer: 前缀（与 tab:/folder:/pin: 的 sortable id 隔离）', () => {
    expect(footerButtonId('palette')).toBe('footer:palette');
    expect(FOOTER_ID_PREFIX).toBe('footer:');
  });
});

describe('normalizeFooterOrder', () => {
  it('Given 空持久化值 When 补全 Then 得到完整默认顺序', () => {
    expect(normalizeFooterOrder([])).toEqual([...FOOTER_BUTTON_KEYS]);
  });

  it('Given 自定义顺序 When 补全 Then 保留用户的相对顺序', () => {
    // 不能按默认顺序 filter —— 那会把用户的自定义顺序覆盖回默认顺序。
    const saved = [idOf('settings'), idOf('palette'), idOf('snapshot')];

    const order = normalizeFooterOrder(saved);

    expect(order.slice(0, 3)).toEqual(['settings', 'palette', 'snapshot']);
  });

  it('Given 缺键 When 补全 Then 缺失按钮按默认相对顺序追加到末尾', () => {
    const saved = [idOf('palette'), idOf('settings')];

    const order = normalizeFooterOrder(saved);

    expect(order).toHaveLength(FOOTER_BUTTON_KEYS.length);
    expect(order.slice(0, 2)).toEqual(['palette', 'settings']);
    // 追加段必须仍按默认顺序（否则新增按钮的位置每次升级都随机）
    expect(order.slice(2)).toEqual(
      FOOTER_BUTTON_KEYS.filter((key) => key !== 'palette' && key !== 'settings')
    );
  });

  it('Given 含未知 id When 补全 Then 丢弃未知项（旧版本 / 备份里的失效按钮）', () => {
    const order = normalizeFooterOrder(['footer:nonexistent', idOf('palette'), 'tab:123']);

    expect(order).not.toContain('nonexistent' as FooterButtonKey);
    expect(order[0]).toBe('palette');
    expect(order).toHaveLength(FOOTER_BUTTON_KEYS.length);
  });

  it('Given 含重复 id When 补全 Then 只保留第一次出现（重复按钮会渲染两个同名项）', () => {
    const order = normalizeFooterOrder([idOf('palette'), idOf('locate'), idOf('palette')]);

    expect(order.filter((key) => key === 'palette')).toHaveLength(1);
    expect(order.slice(0, 2)).toEqual(['palette', 'locate']);
  });

  it('Given 只给不带前缀的裸 key When 补全 Then 视为未知并全部走默认追加', () => {
    // 持久化值一律是带前缀的 id：裸 key 不是合法输入，不能悄悄接受
    // （否则「前缀」这条隔离约定会在导入旧备份时失效）。
    const order = normalizeFooterOrder(['palette']);

    expect(order).toEqual([...FOOTER_BUTTON_KEYS]);
  });

  it('结果始终恰好覆盖全部按钮键（不多不少）', () => {
    const order = normalizeFooterOrder([idOf('about'), 'footer:ghost', idOf('about')]);

    expect(new Set(order).size).toBe(FOOTER_BUTTON_KEYS.length);
    for (const key of FOOTER_BUTTON_KEYS) expect(order).toContain(key);
  });
});
