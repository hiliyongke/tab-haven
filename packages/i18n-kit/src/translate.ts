import { toHashKey } from './hashKey.ts';

/** 查表逻辑，UI 轨道与后台轨道共用：两处各写一遍必然漂移，表现为「面板英文、右键菜单中文」。 */

/** 是否含汉字：区分「母语原文」与「非原文的 key」，两者查表路径不同。 */
const HAS_HAN = /\p{Script=Han}/u;

export interface TranslationOptions {
  /** 上下文，参与哈希 key，必须字符串常量（变量无法被静态扫描，扫不到的词条运行时查不到） */
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
 * 生成翻译函数：含汉字 → 按原文算哈希 key 查表；不含汉字 → 原样当 key 直通。
 */
export function createTranslate(i18n: I18nLike): Translate {
  return (sentence, options) => {
    if (!HAS_HAN.test(sentence))
      return String(i18n.t(sentence, options as Record<string, unknown>));
    const key = toHashKey(sentence, options?.context);
    // defaultValue 是刻意的兜底：未登记文案返回中文原文而非空串——「露中文」比空白更易被发现。
    return String(i18n.t(key, { ...options, defaultValue: sentence }));
  };
}
