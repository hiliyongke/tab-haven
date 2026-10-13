import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectSentences } from '../collect.ts';
import { dictFile, readJson, type KitPaths } from '../paths.ts';

/**
 * 一次性迁移：把既有的语义化点号 key 词条转成哈希 key 词典。
 *
 * 分流规则（决定每条既有词条的归宿）：
 *   - 原文能在源码里扫到（`t('编辑标签组')` 写法）→ 哈希 key 条目，进
 *     `i18n/source/<nativeLng>.json` + `i18n/translation/<lng>.json`；
 *   - 扫不到（源码里仍是 `t('groups.color.grey')` 这类语义 key 调用，多由动态拼接
 *     造成）→ 原样进 `i18n/legacy/`，运行时走语义 key 直通，行为不变。
 *
 * 为什么保留 legacy 而不是强行哈希：动态拼接的 key 在源码里没有完整字面量，静态扫描
 * 原理上拿不到，硬转只会让这些文案在英文模式里露中文。留着、可见、可逐批收敛。
 */

/** 递归展开嵌套词条为点号键路径（兼容旧词条文件的对象嵌套写法）。 */
export function flattenEntries(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      Object.assign(out, flattenEntries(value as Record<string, unknown>, path));
    } else if (typeof value === 'string') {
      out[path] = value;
    }
  }
  return out;
}

export interface MigrateOptions {
  dry?: boolean;
  /** 既有母语词条（默认读运行时资源目录下的母语文件） */
  nativeEntries?: Record<string, unknown>;
  /** 既有译文（键与母语一致） */
  translatedEntries?: Record<string, Record<string, unknown>>;
}

export interface MigrateResult {
  hashed: number;
  legacy: string[];
}

export function migrate(paths: KitPaths, options: MigrateOptions = {}): MigrateResult {
  const native =
    options.nativeEntries ?? readJson(join(paths.locales, paths.nativeLng, 'translation.json'));
  const nativeFlat = flattenEntries(native as Record<string, unknown>);

  const { entries } = collectSentences(paths.src, paths.root);
  /** 母语原文 → 哈希 key（扫描器算出的映射，迁移必须与之完全一致）。 */
  const keyBySentence = new Map<string, string>();
  for (const entry of entries) {
    if (!keyBySentence.has(entry.sentence)) keyBySentence.set(entry.sentence, entry.key);
  }

  const source = readJson(dictFile.source(paths));
  const legacyNative = readJson(dictFile.legacy(paths, paths.nativeLng));
  const legacy: string[] = [];

  for (const lng of paths.lngs) {
    const translatedRaw =
      options.translatedEntries?.[lng] ?? readJson(join(paths.locales, lng, 'translation.json'));
    const translatedFlat = flattenEntries(translatedRaw as Record<string, unknown>);
    const translation = readJson(dictFile.translation(paths, lng));
    const legacyLng = readJson(dictFile.legacy(paths, lng));

    for (const [key, sentence] of Object.entries(nativeFlat)) {
      const hashKey = keyBySentence.get(sentence);
      const translatedValue = translatedFlat[key];
      if (hashKey === undefined) {
        legacyNative[key] = sentence;
        // 缺译时**不写**该 key（见下方同款说明）：legacy 也会进运行时词条，
        // 写空串等于让界面那一片变空白。
        if (typeof translatedValue === 'string' && translatedValue !== '') {
          legacyLng[key] = translatedValue;
        }
        if (lng === paths.lngs[0]) legacy.push(key);
        continue;
      }
      source[hashKey] = sentence;
      /**
       * 译文缺失时**不写**该 key，而不是写空串。
       *
       * 空串会被 apply 原样编译进运行时词条：命中它界面就渲染出一片空白 ——
       * 比「露中文」更糟，用户连「哪里没译」都看不出来，也无法凭界面自查。
       * 不写的话运行时按 defaultValue 回退母语原文，而守卫规则 4 用
       * `typeof value !== 'string'` 同样把它判成「未翻译」，两类问题不会混淆。
       */
      if (typeof translatedValue === 'string' && translatedValue !== '') {
        translation[hashKey] = translatedValue;
      }
    }

    if (!options.dry) {
      mkdirSync(join(paths.dict, 'translation'), { recursive: true });
      mkdirSync(join(paths.dict, 'legacy'), { recursive: true });
      writeFileSync(
        dictFile.translation(paths, lng),
        `${JSON.stringify(translation, null, 2)}\n`,
        'utf8'
      );
      writeFileSync(dictFile.legacy(paths, lng), `${JSON.stringify(legacyLng, null, 2)}\n`, 'utf8');
    }
  }

  if (!options.dry) {
    mkdirSync(join(paths.dict, 'source'), { recursive: true });
    writeFileSync(dictFile.source(paths), `${JSON.stringify(source, null, 2)}\n`, 'utf8');
    writeFileSync(
      dictFile.legacy(paths, paths.nativeLng),
      `${JSON.stringify(legacyNative, null, 2)}\n`,
      'utf8'
    );
  }

  return { hashed: Object.keys(source).length, legacy };
}
