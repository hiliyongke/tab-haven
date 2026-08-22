import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apply, reportApply } from './commands/apply.ts';
import { check, reportCheck, writeReport } from './commands/check.ts';
import { lint, reportLint } from './commands/lint.ts';
import { reportScan, scan } from './commands/scan.ts';
import { resolvePaths, type PathOverrides } from './paths.ts';
import type { CheckOptions } from './commands/check.ts';

/**
 * 命令行入口。
 *
 *   i18n-kit scan [--dry] [--prune]
 *                             扫描源码抽词，刷新词典与待翻译清单
 *   i18n-kit apply            把词典编译成运行时词条文件
 *   i18n-kit check [--report] 文案守卫（--report 只出报告不判失败）
 *   i18n-kit lint             检查未被词典接管的裸露中文
 *
 * 目录均可覆盖：--root / --src / --dict / --locales / --lngs en,ja
 */

/** 项目可选配置（`<root>/i18n-kit.config.mjs`，导出 default 对象）。 */
export interface KitConfig extends PathOverrides {
  /**
   * 常量表通道：对象属性名以这些后缀结尾时，其值视为原文（`labelKey: '中文'`）。
   * 默认 `['Key']`；`title` / `placeholder` 这类非 `t()` 通道按需登记，
   * 未登记就只能靠 `@i18n-ignore` 人工豁免，而豁免压住的只是告警、词条依然进不来。
   */
  keySuffixes?: string[];
  /** 允许译文为空串的母语原文 */
  emptyAllowed?: string[];
  /** 允许译文与母语原文相同的原文 */
  sameAsNativeAllowed?: string[];
}

const CONFIG_FILE = 'i18n-kit.config.mjs';

async function loadConfig(root: string): Promise<KitConfig> {
  const file = resolve(root, CONFIG_FILE);
  if (!existsSync(file)) return {};
  const module = (await import(pathToFileURL(file).href)) as { default?: KitConfig };
  return module.default ?? {};
}

/** 子命令名：用于把「开关后面的词」与「开关的值」区分开。 */
const KNOWN_COMMANDS = new Set(['scan', 'apply', 'check', 'lint', 'help']);

/**
 * 解析命令行开关（只认 `--key value` 与 `--flag` 两种形态）。
 *
 * 命令名必须参与判定：`i18n-kit --dry scan` 里 `scan` 是子命令而不是 `--dry` 的
 * 值。若一律当成值，flags.dry 会变成字符串 'scan'（真值，照样落盘），而 command
 * 变成 undefined —— 用户以为在看 dry-run 预览，实际词典已经被改写。
 */
function parseArgs(argv: string[]): { command: string | undefined; flags: Record<string, string> } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token.startsWith('--')) {
      const next = argv[index + 1];
      const isValue = next !== undefined && !next.startsWith('--') && !KNOWN_COMMANDS.has(next);
      flags[token.slice(2)] = isValue ? next : 'true';
      if (isValue) index += 1;
      continue;
    }
    positional.push(token);
  }
  return { command: positional[0], flags };
}

export async function run(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  if (command === undefined || command === 'help') {
    console.log(
      [
        'i18n-kit —— 写母语原文、自动出哈希 key 词典的 i18n 工具集',
        '',
        '  i18n-kit scan [--dry] [--prune]',
        '                            扫描源码抽词，刷新词典与待翻译清单',
        '                            --prune: 失效词条归档后一并从译文文件移除',
        '  i18n-kit apply            把词典编译成运行时词条文件',
        '  i18n-kit check [--report] 文案守卫',
        '  i18n-kit lint             检查未被词典接管的裸露中文',
        '',
        '  目录覆盖: --root --src --dict --locales --lngs en,ja'
      ].join('\n')
    );
    return 0;
  }

  const root = resolve(flags.root ?? process.cwd());
  const config = await loadConfig(root);
  const paths = resolvePaths(root, {
    src: flags.src ?? config.src,
    dict: flags.dict ?? config.dict,
    locales: flags.locales ?? config.locales,
    nativeLng: config.nativeLng,
    lngs: flags.lngs ? flags.lngs.split(',').map((lng) => lng.trim()) : config.lngs,
    keySuffixes: config.keySuffixes
  });

  const checkOptions: CheckOptions = {
    emptyAllowed: config.emptyAllowed ?? [],
    sameAsNativeAllowed: config.sameAsNativeAllowed ?? []
  };

  switch (command) {
    case 'scan': {
      const dry = flags.dry === 'true';
      const result = scan(paths, { dry, prune: flags.prune === 'true' });
      reportScan(paths, result, dry);
      return result.errors.length > 0 ? 1 : 0;
    }
    case 'apply': {
      reportApply(paths, apply(paths));
      return 0;
    }
    case 'check': {
      const result = check(paths, checkOptions);
      if (flags.report === 'true') {
        const file = writeReport(paths, result);
        console.log(`i18n 报告已生成: ${file}`);
        return 0;
      }
      reportCheck(result);
      return result.issues.length > 0 ? 1 : 0;
    }
    case 'lint': {
      const result = lint(paths);
      reportLint(result);
      return result.reports.length > 0 ? 1 : 0;
    }
    default: {
      console.error(`未知命令: ${command}（试试 i18n-kit help）`);
      return 1;
    }
  }
}
