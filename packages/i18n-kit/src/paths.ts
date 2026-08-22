import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * 目录约定。
 *
 * 三个路径都可覆盖（其它项目不一定叫 `src/`）：命令行传 `--src` / `--dict` /
 * `--locales`，未传则取下列默认值。
 */
export interface KitPaths {
  /** 项目根 */
  root: string;
  /** 源码目录（扫描输入） */
  src: string;
  /** 词典目录（人读写：source / translation / untranslated / retired） */
  dict: string;
  /** 运行时资源目录（编译产物，勿手改） */
  locales: string;
  /** 母语语言 */
  nativeLng: string;
  /** 目标语言列表 */
  lngs: string[];
  /**
   * 常量表通道：对象属性名以这些后缀结尾时其值视为原文（`labelKey: '中文'`）。
   * 未配置取默认 `['Key']`（默认常量见 `collect.ts`，本文件不复制一份以免漂移）。
   */
  keySuffixes?: string[];
}

export interface PathOverrides {
  src?: string;
  dict?: string;
  locales?: string;
  nativeLng?: string;
  lngs?: string[];
  /** 常量表通道后缀白名单（默认 `['Key']`）；`[]` 表示关闭该通道 */
  keySuffixes?: string[];
}

export function resolvePaths(root: string, overrides: PathOverrides = {}): KitPaths {
  return {
    root: resolve(root),
    src: resolve(root, overrides.src ?? 'src'),
    dict: resolve(root, overrides.dict ?? 'i18n'),
    locales: resolve(root, overrides.locales ?? join('src', 'i18n', 'locales')),
    nativeLng: overrides.nativeLng ?? 'zh-CN',
    lngs: overrides.lngs ?? ['en'],
    // undefined（未配置）与 `[]`（显式关闭）必须区分开，故原样透传、不在此兜默认值。
    keySuffixes: overrides.keySuffixes
  };
}

/** 读 JSON，文件不存在返回空对象（首次扫描时词典尚不存在，属正常路径）。 */
export function readJson(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
}

/**
 * 写 JSON（临时文件 + rename，保证原子性）。
 *
 * 词典是**资产**，不是缓存：一次写到一半的失败（磁盘满 / 权限 / 中断）若留下截断
 * 的文件，此后每次 `readJson` 都会 JSON.parse 失败，整包译文就此损坏且无从回溯。
 * tmp + rename 让「写成功」与「文件完整」成为同一件事（rename 在同一分区内是原子的）。
 */
export function writeJson(file: string, data: Record<string, string>): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

/** 词典内各文件的路径（集中在此，避免各命令各拼一遍而漂移）。 */
export const dictFile = {
  source: (paths: KitPaths) => join(paths.dict, 'source', `${paths.nativeLng}.json`),
  translation: (paths: KitPaths, lng: string) => join(paths.dict, 'translation', `${lng}.json`),
  untranslated: (paths: KitPaths, lng: string) => join(paths.dict, 'untranslated', `${lng}.json`),
  retired: (paths: KitPaths, lng: string) => join(paths.dict, 'retired', `${lng}.json`)
};
