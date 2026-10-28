import { describe, expect, it } from 'vitest';
import { isImeComposing } from '@/core/util/keyboard';

/**
 * 输入法组合态判定。
 *
 * 这条闸门保护四类交互：搜索框的 ↑↓/Enter（漫游与激活）、弹窗的 Esc（关闭）、
 * 命名框的 Enter（保存）。组合态误判的代价不是「少一个快捷键」，而是中文用户
 * 打一个词就被提交/跳走，且候选框被抢掉方向键。
 */
describe('isImeComposing', () => {
  it('原生事件的 isComposing 为真时判定为组合中', () => {
    expect(isImeComposing({ isComposing: true })).toBe(true);
  });

  it('React 合成事件从 nativeEvent 读组合标志', () => {
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true);
  });

  it('只暴露 keyCode 229 的浏览器同样识别为组合中', () => {
    expect(isImeComposing({ keyCode: 229 })).toBe(true);
  });

  it('普通按键不误判（三种形态的假值都返回 false）', () => {
    expect(isImeComposing({})).toBe(false);
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
    expect(isImeComposing({ nativeEvent: { isComposing: false } })).toBe(false);
  });
});
