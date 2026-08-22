import { toHashKey } from './hashKey.ts';

/**
 * 查表逻辑（UI 轨道与后台轨道共用）。
 *
 * 单列一份的原因：两条轨道（React 侧与后台 SW 侧）用的是同一套词条，若各写一遍
 * `t()`，任何一处口径漂移都会表现为「面板是英文、右键菜单却是中文」——这类不一致
 * 只有双语用户会遇到，且极难复现。
 */

/** 是否含汉字：区分「母语原文」与「非原文的 key」，两者查表路径不同。 */
const HAS_HAN = /\p{Script=Han}/u;

/**
 * 翻译选项。
 *
 * `context` 参与 key 计算，因此**必须是字符串常量**：变量无法被静态扫描，
 * 扫不到的词条运行时必然查不到（英文模式露中文）。
 */
export interface TranslationOptions {
  /** 上下文，参与哈希 key */
  context?: string;
  /** 单复数判定数量 */
  count?: number;
  /** 插值与 i18next 其它选项 */
  [key: string]: unknown;
}

/** 只取用到的 i18next 能力，便于单测注入假实例。 */
export interface I18nLike {
  t(key: string, options?: Record<string, unknown>): unknown;
}

export type Translate = (sentence: string, options?: TranslationOptions) => string;

/**
 * 生成翻译函数。
 *
 * 两条查表路径：
 *  1. **含汉字** → 按原文算哈希 key 查词典，未命中回退原文（defaultValue）；
 *  2. **不含汉字** → 原样当 key 查表（语义 key 直通）。
 */
export function createTranslate(i18n: I18nLike): Translate {
  return (sentence, options) => {
    if (!HAS_HAN.test(sentence))
      return String(i18n.t(sentence, options as Record<string, unknown>));
    const key = toHashKey(sentence, options?.context);
    // defaultValue 是刻意的兜底：未登记文案在英文模式返回中文原文而不是空串——
    // 「露中文」比「什么都不显示」更容易被发现，且不会让界面崩掉。
    return String(i18n.t(key, { ...options, defaultValue: sentence }));
  };
}
