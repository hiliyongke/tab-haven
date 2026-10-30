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
 * 英文模式照样露中文。
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

/** 解析器配置：扫描器与 lint 必须共用同一份，否则一侧改插件/开关会漏改另一侧，出现「扫描器收进词典、lint 又判为裸露中文」的矛盾。 */
export const parseOptions: ParserOptions = {
  sourceType: 'module',
  // errorRecovery：单个新语法不至于让整个仓库扫描失败；错误节点会被跳过。
  errorRecovery: true,
  plugins: ['typescript', 'jsx', 'decorators-legacy']
};

/**
 * 解析源码为 AST —— 全仓唯一的解析器返回类型断言点。
 *
 * 第三方 parser 的返回类型与本地 `AstNode` 不兼容，调用点本会各自写
 * `as unknown as AstNode`；集中到此处后，「绕开 parser 类型」这件事只有一份实现，
 * 且必然与 `parseOptions` 同源。
 */
/**
 * 解析源码为 AST —— 全仓唯一的解析器返回类型断言点。
 *
 * `.ts` 不启用 jsx 插件：`const f = <T>(x: T) => x` 在 jsx 语义下是标签起点，
 * Babel 会以「Single type parameter T should have a trailing comma」恢复解析 ——
 * 文本仍能抽到，但在「解析错误必须上报」之后会变成一条假失败。
 */
export function parseAst(content: string, jsx = true): AstNode {
  const plugins = jsx ? parseOptions.plugins : parseOptions.plugins?.filter((p) => p !== 'jsx');
  return parse(content, { ...parseOptions, plugins }) as unknown as AstNode;
}

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
  const entries: Dirent[] = readdirSync(dir, { withFileTypes: true });
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

