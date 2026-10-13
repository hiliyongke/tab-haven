import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { dictFile, readJson, type KitPaths } from '../paths.ts';

/**
 * 编译：把 `i18n/` 下的词典编译成运行时资源 `src/i18n/locales/<lng>/translation.json`。
 *
 * 为什么要有这一步而不是让运行时直接读 `i18n/`：运行时资源要随应用打包，必须在
 * 源码目录里；而 `i18n/` 是给人读写的词典目录，里面还有待翻译、失效归档等不该进
 * 包的中间物。
 */

export interface ApplyResult {
  /** 各语言写入的条目数 */
  written: Record<string, number>;
  hashCount: number;
  legacyCount: number;
}

export function apply(paths: KitPaths): ApplyResult {
  const source = readJson(dictFile.source(paths));
  const legacyNative = readJson(dictFile.legacy(paths, paths.nativeLng));

  const written: Record<string, number> = {};

  for (const lng of [paths.nativeLng, ...paths.lngs]) {
    const isNative = lng === paths.nativeLng;
    // 母语轨道：原文即译文；译文轨道：取 translation。
    const dictionary = isNative ? source : readJson(dictFile.translation(paths, lng));
    const legacy = readJson(dictFile.legacy(paths, lng));
    // 平铺输出：键即完整 key（哈希 key 与迁移期遗留的语义 key 同表），不做对象嵌套——
    // 嵌套会让「键路径」与「原文」两套体系互相纠缠，也不利于按 key 精确裁剪。
    const resources = { ...legacy, ...dictionary };

    const dir = join(paths.locales, lng);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'translation.json'), `${JSON.stringify(resources, null, 2)}\n`, 'utf8');
    written[lng] = Object.keys(resources).length;
  }

  return {
    written,
    hashCount: Object.keys(source).length,
    legacyCount: Object.keys(legacyNative).length
  };
}

export function reportApply(paths: KitPaths, result: ApplyResult): void {
  for (const [lng, count] of Object.entries(result.written)) {
    console.log(
      `  ${lng}: ${count} 条 → ${relative(paths.root, join(paths.locales, lng, 'translation.json'))}`
    );
  }
  console.log(
    `i18n 编译完成: 哈希词条 ${result.hashCount} 条${result.legacyCount > 0 ? `，遗留语义 key ${result.legacyCount} 条` : ''}`
  );
}
