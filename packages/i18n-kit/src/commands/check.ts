import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectSentences, walk } from '../collect.ts';
import { dictFile, readJson, type KitPaths } from '../paths.ts';

/**
 * 文案守卫。
 *
 * 守住六条（任一不满足即失败）：
 *   1. **产物已编译**：运行时词条文件必须与词典一致——改了词典没跑 apply，界面上
 *      仍是旧文案，而代码看不出问题；
 *   2. **无孤立译文**：译文文件里不得有词典中不存在的 key（改文案后残留的废译文）；
 *   3. **无未登记原文**：源码里 `t('中文')` 的原文必须已在词典里——未登记即
 *      **英文模式直接露中文**，这正是本守卫存在的核心理由；
 *   4. **无未翻译**：译文不得为空、不得与母语原文相同、不得汉字占比过高；
 *   5. **遗留语义 key 仍在使用**：`i18n/legacy/` 里的 key 必须还能在源码里找到，
 *      防止遗留池无限膨胀；
 *   6. **白名单不过期**：豁免的原文若已消失，规则形同虚设。
 */

export interface CheckOptions {
  /** 允许译文为空串的母语原文（量词/语气词，目标语言语序不需要对应成分） */
  emptyAllowed?: string[];
  /** 允许译文与母语原文相同的原文（语言名须以该语言自身写法呈现） */
  sameAsNativeAllowed?: string[];
  /** 动态拼接的语义 key 固定豁免（源码无完整字面量） */
  dynamicKeys?: string[];
  /** 动态拼接的语义 key 模式豁免 */
  dynamicKeyPatterns?: RegExp[];
}

export interface CheckResult {
  issues: string[];
  stats: {
    total: number;
    translated: number;
    pending: number;
    exempt: number;
    unregistered: number;
    legacy: number;
  };
  /** 未翻译明细：key → { 原文, 当前译文, 原因 } */
  untranslated: Record<string, { sentence: string; value: string; reason: string }>;
  unregisteredList: string[];
}

const HAS_ZH = /\p{Script=Han}/u;
const HAN_RATIO_THRESHOLD = 0.3;

const hanRatio = (text: string): number => {
  const matched = text.match(/\p{Script=Han}/gu);
  return matched === null ? 0 : matched.length / text.length;
};

