import { createContext, useContext } from 'react';

/**
 * 表单控件可访问 id：由外层容器（设置页 `Row`）用 `useId()` 生成并下发。
 *
 * 设置页 label 与控件是兄弟节点，只写 `aria-label` 的话点击标签不聚焦控件、且文案有两份。
 * `htmlFor` + `id` 才是正解，而 children 是 ReactNode 无法注入属性，故用 context 下发。
 *
 * 控件侧：`id={useControlId(id)}`，显式传入优先（弹窗等自带 id 的场景）。
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
