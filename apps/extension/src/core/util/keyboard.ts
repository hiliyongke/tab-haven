/**
 * 输入法（IME）组合态判定：组合期间的 Enter（选词）、Esc（取消候选）属输入法而非「提交 / 关闭」，
 * 所有「Enter 提交 / Esc 关闭」处理器须先过此闸门（否则误提交/误关弹窗）；兼容原生 KeyboardEvent 与 React SyntheticEvent（标志在 `nativeEvent`）。
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
