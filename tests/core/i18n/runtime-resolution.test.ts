import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { createTranslate, isHashKey, toHashKey } from 'i18n-kit';
import zhCN from '@/i18n/locales/zh-CN/translation.json';
import en from '@/i18n/locales/en/translation.json';
import source from '../../../i18n/source/zh-CN.json';

/**
 * 运行时解析回归：两条语言轨道都必须让 `t('中文原文')` 命中译文。
 *
 * 覆盖四类历史事故：
 *  1. 词典漏登记 → 英文模式直接露中文；
 *  2. 未关 `nsSeparator` / `keySeparator` → 含 `https://` 的原文被按 ':' 或 '.'
 *     切碎，英文模式渲染出截断的 URL（抽样查不出，故**全量**遍历）；
 *  3. 哈希 key 与扫描器不同源 → 整批词条命中不到；
 *  4. 迁移期遗留的语义 key（动态拼接）被新逻辑挡掉 → 旧文案整片失效。
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
 * （与 scripts/i18n/check.mjs 的豁免表同口径，改一处须改另一处）。
 */
const NATIVE_IN_EN_ALLOWED = new Set(['简体中文']);

/** JSON import 的类型是字面量对象，按字典用需显式收成 Record。 */
const sourceMap: Record<string, string> = source;

/** 全量母语原文（词典扫描产物）。 */
const sentences = Object.values(sourceMap);

/** 汉字占比：整句没译才算事故，句中保留中文专有名词属正常。 */
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

  it('Given 未登记的中文原文，When 英文模式解析，Then 露出中文（故必须靠 check:i18n 拦截）', () => {
    const t = createTranslate(createInstance('en'));
    // 负控：证明「未登记」确实是事故而不是被兜底掩盖
    expect(t('这条中文原文从未在任何词条里登记过')).toBe('这条中文原文从未在任何词条里登记过');
  });

  it('Given 全量迁移已完成，When 检查运行时词条，Then 键全部是哈希 key（无遗留语义 key）', () => {
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
