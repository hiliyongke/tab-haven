import { Children, isValidElement, type ReactNode } from 'react';
import {
  Trans as ReactTrans,
  useTranslation as useReactTranslation,
  type TransProps
} from 'react-i18next';
import { toHashKey } from './hashKey.ts';
import type { I18nLike, Translate } from './translate.ts';

/**
 * React 侧入口：整句翻译组件与 `useTranslation` 工厂。
 */

/**
 * `<Trans>` 的插值插槽。
 *
 * 插槽内的内容不参与原文串化（否则同一句会随变量值算出不同 key），只占一个位置。
 */
export function Slot({ content }: { content: ReactNode }): ReactNode {
  return <>{content}</>;
}

/**
 * 子节点串化：文本原样拼接，其余按**同层序号**写成 `<0></0>`。
 *
 * 与扫描器 `collect.ts` 的 `jsxChildrenToString` 必须同口径（序号按过滤掉空白文本
 * 后的数组计算），否则扫出来的 key 与运行时算出的 key 不同，表现为「英文模式下
 * 这一句始终是中文」且极难定位。
 */
export function nodesToString(children: ReactNode): string {
  let out = '';
  Children.toArray(children).forEach((child, index) => {
    if (typeof child === 'string') {
      out += child;
      return;
    }
    if (isValidElement(child)) {
      const inner = nodesToString((child.props as { children?: ReactNode }).children ?? null);
      out += inner === '' ? `<${index}></${index}>` : `<${index}>${inner}</${index}>`;
      return;
    }
    out += `<${index}></${index}>`;
  });
  return out;
}

export type TransComponentProps = Omit<TransProps<'translation'>, 'i18nKey' | 'defaults'> & {
  /** 上下文：参与 key 计算，必须是字符串常量 */
  context?: string;
};

/**
 * 带插值的整句翻译。
 *
 * 为什么需要它：`t()` 只接受**完整句子**，而「已选 {{count}} 个标签」这类文案中间
 * 夹着变量或组件，写成拼接就无法被静态扫描（运行时原文随变量变化，key 算不出来）。
 * `Trans` 把整段 JSX 作为一句原文，变量以占位符 `<0></0>` 参与串化，key 因此稳定。
 */
export function Trans({ children, context, ...rest }: TransComponentProps): ReactNode {
  // 归一化（多个空白折成一个）与扫描器同口径：源码折行不代表文案有换行。
  const defaultValue = nodesToString(children).replace(/\s+/g, ' ').trim();
  return (
    <ReactTrans i18nKey={toHashKey(defaultValue, context)} defaults={defaultValue} {...rest}>
      {children}
    </ReactTrans>
  );
}

/**
 * 生成组件侧的 `useTranslation`。
 *
 * 包一层 react-i18next 的 `useTranslation`：语言切换时的重渲染订阅仍由它负责，
 * 而返回的 `t` 换成传入的 `translate`，这样组件里只写中文原文即可。
 */
export function createUseTranslation<I18n extends I18nLike>(i18n: I18n, translate: Translate) {
  return function useTranslation(): { t: Translate; i18n: I18n; ready: boolean } {
    const { i18n: instance, ready } = useReactTranslation();
    /**
     * 按**能力**判定而不是按真值判定。
     *
     * react-i18next 在拿不到实例时返回的是 `i18n || {}` —— 空对象是真值，
     * 会让 `instance ?? i18n` 这条兜底失效：调用方拿到 `{}` 后一碰
     * `changeLanguage` 就整棵树崩（依赖被打包成两份时必然走到这一支）。
     * 因此这里确认过实例真的带方法才用它，否则一律回落到调用方传入的实例。
     */
    const usable =
      typeof (instance as { changeLanguage?: unknown } | undefined | null)?.changeLanguage ===
      'function'
        ? (instance as unknown as I18n)
        : i18n;
    // 泛型保留调用方实例的完整类型（`i18n.changeLanguage` 等仍可用），
    // 而不是退化成只有 t() 的最小接口。
    return { t: translate, i18n: usable, ready };
  };
}
