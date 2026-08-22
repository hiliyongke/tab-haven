import { relative } from 'node:path';
import { collectSentences } from '../collect.ts';
import { dictFile, readJson, writeJson, type KitPaths } from '../paths.ts';

/**
 * 扫描：从源码抽取母语原文，生成词典 `i18n/source/<nativeLng>.json`。
 *
 * 开发者视角（这也是本文件存在的理由）：写业务代码时**只写中文**，不用想 key、
 * 不用先去词条文件里登记；写完跑一次扫描，词条自动进词典，缺译自动进待翻译清单。
 */

export interface ScanOptions {
  /** 只看不写（列出新增/失效，不落盘） */
  dry?: boolean;
  /** 失效词条的译文归档后，一并从译文文件移除（否则 check 的「孤立译文」会一直红） */
  prune?: boolean;
}

export interface ScanResult {
  scannedFiles: number;
  total: number;
  added: string[];
  removed: string[];
  errors: string[];
  /** 每个目标语言的待翻译条数 */
  pending: Record<string, number>;
  /** 本次抽取出的完整词典（key → 原文）：dry 不落盘，新增条目的原文只能从这里取 */
  dictionary: Record<string, string>;
  /** 实际从译文文件移除的失效条目数（按语言） */
  pruned: Record<string, number>;
}

export function scan(paths: KitPaths, options: ScanOptions = {}): ScanResult {
  const { entries, errors, scannedFiles } = collectSentences(paths.src, paths.root, {
    keySuffixes: paths.keySuffixes
  });

  /** key → 原文（同一 key 多处出现只保留一份）。 */
  const collected = new Map<string, string>();
  for (const entry of entries) {
    const existing = collected.get(entry.key);
    if (existing === undefined) {
      collected.set(entry.key, entry.sentence);
      continue;
    }
    // 同一 key 却不同原文 = 哈希碰撞或归一化后撞车，必须显式暴露而不是后者覆盖前者
    if (existing !== entry.sentence) {
      errors.push(
        `key ${entry.key} 对应多句原文：「${existing}」与「${entry.sentence}」（${entry.file}:${entry.line ?? '?'}）——请给其中一处加 context 区分，或统一两处原文写法`
      );
    }
  }

  const previous = readJson(dictFile.source(paths));
  const next: Record<string, string> = {};
  for (const [key, sentence] of collected) next[key] = sentence;

  const added = Object.keys(next).filter((key) => previous[key] === undefined);
  const removed = Object.keys(previous).filter((key) => next[key] === undefined);

  const pending: Record<string, number> = {};
  for (const lng of paths.lngs) {
    const translated = readJson(dictFile.translation(paths, lng));
    pending[lng] = Object.keys(next).filter((key) => {
      const value = translated[key];
      return typeof value !== 'string' || value === '';
    }).length;
  }

  const pruned: Record<string, number> = {};

  /**
   * 抽空保护：一条都没抽到时**绝不落盘**。
   *
   * 触发路径是真实存在的（`--src` 配错、目录下没有 .ts/.tsx、解析被 errorRecovery
   * 静默跳过），而后果不可逆——746 条源词典被写成 `{}`，随后 apply 把两个运行时
   * 词条也编译成 `{}`，界面整包露中文，词典又没有备份。宁可报错退出让人去查配置，
   * 也不静默清空一份资产（首次扫描 previous 为空时属正常，照常写入）。
   */
  const previousCount = Object.keys(previous).length;
  if (Object.keys(next).length === 0 && previousCount > 0) {
    errors.push(
      `本次扫描 0 条原文（已扫 ${scannedFiles} 个文件），放弃写入以免清空既有 ${previousCount} 条词典；请检查 --src 是否指向源码目录`
    );
  }

  const result: ScanResult = {
    scannedFiles,
    total: Object.keys(next).length,
    added,
    removed,
    errors,
    pending,
    dictionary: next,
    pruned
  };

  if (options.dry || errors.length > 0) return result;

  writeJson(dictFile.source(paths), next);

  // 待翻译清单：词典里有、译文文件里缺（或空）的词条。
  // 与「送翻」同位置：本工具集不联网，清单落盘后由人工或流程填回译文，再跑 apply。
  for (const lng of paths.lngs) {
    const translated = readJson(dictFile.translation(paths, lng));
    const pendingMap: Record<string, string> = {};
    for (const [key, sentence] of Object.entries(next)) {
      const value = translated[key];
      if (typeof value !== 'string' || value === '') pendingMap[key] = sentence;
    }
    writeJson(dictFile.untranslated(paths, lng), pendingMap);
  }

  /**
   * 失效词条不忍删除：译文里已不再被源码引用的 key 移入 `i18n/retired/`。
   * 直接删的代价是文案改回旧版本时译文永久丢失，而译文可复用正是哈希 key 的收益之一。
   */
  if (removed.length > 0) {
    for (const lng of paths.lngs) {
      const translated = readJson(dictFile.translation(paths, lng));
      const retired = readJson(dictFile.retired(paths, lng));
      for (const key of removed) {
        const value = translated[key];
        if (typeof value === 'string' && value !== '') retired[key] = value;
      }
      writeJson(dictFile.retired(paths, lng), retired);
    }
  }

  /**
   * 剪枝：失效词条已归档，译文文件里那份就成了「词典中不存在的孤立译文」，
   * `check` 规则 2 会一直红而没有任何自动修法（开发者只能手删 key）。
   * 默认不动（保留最大回旋余地），需要时显式 `scan --prune`。
   */
  if (options.prune && removed.length > 0) {
    for (const lng of paths.lngs) {
      const translated = readJson(dictFile.translation(paths, lng));
      let count = 0;
      for (const key of removed) {
        if (translated[key] === undefined) continue;
        delete translated[key];
        count += 1;
      }
      if (count > 0) writeJson(dictFile.translation(paths, lng), translated);
      pruned[lng] = count;
    }
  }

  return result;
}

