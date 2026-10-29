import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { createTranslate, isHashKey, toHashKey } from 'i18n-kit';
import zhCN from '@/i18n/locales/zh-CN/translation.json';
import en from '@/i18n/locales/en/translation.json';
import source from '../../../i18n/source/zh-CN.json';

/**
 * 运行时文案解析行为规格：中文模式保留中文原文，英文模式解析为译文；
 * URL 原文不被分隔符截断，运行时词条使用哈希 key。
 */

function createInstance(lng: 'zh-CN' | 'en'): ReturnType<typeof i18next.createInstance> {
  const instance = i18next.createInstance();
  void instance.init({
    lng,
    // 与 UI 轨道一致（wxt.config.ts 的 default_locale 为 en）
    fallbackLng: 'en',
    nsSeparator: false,
    keySeparator: false,
    resources: {
      'zh-CN': { translation: zhCN },
      en: { translation: en }
    },
    interpolation: { escapeValue: false }
  });
  return instance;
}

/**
 * 允许英文模式返回中文的例外：语言名须以该语言自身写法呈现
 * （与 `i18n-kit check` 的伪翻译豁免表同口径，改一处须改另一处）。
 */
const NATIVE_IN_EN_ALLOWED = new Set(['简体中文']);

/** JSON import 的类型是字面量对象，按字典用需显式收成 Record。 */
const sourceMap: Record<string, string> = source;

/** 全量母语原文（词典扫描产物）。 */
const sentences = Object.values(sourceMap);

/** 英文译文中的汉字占比阈值，用于识别整句未翻译的文案。 */
const HAN_RATIO_THRESHOLD = 0.3;
const hanRatio = (text: string): number => {
  const matched = text.match(/\p{Script=Han}/gu);
  return matched === null ? 0 : matched.length / text.length;
};

describe('运行时文案解析', () => {
  it('Given 词典每条原文，When 计算 key，Then 与扫描器产物完全一致', () => {
    const mismatched = sentences.filter((sentence) => sourceMap[toHashKey(sentence)] !== sentence);
    expect(mismatched).toEqual([]);
  });

  it('Given 中文模式，When 解析全部原文，Then 一律返回中文（不回退到英文）', () => {
    const t = createTranslate(createInstance('zh-CN'));
    const leaked = sentences.filter((sentence) => t(sentence) !== sentence);
    expect(leaked).toEqual([]);
  });

  it('Given 英文模式，When 解析全部原文，Then 一律返回英文（除语言名例外，不得残留汉字）', () => {
    const t = createTranslate(createInstance('en'));
    const leaked = sentences.filter((sentence) => {
      if (NATIVE_IN_EN_ALLOWED.has(sentence)) return false;
      const resolved = t(sentence);
      return resolved === sentence || hanRatio(resolved) > HAN_RATIO_THRESHOLD;
    });
    // 一次性列出全部：逐条断言只会报第一条就停
    expect(leaked).toEqual([]);
  });

  it('Given 含 URL 的原文，When 英文模式解析，Then 不被分隔符截断', () => {
    const t = createTranslate(createInstance('en'));
    const sample = sentences.find((sentence) => sentence.includes('https://'));
    expect(sample).toBeDefined();
    const resolved = t(sample as string);
    expect(resolved.startsWith('//')).toBe(false);
  });

  it('Given 未登记的中文原文，When 英文模式解析，Then 返回原文', () => {
    const t = createTranslate(createInstance('en'));
    // 未登记的原文保留中文，供 check:i18n 识别。
    expect(t('这条中文原文从未在任何词条里登记过')).toBe('这条中文原文从未在任何词条里登记过');
  });

  it('Given 运行时词条，When 检查键的格式，Then 全部是哈希 key', () => {
    const legacy = Object.keys(zhCN).filter((key) => !isHashKey(key));
    expect(legacy).toEqual([]);
  });

  it('两条语言轨道的 init 配置与真实源码同口径（防止本测试与生产配置漂移）', () => {
    const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
    for (const file of ['src/i18n/index.ts', 'src/i18n/headless.ts']) {
      expect(read(file)).toContain('nsSeparator: false');
      expect(read(file)).toContain('keySeparator: false');
      expect(read(file)).toContain("fallbackLng: 'en'");
    }
  });
});