export function check(paths: KitPaths, options: CheckOptions = {}): CheckResult {
  const emptyAllowed = options.emptyAllowed ?? [];
  const sameAsNativeAllowed = options.sameAsNativeAllowed ?? [];
  const dynamicKeys = options.dynamicKeys ?? [];
  const dynamicKeyPatterns = options.dynamicKeyPatterns ?? [];

  const source = readJson(dictFile.source(paths));
  const legacyNative = readJson(dictFile.legacy(paths, paths.nativeLng));
  const issues: string[] = [];

  /**
   * 词典为空而运行时词条非空 = 词典路径配错（或词典被清空）。
   *
   * 此时下面规则 2/3/4 全部无据可依（孤立译文、未登记、未翻译都拿空集去比），
   * 结果必然是 0 问题 → 守卫退出 0。一个「查不出任何问题」的守卫比没有守卫更危险：
   * 它会让整包文案在 CI 上持续变绿，直到英文用户看到满屏中文。
   */
  const localeNative = readJson(join(paths.locales, paths.nativeLng, 'translation.json'));
  if (Object.keys(source).length === 0 && Object.keys(localeNative).length > 0) {
    issues.push(
      `词典为空或不存在（${dictFile.source(paths)}），但运行时词条已有 ${Object.keys(localeNative).length} 条 —— 词典路径多半配错，守卫无法据此判定，按失败处理`
    );
  }

  // 规则 1：产物已编译
  for (const lng of [paths.nativeLng, ...paths.lngs]) {
    const dictionary =
      lng === paths.nativeLng ? source : readJson(dictFile.translation(paths, lng));
    const legacy = readJson(dictFile.legacy(paths, lng));
    const expected = { ...legacy, ...dictionary };
    const actual = readJson(join(paths.locales, lng, 'translation.json'));

    const problems: string[] = [];
    for (const [key, value] of Object.entries(expected)) {
      if (actual[key] !== value) problems.push(key);
    }
    for (const key of Object.keys(actual)) {
      if (!(key in expected)) problems.push(key);
    }
    if (problems.length > 0) {
      issues.push(
        `${lng} 词条文件与词典不一致（${problems.length} 处，先跑 i18n-kit apply）: ${problems.slice(0, 5).join(', ')}${problems.length > 5 ? ' …' : ''}`
      );
    }
  }

  // 规则 2：无孤立译文
  for (const lng of paths.lngs) {
    const translated = readJson(dictFile.translation(paths, lng));
    const orphans = Object.keys(translated).filter((key) => !(key in source));
    if (orphans.length > 0) {
      issues.push(`孤立译文（${lng}，词典中已无该词条）: ${orphans.sort().join(', ')}`);
    }
  }

  // 规则 3：源码里的原文必须已登记
  const { entries, errors } = collectSentences(paths.src, paths.root, {
    keySuffixes: paths.keySuffixes
  });
  /**
   * 抽取本身的问题必须是失败项：解析失败、含插值的模板串、Trans 动态子节点、
   * 哈希碰撞 —— 这些在 `scan` 里都会拒绝落盘，若 `check` 里丢掉它们，就会出现
   * 「词典没更新、守卫却全绿」的组合（界面露中文而 CI 放行）。
   */
  if (errors.length > 0) {
    issues.push(`源码抽取存在问题（${errors.length} 处）:\n      ${errors.join('\n      ')}`);
  }
  const unregistered = new Map<string, string>();
  for (const entry of entries) {
    if (source[entry.key] === undefined) {
      unregistered.set(entry.key, `${entry.sentence}  ← ${entry.file}:${entry.line ?? '?'}`);
    }
  }
  if (unregistered.size > 0) {
    issues.push(
      `未登记文案（英文模式会露中文，先跑 i18n-kit scan）:\n      ${[...unregistered.values()].sort().join('\n      ')}`
    );
  }

  // 规则 4：无未翻译
  const untranslated: CheckResult['untranslated'] = {};
  for (const lng of paths.lngs) {
    const translated = readJson(dictFile.translation(paths, lng));
    for (const [key, sentence] of Object.entries(source)) {
      const value = translated[key];
      let reason: string | null = null;
      if (typeof value !== 'string' || value === '') reason = `${lng} 为空`;
      else if (value === sentence && HAS_ZH.test(sentence)) reason = `${lng} 与母语原文相同`;
      else if (hanRatio(value) > HAN_RATIO_THRESHOLD) {
        reason = `${lng} 汉字占比 ${Math.round(hanRatio(value) * 100)}%`;
      }
      if (reason !== null) untranslated[key] = { sentence, value: value ?? '', reason };
    }
  }

  const isExempt = (detail: { sentence: string; reason: string }): boolean => {
    if (emptyAllowed.includes(detail.sentence)) return true;
    if (sameAsNativeAllowed.includes(detail.sentence) && detail.reason.endsWith('与母语原文相同')) {
      return true;
    }
    return false;
  };
  const exemptEntries = Object.entries(untranslated).filter(([, detail]) => isExempt(detail));
  const pendingEntries = Object.entries(untranslated).filter(([, detail]) => !isExempt(detail));

  if (pendingEntries.length > 0) {
    issues.push(
      `伪翻译（未翻译）:\n      ${pendingEntries
        .map(
          ([key, detail]) =>
            `${key} 「${detail.sentence}」 → ${JSON.stringify(detail.value)}（${detail.reason}）`
        )
        .join('\n      ')}`
    );
  }

  // 规则 5：遗留语义 key 仍在使用
  if (Object.keys(legacyNative).length > 0) {
    const blob = readSourceBlob(paths.src);
    const stale = Object.keys(legacyNative).filter(
      (key) =>
        !blob.includes(`'${key}'`) &&
        !blob.includes(`"${key}"`) &&
        !dynamicKeyPatterns.some((pattern) => pattern.test(key)) &&
        !dynamicKeys.includes(key)
    );
    if (stale.length > 0) {
      issues.push(`遗留语义 key 已无人使用（改造成原文写法或删除）: ${stale.sort().join(', ')}`);
    }
  }

  // 规则 6：白名单不过期
  const sentences = new Set(Object.values(source));
  const staleWhitelist = [...emptyAllowed, ...sameAsNativeAllowed].filter(
    (item) => !sentences.has(item)
  );
  if (staleWhitelist.length > 0) {
    issues.push(`白名单已失效（词典中已无该原文）: ${staleWhitelist.join(', ')}`);
  }
  const staleDynamic = dynamicKeys.filter((key) => !(key in legacyNative));
  if (staleDynamic.length > 0) {
    issues.push(`动态 key 白名单已失效（词条中已无该 key）: ${staleDynamic.join(', ')}`);
  }

  return {
    issues,
    stats: {
      total: Object.keys(source).length,
      translated: Object.keys(source).length - Object.keys(untranslated).length,
      pending: pendingEntries.length,
      exempt: exemptEntries.length,
      unregistered: unregistered.size,
      legacy: Object.keys(legacyNative).length
    },
    untranslated,
    unregisteredList: [...unregistered.values()].sort()
  };
}

