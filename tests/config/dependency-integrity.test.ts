import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 守护「整仓只可能有一份 react / i18next / react-i18next」。
 *
 * 要防的事故：`packages/i18n-kit` 把这几个包声明成 peer（范围宽松），
 * pnpm 默认 `auto-install-peers=true` 会按它自己的范围**再装一份**到
 * `packages/i18n-kit/node_modules`。只升根包时两边版本分叉 → 产物里两份
 * react-i18next：`initReactI18next` 在 A 副本注册实例，`useTranslation` 在 B 副本
 * `getI18n()` 取不到，react-i18next 用 `i18n || {}` 兜底返回空对象，而空对象是真值，
 * 兜底失效 → 侧边栏挂载即崩 `r.changeLanguage is not a function`。
 *
 * 这条测试把结论变成**会红的断言**：谁把副本搞成两份，`pnpm test` 立刻告诉他原因。
 */

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const workspacePackage = `${projectRoot}packages/i18n-kit`;
// 渲染链路的宿主是扩展包与官网，不是工作区根（根 package.json 是纯编排、不装 react）。
const extensionPackage = `${projectRoot}apps/extension`;
const sitePackage = `${projectRoot}apps/site`;

/**
 * 会被 React 渲染链路共享、因此绝不能出现第二份的包 —— **从 overrides 解析**，
 * 不手写清单。
 *
 * 手写清单的失效形态：往 `pnpm-workspace.yaml` 的 overrides 里新钉一个包（比如
 * 将来共享 `@tanstack/react-query`），而这里没同步，于是「两个 importer 各解析出
 * 一份」这种分叉被整条守卫漏掉，且漏得毫无征兆。
 */
const SHARED_PACKAGES = parseOverrides();

/**
 * 会渲染（或会注册 i18n 实例）的 importer：副本分叉只会在这几者之间出事。
 * 同样**动态枚举**（`pnpm-workspace.yaml` 的 `packages:` + 目录探测），
 * 新增 workspace 包时自动进入比对。
 */
const IMPORTERS = parseWorkspacePackages();

