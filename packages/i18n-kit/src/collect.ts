import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import { parse, type ParserOptions } from '@babel/parser';
import { toHashKey } from './hashKey.ts';

/**
 * 源码词条抽取（扫描器与守卫共用）。
 *
 * 单列一份而不是各写一遍：扫描器每次运行都产出新词典，守卫要把**源码里的原文**
 * 对上词典，两边对「什么算一个调用点」的判断一旦不一致，就会漏挂译文——表现是
 * 英文模式里某几条文案露中文，而且查不出是哪一步出错。
 */

/** 源码位置（只取扫描需要的行/列）。 */
export interface SourceLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

/**
 * 最小 AST 节点形状：只取遍历需要的部分，避免为一次扫描引入 @babel/traverse。
 *
 * 索引签名要求**所有**成员都能赋给 `AstValue`，故 `loc` 的结构必须显式列入联合
 * （否则 TS 会报「loc 不能赋给索引签名类型」）。
 */
export interface AstNode {
  type: string;
  loc?: SourceLocation;
  [key: string]: AstValue;
}
export type AstValue =
  AstNode | AstValue[] | SourceLocation | string | number | boolean | null | undefined;

const isNode = (value: AstValue): value is AstNode =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as { type?: unknown }).type === 'string';

const asNodes = (value: AstValue): AstNode[] => (Array.isArray(value) ? value.filter(isNode) : []);
const asNode = (value: AstValue): AstNode | undefined => (isNode(value) ? value : undefined);

const HAS_ZH = /\p{Script=Han}/u;
const SCANNABLE = new Set(['.ts', '.tsx']);

/** 文件级跳过标记：整个文件不参与扫描（数据常量、语言名表等）。 */
const NO_SCAN = /^\s*\/\/\s*@i18n-noscan\s*$/m;

/** `t` / `i18n.t` / `i18next.t` 这类调用的成员链白名单。 */
const TRANSLATE_FUNCS = new Set(['t', 'translate']);

/**
 * 常量表通道：属性名以这些后缀结尾时，其值视为原文（`labelKey: '中文'` 的值
 * 会原样传进 `t()`，算作调用点）。默认 `['Key']`。
 *
 * 做成可配置而不是写死：别的项目里常量表可能叫 `labelText` / `title`，写死 `Key`
 * 就只能靠 `@i18n-ignore` 人工豁免——而豁免压住的是告警，词条依然进不来，
 * 英文模式照样露中文（这正是此前漏抽的成因之一）。
 */
export const DEFAULT_KEY_SUFFIXES: readonly string[] = ['Key'];

/** 抽取的可选项。 */
export interface CollectOptions {
  /** 覆盖默认后缀白名单；显式传 `[]` 表示关闭常量表通道。 */
  keySuffixes?: string[];
}

/** 未配置时取默认后缀（默认数组以 readonly 暴露，调用方只能整体替换，不能就地改写）。 */
const resolveSuffixes = (options: CollectOptions): readonly string[] =>
  options.keySuffixes ?? DEFAULT_KEY_SUFFIXES;

const parseOptions: ParserOptions = {
  sourceType: 'module',
  // errorRecovery：单个新语法不至于让整个仓库扫描失败；错误节点会被跳过。
  errorRecovery: true,
  plugins: ['typescript', 'jsx', 'decorators-legacy']
};

/**
 * 遍历时跳过的目录：这些目录里没有业务源码，扫进来只是白耗时间，
 * 而 `node_modules` 里的中文注释与文案会被误收进词典（凭空多出几百条待翻译）。
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.output',
  '.wxt',
  '.codebuddy',
  'dist',
  'build',
  'coverage'
]);

/** 递归收集源码文件（排序保证扫描结果稳定）。 */
export function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // 无权限 / 目录在读期间被删除：跳过即可，不该让整次扫描失败。
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      out.push(...walk(full));
      continue;
    }
    // 不跟随符号链接：`node_modules` 里的软链（pnpm 全局 store、workspace link）
    // 可能成环，逐个 stat 跟随会无限递归。链接本身也不是业务源码。
    if (entry.isSymbolicLink()) continue;
    if (SCANNABLE.has(entry.name.slice(entry.name.lastIndexOf('.')))) out.push(full);
  }
  return out.sort();
}

/** 深度遍历 AST。 */
export function visit(node: AstValue, onNode: (node: AstNode) => void): void {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) visit(item, onNode);
    return;
  }
  if (isNode(node)) onNode(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    visit((node as AstNode)[key], onNode);
  }
}

/**
 * 模板串单个 quasi 的文本。
 *
 * Babel 的 `TemplateElement.value` 是 `{ raw, cooked }` **对象**——直接 `String(value)`
 * 会得到 `"[object Object]"`：抽出来的句子不含汉字，随后被 `HAS_ZH` 过滤掉，
 * 于是词条不进词典，而运行时按真原文算出的 key 查不到 → 英文模式露中文，
 * 且 scan / check / lint 三处用的是同一份错误结果，全都给绿灯。
 * 取 `cooked ?? raw`（cooked 是转义已解的文本，与运行时所见一致）。
 */
