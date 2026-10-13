/**
 * i18n-kit —— 写母语原文、自动出哈希 key 词典的 i18n 工具集。
 *
 * 开发体验：源码里只写中文（`t('编辑标签组')`），扫描器负责抽出词条、编译运行时资源、
 * 守卫未登记与未翻译；译文走本地文件流转（本工具集不发起任何网络请求）。
 *
 * 运行时入口（零 React 依赖）：
 *   import { createTranslate, toHashKey } from 'i18n-kit';
 * React 入口（`Trans` / `Slot` / `useTranslation`）：
 *   import { Trans, Slot, createUseTranslation } from 'i18n-kit/react';
 * 命令行：
 *   i18n-kit scan | apply | check | lint | migrate
 */

// 相对导入一律带 `.ts` 后缀：CLI 直接由 Node 加载 TS（类型剥离），
// 原生 ESM 不做扩展名补全。
//
// 只导出运行时真正用到的东西：`collect.ts` 依赖 `@babel/parser`（仅 CLI 侧需要），
// 从本入口导出会把解析器拖进扩展包 —— 运行时用不到，且让 `@babel/parser` 在
// 依赖树里表现为运行时依赖。需要扫描能力就走 `i18n-kit/node`。
export { hashString, isHashKey, toHashKey } from './hashKey.ts';
export { createTranslate } from './translate.ts';
export type { I18nLike, Translate, TranslationOptions } from './translate.ts';
