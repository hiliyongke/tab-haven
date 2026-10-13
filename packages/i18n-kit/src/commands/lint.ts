import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { parse, type ParserOptions } from '@babel/parser';
import { DEFAULT_KEY_SUFFIXES, visit, walk, type AstNode, type AstValue } from '../collect.ts';
import type { KitPaths } from '../paths.ts';

/**
 * 未标记中文检查（zh-linter）。
 *
 * 守卫的是「界面上出现了没经过词典的中文」：
 *   - JSX 裸文本（`<p>中文</p>`）；
 *   - 直接渲染的字符串常量（`title="中文"`、`{ '中文' }`）；
 *   - 模板串里的中文。
 *
 * 这些中文不会进词典，英文模式下原样显示——而且因为没人动过词条文件，
 * `check` 也查不出来（词典里本来就没有它）。
 *
 * 例外通过**就近注释**声明，不在工具里堆豁免清单：
 *   - 本行或上一行写 `// @i18n-ignore`（数据常量、语言名表等）；
 *   - 整个文件不参与检查：文件顶部写 `// @i18n-noscan`。
 */

const HAS_ZH = /\p{Script=Han}/u;
const NO_SCAN = /^\s*\/\/\s*@i18n-noscan\s*$/m;
const IGNORE = /@i18n-ignore/;
const IGNORE_START = /@i18n-ignore-start/;
const IGNORE_END = /@i18n-ignore-end/;

/**
 * 块级豁免区间（1 基行号，闭区间）。
 *
 * 原文常量表（如 `{ grey: '灰色', blue: '蓝色' }`）里的中文最终会传进 `t()`，
 * 但它既不在调用点里、也不是 `*Key` 属性，逐行加 `@i18n-ignore` 会把注释噪声
 * 抬得比代码还高，故提供块级开关。
 */
function ignoreRanges(lines: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = 0;
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (IGNORE_START.test(line) && start === 0) start = lineNumber;
    else if (IGNORE_END.test(line) && start !== 0) {
      ranges.push([start, lineNumber]);
      start = 0;
    }
  });
  // 写了 start 却没写 end：视为到文件末尾，避免「半个豁免」静默失效
  if (start !== 0) ranges.push([start, lines.length]);
  return ranges;
}

/**
 * 诊断通道白名单：这些调用的中文是**给开发者看的日志**，不会出现在界面上，
 * 翻译它们反而会让排障时看到的语种随用户语言变化。
 */
const DIAGNOSTIC_CALLS = new Set([
  'logFailure',
  'logDegraded',
  'logInfo',
  // 持久化降级提示最终也只进诊断日志，与日志同类：不进界面，不翻译。
  'reportPersistenceFailure'
]);

const parseOptions: ParserOptions = {
  sourceType: 'module',
  errorRecovery: true,
  plugins: ['typescript', 'jsx', 'decorators-legacy']
};

const asNodes = (value: AstValue): AstNode[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is AstNode =>
          typeof item === 'object' &&
          item !== null &&
          !Array.isArray(item) &&
          typeof (item as AstNode).type === 'string'
      )
    : [];
const asNode = (value: AstValue): AstNode | undefined => asNodes([value])[0];

function text(node: AstNode): string {
  if (node.type === 'StringLiteral') return String(node.value);
  if (node.type === 'TemplateLiteral') {
    // quasi.value 是 `{ raw, cooked }`：`String(...)` 会得到 "[object Object]"，
    // 模板串里的中文因此永远查不出来（与 collect.ts 同口径修法）。
    return asNodes(node.quasis)
      .map((quasi) => {
        const value = quasi.value as { cooked?: string; raw?: string } | undefined;
        return value?.cooked ?? value?.raw ?? '';
      })
      .join('');
  }
  if (node.type === 'JSXText') return String(node.value);
  return '';
}

export interface LintResult {
  reports: string[];
}

export function lint(paths: KitPaths): LintResult {
  const reports: string[] = [];
  // 常量表通道与扫描器同源：后缀白名单可在 `i18n-kit.config.mjs` 里配置，
  // 两边取同一份，否则「扫描器收进词典、lint 又判为裸露中文」会互相打架。
  const keySuffixes: readonly string[] = paths.keySuffixes ?? DEFAULT_KEY_SUFFIXES;

  for (const file of walk(paths.src)) {
    const content = readFileSync(file, 'utf8');
    if (NO_SCAN.test(content)) continue;
    const lines = content.split('\n');
    const ranges = ignoreRanges(lines);

    let ast: AstNode;
    try {
      ast = parse(content, parseOptions) as unknown as AstNode;
    } catch {
      continue;
    }

    /** 已被词典体系接管的节点：t() 的原文、常量表属性的值、<Trans> 的子节点、诊断日志参数。 */
    const marked = new Set<AstNode>();
    const markTree = (node: AstValue): void => visit(node, (child) => marked.add(child));

    visit(ast, (node) => {
      if (node.type === 'CallExpression') {
        const callee = asNode(node.callee);
        const name = callee?.type === 'Identifier' ? callee.name : asNode(callee?.property)?.name;
        const args = asNodes(node.arguments);
        if (name === 't' || name === 'translate') {
          if (args[0] !== undefined) markTree(args[0]);
          return;
        }
        const isConsole =
          callee?.type === 'MemberExpression' &&
          asNode(callee.object)?.type === 'Identifier' &&
          asNode(callee.object)?.name === 'console';
        if ((typeof name === 'string' && DIAGNOSTIC_CALLS.has(name)) || isConsole) {
          for (const argument of args) markTree(argument);
        }
        return;
      }
      if (node.type === 'ObjectProperty') {
        const key = asNode(node.key);
        const name = key?.name ?? key?.value;
        if (typeof name === 'string' && keySuffixes.some((suffix) => name.endsWith(suffix))) {
          markTree(node.value);
        }
        return;
      }
      if (
        node.type === 'JSXElement' &&
        asNode(asNode(node.openingElement)?.name)?.name === 'Trans'
      ) {
        for (const child of asNodes(node.children)) markTree(child);
      }
    });

    visit(ast, (node) => {
      if (!['StringLiteral', 'TemplateLiteral', 'JSXText'].includes(node.type)) return;
      if (marked.has(node)) return;
      const value = text(node);
      if (value === '' || !HAS_ZH.test(value)) return;
      const line = node.loc?.start.line ?? 0;
      // 就近豁免：本行或上一行的注释里声明；块级豁免：落在 ignore-start/end 之间
      if (IGNORE.test(lines[line - 1] ?? '') || IGNORE.test(lines[line - 2] ?? '')) return;
      if (ranges.some(([from, to]) => line >= from && line <= to)) return;
      reports.push(`${relative(paths.root, file)}:${line}  ${value.trim().slice(0, 40)}`);
    });
  }

  return { reports };
}

export function reportLint(result: LintResult): void {
  if (result.reports.length === 0) {
    console.log('未标记中文检查通过: 源码中无裸露的中文文案');
    return;
  }
  console.error(`未标记中文 ${result.reports.length} 处（英文模式会原样显示中文）:`);
  for (const report of result.reports) console.error(`  ✗ ${report}`);
  console.error("\n处理方式：改写成 t('中文') / <Trans>，或就近加 // @i18n-ignore 说明豁免理由。");
}