/** 两个分支都是无子节点的 JSX 元素时，运行时始终只产生同一个空占位，key 保持稳定。 */
function isStableEmptyConditional(expression: AstNode): boolean {
  return [expression.consequent, expression.alternate].every((value) => {
    const branch = asNode(value);
    return branch?.type === 'JSXElement' && asNodes(branch.children).length === 0;
  });
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
      if (
        expression.type === 'CallExpression' ||
        expression.type === 'LogicalExpression' ||
        (expression.type === 'ConditionalExpression' && !isStableEmptyConditional(expression))
      ) {
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
      const inner = jsxChildrenToString(child.children, onError);
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
    ast = parseAst(content, file.endsWith('.tsx'));
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

  // errorRecovery 下坏语法不会抛错，而是挂在 ast.errors 上继续产出部分 AST。
  // 不读它，文件会「抽取成功但少一半词条」，守卫只看到失真的另一半。
  const recoveredErrors = (ast as unknown as { errors?: unknown[] }).errors ?? [];
  if (recoveredErrors.length > 0) {
    const first = recoveredErrors[0] as { message?: string } | undefined;
    errors.push(
      `${relativePath} 解析有 ${recoveredErrors.length} 处语法错误（${first?.message ?? '未知'}），本文件抽取可能不完整`
    );
  }

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

  /**
   * 报告「含汉字的插值模板串」这类无法静态计算 key 的原文。
   *
   * 只有含汉字的插值模板串是事故：运行时原文随变量变化，哈希 key 无从计算；
   * 纯语义 key 拼接（`t(\`groups.color.${c}\`)`）不含汉字，走语义 key 直通，合法。
   * t() 与常量表（xxxKey）两条通道共用这一检测 —— 只在一侧检测时，另一侧的
   * 插值中文会既抽不到词条、又不被 lint 判为裸露中文（markTree 把值标记为已接管），
   * 于是 scan / check / lint 全绿，而英文模式原样显示中文。
   */
  /** 子树里是否有含汉字的字面量（字符串 / 模板片段）。 */
  const containsChineseLiteral = (node: AstNode): boolean => {
    let found = false;
    visit(node, (child) => {
      if (child.type === 'StringLiteral' && HAS_ZH.test(String(child.value))) found = true;
      if (child.type === 'TemplateElement' && HAS_ZH.test(quasiText(child))) found = true;
    });
    return found;
  };

  const reportInterpolatedTemplate = (
    branch: AstNode | undefined,
    line: number | undefined
  ): void => {
    if (branch === undefined) return;
    // 模板串与字符串拼接是同一类事故：运行时原文随变量变化，哈希 key 无从计算。
    // 只看 TemplateLiteral 会漏掉 `t('共' + n + '个')`——它既抽不到词条，又会因
    // lint 把 t() 参数整棵标记为已接管而躲过「裸露中文」检查，最终 scan/check/lint 全绿。
    let hasChinese: boolean;
    if (branch.type === 'TemplateLiteral') {
      // 无插值的模板串是正常字面量（literalText 已能取走），只有插值才不可计算 key。
      if (asNodes(branch.expressions).length === 0) return;
      hasChinese = HAS_ZH.test(staticPart(branch));
    } else if (branch.type === 'BinaryExpression') {
      // '共' + n + '个'：任一操作数含汉字即不可静态求值。
      hasChinese = containsChineseLiteral(branch);
    } else {
      return;
    }
    if (!hasChinese) return;
    const kind = branch.type === 'TemplateLiteral' ? '模板串含插值' : '字符串拼接';
    errors.push(
      `${relativePath}:${line ?? '?'} ${kind}，无法计算 key，请改写成 t('共 {{count}} 个', { count: n })`
    );
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
        reportInterpolatedTemplate(branch, branch.loc?.start.line);
      }
      // context 参与哈希 key 计算：非字面量时 check 按「无 context」算 key，
      // 运行时却按变量值算 —— 英文模式仍露中文，而守卫全绿。
      const options = asNode(args[1]);
      if (options?.type === 'ObjectExpression') {
        const contextProp = asNodes(options.properties).find(
          (property) =>
            property.type === 'ObjectProperty' &&
            (asNode(property.key)?.name ?? asNode(property.key)?.value) === 'context'
        );
        if (contextProp !== undefined && literalText(asNode(contextProp.value)) === null) {
          errors.push(
            `${relativePath}:${contextProp.loc?.start.line ?? '?'} t() 的 context 不是字面量，词条 key 无法静态确定`
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
        const value = asNode(node.value);
        const text = literalText(value);
        if (text !== null) {
          push(normalize(text), undefined, node.loc?.start.line);
        } else {
          // 常量表的值可能是条件/逻辑表达式：每一支都可能是运行时原文。
          // 能静态取到的分支必须入词条；取不到的（拼接/插值）必须报错。
          // 按节点类型枚举会漏掉「裸字面量分支」——中文既不入词典、也不报错。
          for (const branch of branchNodes(value)) {
            const branchText = literalText(branch);
            if (branchText !== null) {
              push(
                normalize(branchText),
                undefined,
                branch.loc?.start.line ?? node.loc?.start.line
              );
              continue;
            }
            if (branch.type === 'TemplateLiteral' || branch.type === 'BinaryExpression') {
              reportInterpolatedTemplate(branch, branch.loc?.start.line ?? node.loc?.start.line);
              continue;
            }
            if (!containsChineseLiteral(branch)) continue;
            errors.push(
              `${relativePath}:${branch.loc?.start.line ?? '?'} 常量表 ${name} 的值无法静态求值，请改用字面量`
            );
          }
        }
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
        // context 参与 key 计算：`context={'action'}` 要穿过表达式容器取字面量，
        // 取不到就必须报错（否则运行时 key 与抽取 key 不一致，英文模式露中文）。
        const contextValue = asNode(contextProp?.value);
        const contextText =
          contextValue?.type === 'JSXExpressionContainer'
            ? literalText(asNode(contextValue.expression))
            : literalText(contextValue);
        if (contextProp !== undefined && contextText === null) {
          errors.push(
            `${relativePath}:${contextProp.loc?.start.line ?? '?'} <Trans> 的 context 不是字面量，词条 key 无法静态确定`
          );
        }
        push(
          normalize(jsxChildrenToString(node.children, (message) => errors.push(message))),
          contextText ?? undefined,
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
