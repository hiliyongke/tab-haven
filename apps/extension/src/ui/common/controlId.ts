import { createContext, useContext } from 'react';

/**
 * 表单控件的可访问 id：由外层容器（设置页 `Row`）用 `useId()` 生成并下发。
 *
 * 为什么需要它：设置页的 label 与控件是**兄弟**节点（左标签 / 右控件），
 * 天然没有关联。只给控件写 `aria-label` 时读屏能念出名字，但
 *  - 点击标签文本不会聚焦控件（鼠标用户的点击区只有控件本体）；
 *  - 视觉标签与程序化标签两份文案，改一处会漏另一处。
 * `htmlFor` + `id` 才是正解，而 children 是 `ReactNode`、无法注入属性，
 * 故用 context 下发。
 *
 * 控件侧约定：`id={useControlId(id)}`，显式传入优先（弹窗等自带 id 的场景）。
 */
export const ControlIdContext = createContext<string | undefined>(undefined);

/**
 * 取控件 id：显式 prop 优先，否则取外层容器下发的。
 * useContext 无条件调用（`explicit ?? useContext(…)` 会被 rules-of-hooks 判为条件调用）。
 */
export function useControlId(explicit?: string): string | undefined {
  const fromContext = useContext(ControlIdContext);
  return explicit ?? fromContext;
}
