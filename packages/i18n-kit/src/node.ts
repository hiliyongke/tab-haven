/**
 * Node 侧入口：扫描 / 编译 / 守卫 / 裸露中文检查，供脚本或其他工具程序化调用。
 */
export { scan, reportScan } from './commands/scan.ts';
export type { ScanOptions, ScanResult } from './commands/scan.ts';
export { apply, reportApply } from './commands/apply.ts';
export type { ApplyResult } from './commands/apply.ts';
export { check, reportCheck, writeReport } from './commands/check.ts';
export type { CheckOptions, CheckResult } from './commands/check.ts';
export { lint, reportLint } from './commands/lint.ts';
export type { LintResult } from './commands/lint.ts';
export { collectSentences, collectFromFile, walk } from './collect.ts';
export type { CollectOptions, ScannedEntry } from './collect.ts';
export { dictFile, readJson, resolvePaths } from './paths.ts';
export type { KitPaths, PathOverrides } from './paths.ts';
export { run } from './cli.ts';
export type { KitConfig } from './cli.ts';