/** 源码全文（剔除注释行）：注释里提到的 key 不算在用。 */
function readSourceBlob(src: string): string {
  return walk(src)
    .map((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n')
    )
    .join('\n');
}

/** 发布前盘点：出报告，不判失败。 */
export function writeReport(paths: KitPaths, result: CheckResult): string {
  const cell = (text: string): string =>
    String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const rows = Object.entries(result.untranslated).map(([key, detail]) => [
    key,
    detail.sentence,
    JSON.stringify(detail.value),
    detail.reason
  ]);
  const section = (title: string, headers: string[], data: string[][]): string[] => {
    const lines = [`## ${title}`, ''];
    if (data.length === 0) return [...lines, '无 ✓', ''];
    lines.push(`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`);
    for (const row of data) lines.push(`| ${row.map(cell).join(' | ')} |`);
    return [...lines, ''];
  };

  const markdown = [
    '# i18n 文案报告',
    '',
    `生成时间: ${new Date().toISOString()}`,
    '',
    '## 概览',
    '',
    '| 指标 | 数量 |',
    '| --- | --- |',
    `| 词条总数 | ${result.stats.total} |`,
    `| 已翻译 | ${result.stats.translated} |`,
    `| 待翻译 | ${result.stats.pending} |`,
    `| 豁免（有意不译） | ${result.stats.exempt} |`,
    `| 未登记（源码有、词典无） | ${result.stats.unregistered} |`,
    `| 遗留语义 key | ${result.stats.legacy} |`,
    '',
    ...section(`待翻译（${result.stats.pending}）`, ['key', '母语原文', '当前译文', '原因'], rows),
    ...section(
      `未登记（${result.stats.unregistered}）`,
      ['母语原文', '出现位置'],
      result.unregisteredList.map((item) => item.split('  ← '))
    ),
    ''
  ].join('\n');

  mkdirSync(paths.dict, { recursive: true });
  const file = join(paths.dict, 'report.md');
  writeFileSync(file, `${markdown}\n`, 'utf8');
  return file;
}

export function reportCheck(result: CheckResult): void {
  if (result.issues.length > 0) {
    console.error('i18n 文案检查失败:');
    for (const issue of result.issues) console.error(`  ✗ ${issue}`);
    return;
  }
  const { stats } = result;
  console.log(
    `i18n 文案检查通过: 共 ${stats.total} 条（已翻译 ${stats.translated} / 豁免 ${stats.exempt}），未登记 0${stats.legacy > 0 ? `，遗留语义 key ${stats.legacy}` : ''}`
  );
}
