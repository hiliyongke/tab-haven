import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * 分层依赖行为规格：core 不访问宿主 API、不依赖 React 或 platform、不引入计时器副作用；
 * ui、stores 与 entrypoints 不直接访问浏览器 API；platform 不回引领域决策层。
 */

const SRC = join(process.cwd(), 'src');

interface Violation {
  file: string;
  line: number;
  detail: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/** 把属性访问链还原成名字序列，顺带剥掉 `!` / 括号 / 类型断言。 */
function accessChain(node: ts.PropertyAccessExpression): string[] {
  const names: string[] = [];
  let cur: ts.Expression = node;
  for (;;) {
    if (ts.isPropertyAccessExpression(cur)) {
      names.unshift(cur.name.text);
      cur = cur.expression;
    } else if (
      ts.isNonNullExpression(cur) ||
      ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isTypeAssertionExpression(cur)
    ) {
      cur = cur.expression;
    } else {
      break;
    }
  }
  if (ts.isIdentifier(cur)) names.unshift(cur.text);
  return names;
}

/** 收集 `chrome.tabs.query` 这类属性访问的根标识符（`chrome`）。 */
function hostApiUses(source: ts.SourceFile, roots: ReadonlySet<string>): Violation[] {
  const hits: Violation[] = [];
  // 同一行的嵌套链（chrome.tabs 与 chrome.tabs.query）会各命中一次，按行 + 前两段去重。
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      // 按名字链判定，而不是按源码文本：`(globalThis as X).chrome.tabs`、`chrome!.tabs`
      // 与裸 `chrome.tabs` 等价，文本正则只能覆盖其中一部分写法。
      const chain = accessChain(node);
      const root = chain[0];
      const isHost =
        root !== undefined &&
        (roots.has(root) ||
          ((root === 'globalThis' || root === 'self') &&
            chain[1] !== undefined &&
            roots.has(chain[1])));
      if (isHost) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        const key = `${line}:${chain.slice(0, 2).join('.')}`;
        if (!seen.has(key)) {
          seen.add(key);
          hits.push({
            file: source.fileName,
            line: line + 1,
            detail: node.getText(source).split('\n')[0] ?? ''
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

/**
 * 收集模块说明符：静态 import、动态 `import()` 与 `require()` 必须走同一套判据，
 * 否则 `await import('@/platform/x')` 能绕过分层检查。
 */
function importSpecifiers(source: ts.SourceFile): Array<{ line: number; specifier: string }> {
  const out: Array<{ line: number; specifier: string }> = [];
  const push = (node: ts.Node, specifier: string): void => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    out.push({ line: line + 1, specifier });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      push(node, node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      push(node, node.arguments[0]!.text);
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      push(node, node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** 收集异步调度调用：core 是纯领域层，定时任务只能在 platform / entrypoints。 */
function timerCalls(source: ts.SourceFile): Array<{ line: number; detail: string }> {
  const names = new Set(['setTimeout', 'setInterval', 'queueMicrotask', 'requestAnimationFrame']);
  const hits: Array<{ line: number; detail: string }> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      names.has(node.expression.text)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      hits.push({ line: line + 1, detail: `${node.expression.text}()` });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

function relative(file: string): string {
  return file.replace(`${SRC}/`, 'src/');
}

const HOST_API = new Set(['chrome', 'browser']);
/** core 也必须零 DOM：localStorage / navigator 同样是宿主能力，不能只挡 document/window。 */
const DOM_API = new Set(['document', 'window', 'localStorage', 'navigator']);

describe('分层依赖方向', () => {
  it('background 是唯一获准编排浏览器事件的入口例外', () => {
    const files = walk(join(SRC, 'entrypoints'));
    expect(files.length).toBeGreaterThan(0);
    const violations = new Set(
      files.flatMap((file) => hostApiUses(parse(file), HOST_API).map((hit) => relative(hit.file)))
    );
    expect([...violations].sort()).toEqual(['src/entrypoints/background.ts']);
    expect(readFileSync(join(SRC, 'entrypoints/background.ts'), 'utf8')).toContain(
      "import { browser } from 'wxt/browser'"
    );
  });

  it('core 不触碰任何宿主 API（chrome/browser/document/window）', () => {
    // When: 扫描 core 全部源码
    const files = walk(join(SRC, 'core'));
    // 扫描面归零时下一条断言恒真：目录改名/路径写错必须自己先红。
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((file) => {
      const source = parse(file);
      return [...hostApiUses(source, HOST_API), ...hostApiUses(source, DOM_API)];
    });

    // Then: 一处都不允许（core 是纯领域层，须能在无 DOM 环境跑）
    expect(violations.map((v) => `${relative(v.file)}:${v.line} ${v.detail}`)).toEqual([]);
  });

  it('core 不 import react 或 platform（静态 / 动态 / require 同口径）', () => {
    // When: 扫描 core 的三种模块引用形式
    const files = walk(join(SRC, 'core'));
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((file) => {
      const source = parse(file);
      return importSpecifiers(source)
        .filter(
          ({ specifier }) =>
            /^(react|react-dom)(\/|$)/.test(specifier) ||
            /^@\/platform(\/|$)/.test(specifier) ||
            /(^|\/)platform\//.test(specifier)
        )
        .map(({ line, specifier }) => `${relative(file)}:${line} import '${specifier}'`);
    });

    // Then: core 只能依赖 core 自身与纯工具
    expect(violations).toEqual([]);
  });

  it('core 不引入计时器副作用', () => {
    // Given/When/Then: 纯领域层不得自行调度定时任务，异步编排属于 platform 或入口
    const files = walk(join(SRC, 'core'));
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((file) =>
      timerCalls(parse(file)).map(({ line, detail }) => `${relative(file)}:${line} ${detail}`)
    );
    expect(violations).toEqual([]);
  });

  it('platform 不回引 core/commands 领域决策层', () => {
    // Given/When/Then: 决策上收 core，适配层不得自行引入命令决策入口
    const files = walk(join(SRC, 'platform'));
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((file) =>
      importSpecifiers(parse(file))
        .filter(({ specifier }) => /^@\/core\/commands(\/|$)/.test(specifier))
        .map(({ line, specifier }) => `${relative(file)}:${line} import '${specifier}'`)
    );
    expect(violations).toEqual([]);
  });

  it('ui / stores / entrypoints 不直连浏览器 API', () => {
    // When: 扫描这三个层（background 入口是平台编排点，豁免）
    const files = walk(SRC)
      .filter((file) => /\/src\/(ui|stores|entrypoints)\//.test(file))
      .filter((file) => !file.endsWith('/entrypoints/background.ts'));
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((file) => hostApiUses(parse(file), HOST_API));

    // Then: 一律经 platform/** 适配层
    expect(violations.map((v) => `${relative(v.file)}:${v.line} ${v.detail}`)).toEqual([]);
  });
});