/** 从 pnpm-workspace.yaml 的 `overrides:` 块取出被钉住的包名。 */
function parseOverrides(): string[] {
  const yaml = readFileSync(`${projectRoot}pnpm-workspace.yaml`, 'utf8');
  const overrides = yaml.slice(yaml.indexOf('overrides:'));
  // 不引入 YAML 解析器：这里只认「两个空格缩进 + 键 + 版本范围」这一形态，
  // overrides 块被挪走/改名时解析结果为空，由下面的自检用例挡住（而不是静默失效）。
  return [...overrides.matchAll(/^ {2}([^ #][^:]*):\s*[<^~]?\d/gm)].map((match) => match[1]!);
}

/** 从 pnpm-workspace.yaml 的 `packages:` 块枚举出实际存在的包目录。 */
function parseWorkspacePackages(): string[] {
  const lines = readFileSync(`${projectRoot}pnpm-workspace.yaml`, 'utf8').split('\n');
  const start = lines.findIndex((line) => /^packages:/.test(line));
  if (start === -1) throw new Error('pnpm-workspace.yaml 未声明 packages');
  const dirs: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    // 顶层键（缩进回到 0）即 packages 块结束
    if (/^\S/.test(line)) break;
    const entry = line.match(/^\s*-\s*([^\s#]+)/);
    if (!entry) continue; // 空行 / 纯注释
    const pattern = entry[1]!;
    if (pattern.endsWith('/*')) {
      const parent = pattern.slice(0, -2);
      for (const child of readdirSync(`${projectRoot}${parent}`, { withFileTypes: true })) {
        if (!child.isDirectory()) continue;
        const dir = `${projectRoot}${parent}/${child.name}`;
        if (existsSync(`${dir}/package.json`)) dirs.push(dir);
      }
      continue;
    }
    if (existsSync(`${projectRoot}${pattern}/package.json`)) dirs.push(`${projectRoot}${pattern}`);
  }
  return dirs;
}

/**
 * 各 importer 声明的依赖（含 dev/peer：库包把宿主包声明在 peer 上，
 * 解析副本时同样算数）。
 *
 * 从 package.json 读取而不是手写「谁依赖什么」的表：手写表会漏 —— 官网后来也
 * 装了 react-i18next / i18next，而比对表里没有它，于是「extension 与 site 各一份
 * react-i18next」这种分叉从未被这条守卫看到。
 */
function declaredDeps(dir: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
}

/**
 * 每个共享包要在**哪些 importer 之间**比对：只取真正声明了它的一方。
 *
 * 两边都得真正依赖它，比对才有意义：react-dom 从来不是 i18n-kit 的依赖（i18n-kit 只用
 * react 的类型）。若工作区根的 node_modules 里躺着 react-dom，它会被 i18n-kit 沿目录
 * 向上捡到，比对的就成了一个跟它无关的包 —— 宿主不该替库包提供依赖。
 */
function importersOf(id: string): string[] {
  return IMPORTERS.filter((dir) => declaredDeps(dir)[id] !== undefined);
}

/** 解析入口并还原软链，得到可直接比较的物理路径。 */
function resolveEntry(from: string, id: string): string {
  const require = createRequire(`${from}/package.json`);
  return realpathSync(require.resolve(id, { paths: [from] }));
}

/** 由入口路径反推包目录：`.../.pnpm/react@19.2.8/node_modules/react/index.js` → `.../react/`。 */
export function packageDirOf(entry: string, id: string): string {
  const normalizedEntry = entry.replaceAll('\\', '/');
  const marker = `/node_modules/${id}/`;
  const at = normalizedEntry.lastIndexOf(marker);
  if (at < 0) throw new Error(`无法从 ${entry} 定位 ${id} 的包目录`);
  return normalizedEntry.slice(0, at + marker.length);
}

function versionFrom(from: string, id: string): string {
  const dir = packageDirOf(resolveEntry(from, id), id);
  return (JSON.parse(readFileSync(`${dir}package.json`, 'utf8')) as { version: string }).version;
}

describe('依赖单副本（跨 workspace 包）', () => {
  it('Windows 反斜杠入口也能定位包目录', () => {
    expect(
      packageDirOf(
        'C:\\repo\\node_modules\\.pnpm\\react@19.2.8\\node_modules\\react\\index.js',
        'react'
      )
    ).toBe('C:/repo/node_modules/.pnpm/react@19.2.8/node_modules/react/');
  });

  it('共享包清单与 importer 清单都解析自配置（空清单会让逐包比对恒绿）', () => {
    // 两份清单都是动态解析的：解析失败（配置改名/挪走）会退化成空数组，
    // 而「0 个待比对项」正是这条守卫最危险的失效形态 —— 必须显式挡住。
    expect(SHARED_PACKAGES.length).toBeGreaterThanOrEqual(2);
    expect(IMPORTERS).toContain(extensionPackage);
    expect(IMPORTERS).toContain(sitePackage);
    expect(IMPORTERS).toContain(workspacePackage);
  });

  it.each(SHARED_PACKAGES)('%s 在所有依赖它的 importer 里解析出同一份', (id) => {
    const importers = importersOf(id);
    // 少于两个 importer 就构不成比对，而空集合会让下面的循环恒绿（0 个配对）——
    // 那正是这条守卫在「依赖表没跟上」时的失效形态，必须显式挡住。
    expect(
      importers.length,
      `${id} 的依赖方不足两个（${importers.join(', ') || '无'}），无法比对副本`
    ).toBeGreaterThanOrEqual(2);

    const first = resolveEntry(importers[0]!, id);
    for (const dir of importers.slice(1)) {
      expect(
        resolveEntry(dir, id),
        `${id} 出现两份副本（${importers[0]} 与 ${dir}），侧边栏会因空 i18n 实例崩溃：检查 pnpm-workspace.yaml 的 autoInstallPeers`
      ).toBe(first);
    }
  });

  it('react 与 react-dom 版本一致（不一致 = 两份 React，挂载必报 Invalid hook call）', () => {
    expect(versionFrom(extensionPackage, 'react-dom')).toBe(versionFrom(extensionPackage, 'react'));
  });
});