/** 终端输出（命令与 API 共用同一份文案）。 */
export function reportScan(paths: KitPaths, result: ScanResult, dry: boolean): void {
  console.log(
    `i18n 扫描: ${result.scannedFiles} 个文件 → ${result.total} 条词条（新增 ${result.added.length}，失效 ${result.removed.length}）`
  );

  if (result.errors.length > 0) {
    console.error(`\n扫描发现 ${result.errors.length} 个问题:`);
    for (const error of result.errors) console.error(`  ✗ ${error}`);
  }

  if (dry) {
    const previous = readJson(dictFile.source(paths));
    // 新增条目的原文只在本次抽取结果里（dry 不落盘，词典里还没有它）
    for (const key of result.added) console.log(`  + ${key}  ${result.dictionary[key] ?? ''}`);
    for (const key of result.removed) console.log(`  - ${key}  ${previous[key] ?? ''}`);
    return;
  }

  if (result.errors.length > 0) return;

  console.log(`  词典（母语原文）: ${relative(paths.root, dictFile.source(paths))}`);
  for (const lng of paths.lngs) {
    console.log(
      `  待翻译（${lng}）: ${result.pending[lng] ?? 0} 条 → ${relative(paths.root, dictFile.untranslated(paths, lng))}`
    );
  }
  if (result.removed.length > 0) {
    console.log(
      `  失效词条译文已归档: ${paths.lngs.map((lng) => relative(paths.root, dictFile.retired(paths, lng))).join(', ')}`
    );
    const pruned = paths.lngs.filter((lng) => (result.pruned[lng] ?? 0) > 0);
    if (pruned.length > 0) {
      console.log(`  已从译文文件移除失效条目（--prune）: ${pruned.join(', ')}`);
    } else {
      console.log('  提示: 译文文件仍保留失效条目，需一并移除时跑 `i18n-kit scan --prune`');
    }
  }
}
