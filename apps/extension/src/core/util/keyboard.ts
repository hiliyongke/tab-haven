/**
 * 输入法（IME）组合态判定。
 *
 * 中文/日文输入法在组合期间会先收到 Enter（选词）、Esc（取消候选）等按键，
 * 此时 `event.isComposing === true`（部分浏览器只在 `keyCode === 229` 上暴露）。
 * 这些按键属于**输入法**的操作，不是「提交 / 关闭」：
 *
 * - 快照命名框里按 Enter 选词 → 会顺手把快照保存掉（名字还是半截拼音）；
 * - 重命名弹窗里按 Enter 选词 → 会提交一个未输完的名字；
 * - 弹窗 / 搜索框里按 Esc 取消候选 → 会把整个弹窗关掉、搜索清空。
 *
 * 因此所有「Enter 提交 / Esc 关闭」的处理器都必须先过这道闸门。
 * 兼容两种事件对象：原生 KeyboardEvent 与 React 的 SyntheticEvent（组合标志在
 * `nativeEvent` 上）。
 */
type ComposableKeyEvent = {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
};

export function isImeComposing(event: ComposableKeyEvent): boolean {
  return (
    event.isComposing === true || event.nativeEvent?.isComposing === true || event.keyCode === 229
  );
}