function quasiText(quasi: AstNode): string {
  const value = quasi.value as { cooked?: string; raw?: string } | undefined;
  return value?.cooked ?? value?.raw ?? '';
}

/** 字面量原文：字符串字面量与无插值模板串可得，其余返回 null。 */
function literalText(node: AstNode | undefined): string | null {
  if (node === undefined) return null;
  if (node.type === 'StringLiteral') return String(node.value);
  if (node.type === 'TemplateLiteral' && asNodes(node.expressions).length === 0) {
    return asNodes(node.quasis).map(quasiText).join('');
  }
  return null;
}

/**
 * 条件 / 逻辑表达式的分支节点。
 *
 * `t(cond ? 'A' : 'B')`、`t(a || 'B')` 的每一支都是运行时可能命中的原文：
 * 只抽其中一支，另一支在英文模式就是露中文，而守卫查的是同一份抽取结果，
 * 于是 scan 与 check 双绿、问题却真实存在。故逐支展开，由调用方各自判定。
 *
 * 标识符 / 成员表达式无法静态求值，原样返回（它们指向的原文应在定义处被抽到）。
 */
function branchNodes(node: AstNode | undefined): AstNode[] {
  if (node === undefined) return [];
  if (node.type === 'ConditionalExpression') {
    return [...branchNodes(asNode(node.consequent)), ...branchNodes(asNode(node.alternate))];
  }
  if (node.type === 'LogicalExpression') {
    return [...branchNodes(asNode(node.left)), ...branchNodes(asNode(node.right))];
  }
  return [node];
}

/** 模板串的静态部分（去掉 `${...}` 后剩下的字面量）。 */
function staticPart(node: AstNode): string {
  return asNodes(node.quasis).map(quasiText).join('');
}

/** 调用表达式是否形如 `t(...)` / `i18n.t(...)`。 */
function isTranslateCall(node: AstNode): boolean {
  if (node.type !== 'CallExpression') return false;
  const callee = asNode(node.callee);
  if (callee === undefined) return false;
  if (callee.type === 'Identifier') return TRANSLATE_FUNCS.has(String(callee.name));
  if (callee.type === 'MemberExpression') {
    const property = asNode(callee.property);
    return property?.type === 'Identifier' && TRANSLATE_FUNCS.has(String(property.name));
  }
  return false;
}

/** 取 `t('原文', { context: 'x' })` 里的 context（必须是字面量，否则无法静态扫描）。 */
function readContext(node: AstValue): string | undefined {
  const target = asNode(node);
  if (target === undefined || target.type !== 'ObjectExpression') return undefined;
  for (const property of asNodes(target.properties)) {
    if (property.type !== 'ObjectProperty') continue;
    const name = asNode(property.key)?.name ?? asNode(property.key)?.value;
    if (name !== 'context') continue;
    return literalText(asNode(property.value)) ?? undefined;
  }
  return undefined;
}

/**
 * JSX 子节点串化：文本原样拼接，其余按**同层序号**写成 `<0></0>`。
 *
 * 序号按**过滤掉空白文本后**的数组计算（React 的 Children.toArray 同样丢弃它们），
 * 与运行时 `Trans` 的 `nodesToString` 必须同口径，否则算出的 key 不一致。
 */
export function jsxChildrenToString(
  children: AstValue,
  onError?: (message: string) => void
): string {
  const nodes = asNodes(children).filter((child) => {
    // 空白 JSXText **必须保留**：运行时 `Children.toArray` 只丢弃 null/undefined/
    // boolean，空白字符串仍然占一个序号。在这里过滤掉会让后续占位符整体错位
    // （<A/> <B/> 之间那个空格是最容易踩的形态）。
    if (child.type === 'JSXText') return true;
    if (child.type === 'JSXExpressionContainer') {
      const expression = asNode(child.expression);
      if (expression === undefined || expression.type === 'JSXEmptyExpression') return false;
      // null / undefined / 布尔字面量：运行时同样丢弃，此处也丢弃才能同序号。
      if (
        expression.type === 'NullLiteral' ||
        expression.type === 'BooleanLiteral' ||
        (expression.type === 'Identifier' && String(expression.name) === 'undefined')
      )
        return false;
      /**
       * 个数无法静态确定的表达式：运行时会被**展平**（`.map()` 出 N 个）或因取值
       * 不同变成 0 或 1 个（`cond && <b/>`），而这里只能记一个占位 —— 两侧算出的
       * key 必然不同，表现为这一句在英文模式下恒中文且 check 全绿。
       * 与其静默算错，不如当场报错让调用方改写。
       */
      if (expression.type === 'CallExpression' || expression.type === 'LogicalExpression') {
        onError?.(
          `Trans 的子节点含动态个数的表达式（${expression.type}），无法静态计算 key，请改写成固定个数的子节点`
        );
      }
      return true;
    }
    return true;
  });

  let out = '';
  nodes.forEach((child, index) => {
    if (child.type === 'JSXText') {
      out += String(child.value);
      return;
    }
    if (child.type === 'JSXExpressionContainer') {
      const expression = asNode(child.expression);
      if (expression?.type === 'StringLiteral') {
        out += String(expression.value);
        return;
      }
      out += `<${index}></${index}>`;
      return;
    }
    if (child.type === 'JSXElement') {
      const inner = jsxChildrenToString(child.children);
      out += inner === '' ? `<${index}></${index}>` : `<${index}>${inner}</${index}>`;
      return;
    }
    out += `<${index}></${index}>`;
  });
  return out;
}

