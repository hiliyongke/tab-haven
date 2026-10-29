import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * 分层方向守卫：把 `CONTRIBUTING.md` 的「依赖方向不可逆」从人眼检查变成恒绿门禁。
 *
 * 为什么需要它：`core/**` 零 chrome/DOM/React、`ui/**` 不直连浏览器 API 这两条，
 * 此前只写在文档与评审清单里。评审靠人读，漏看一次就进主干；而破坏分层的代价
 * 不会当场报错——core 里一句 `document.title` 在 vitest（jsdom）下照样跑绿，
 * 直到 SW 或非 DOM 环境里才炸。
 *
 * 为什么用 TypeScript AST 而不是正则：源码里有大量注释在讲 `chrome.tabs`、
 * `document`（本仓库注释密度约 20%），正则要么漏判要么逼着大家改注释措辞。
 * AST 天然不看注释和字符串字面量。
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

/** 收集静态 import 的模块说明符（不含动态 import 与 require，本项目不用）。 */
function importSpecifiers(source: ts.SourceFile): Array<{ line: number; specifier: string }> {
  const out: Array<{ line: number; specifier: string }> = [];
  ts.forEachChild(source, (node) => {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      out.push({ line: line + 1, specifier: node.moduleSpecifier.text });
    }
  });
  return out;
}

function relative(file: string): string {
  return file.replace(`${SRC}/`, 'src/');
}

const HOST_API = new Set(['chrome', 'browser']);
/** core 也必须零 DOM：localStorage / navigator 同样是宿主能力，不能只挡 document/window。 */
const DOM_API = new Set(['document', 'window', 'localStorage', 'navigator']);

describe('分层依赖方向', () => {
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

  it('core 不 import react 或 platform', () => {
    // When: 扫描 core 的静态导入
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
