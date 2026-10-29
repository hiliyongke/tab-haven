/**
 * i18n-kit —— 写母语原文、自动出哈希 key 词典的 i18n 工具集。
 *
 * 运行时入口（零 React 依赖）：`import { createTranslate, toHashKey } from 'i18n-kit'`
 * React 入口：`import { Trans, Slot, createUseTranslation } from 'i18n-kit/react'`
 * 命令行：`i18n-kit scan | apply | check | lint`
 */

// 相对导入必须带 `.ts`：CLI 由 Node 直接加载 TS，原生 ESM 不做扩展名补全。
// 不导出 `collect.ts`：它依赖 `@babel/parser`（仅 CLI 侧需要），导出会把解析器拖进扩展包。
export { hashString, isHashKey, toHashKey } from './hashKey.ts';
export { createTranslate } from './translate.ts';
export type { I18nLike, Translate, TranslationOptions } from './translate.ts';