/** 归一化：换行与多余空白折成一个空格——源码折行不代表文案有换行。 */
export const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** 一条扫描结果。 */
export interface ScannedEntry {
  key: string;
  sentence: string;
  context?: string;
  file: string;
  line?: number;
}

/** 单文件抽取结果。 */
export function collectFromFile(
  file: string,
  root: string,
  options: CollectOptions = {}
): {
  entries: ScannedEntry[];
  errors: string[];
  skipped: boolean;
} {
  const suffixes = resolveSuffixes(options);
  const content = readFileSync(file, 'utf8');
  if (NO_SCAN.test(content)) return { entries: [], errors: [], skipped: true };

  let ast: AstNode;
  try {
    ast = parse(content, parseOptions) as unknown as AstNode;
  } catch (error) {
    return {
      entries: [],
      errors: [`${relative(root, file)} 解析失败: ${(error as Error).message}`],
      skipped: false
    };
  }

  const entries: ScannedEntry[] = [];
  const errors: string[] = [];
  const relativePath = relative(root, file);

  const push = (sentence: string, context: string | undefined, line: number | undefined): void => {
    if (sentence === '' || !HAS_ZH.test(sentence)) return;
    entries.push({
      key: toHashKey(sentence, context),
      sentence,
      context,
      file: relativePath,
      line
    });
  };

  visit(ast, (node) => {
    if (isTranslateCall(node)) {
      const args = asNodes(node.arguments);
      // 逐支抽取：条件 / 逻辑表达式的两支都是候选原文，漏一支等于给另一支埋雷。
      for (const branch of branchNodes(args[0])) {
        const text = literalText(branch);
        if (text !== null) {
          push(normalize(text), readContext(args[1]), branch.loc?.start.line);
          continue;
        }
        // 只有**含汉字**的插值模板串才是事故：运行时原文随变量变化，哈希 key 无从计算。
        // 纯语义 key 拼接（`t(\`groups.color.${c}\`)`）不含汉字，仍走语义 key 直通，合法。
        if (
          branch.type === 'TemplateLiteral' &&
          asNodes(branch.expressions).length > 0 &&
          HAS_ZH.test(staticPart(branch))
        ) {
          errors.push(
            `${relativePath}:${branch.loc?.start.line ?? '?'} 模板串含插值，无法计算 key，请改写成 t('共 {{count}} 个', { count: n })`
          );
        }
      }
      return;
    }

    // labelKey: '中文' —— 值会原样传进 t()，算作调用点
    if (node.type === 'ObjectProperty') {
      const key = asNode(node.key);
      const name = key?.name ?? key?.value;
      if (typeof name === 'string' && suffixes.some((suffix) => name.endsWith(suffix))) {
        push(normalize(literalText(asNode(node.value)) ?? ''), undefined, node.loc?.start.line);
      }
      return;
    }

    // <Trans>…</Trans>
    if (node.type === 'JSXElement') {
      const opening = asNode(node.openingElement);
      if (asNode(opening?.name)?.name === 'Trans') {
        const props = asNodes(opening?.attributes);
        const contextProp = props.find(
          (attribute) =>
            attribute.type === 'JSXAttribute' && asNode(attribute.name)?.name === 'context'
        );
        const context = literalText(asNode(contextProp?.value)) ?? undefined;
        push(
          normalize(jsxChildrenToString(node.children, (message) => errors.push(message))),
          context,
          node.loc?.start.line
        );
      }
    }
  });

  return { entries, errors, skipped: false };
}

/** 抽取整个源码目录。 */
export function collectSentences(
  src: string,
  root: string,
  options: CollectOptions = {}
): { entries: ScannedEntry[]; errors: string[]; scannedFiles: number } {
  const entries: ScannedEntry[] = [];
  const errors: string[] = [];
  let scannedFiles = 0;

  for (const file of walk(src)) {
    const result = collectFromFile(file, root, options);
    if (!result.skipped) scannedFiles += 1;
    errors.push(...result.errors);
    entries.push(...result.entries);
  }

  return { entries, errors, scannedFiles };
}
