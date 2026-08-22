import { readFileSync, realpathSync } from 'node:fs';
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

/** 会被 React 渲染链路共享、因此绝不能出现第二份的包。 */
const SHARED_PACKAGES = ['react', 'react-dom', 'react-i18next', 'i18next'] as const;

/**
 * 每个包要在**哪两个 importer 之间**比对。
 *
 * 两边都得真正依赖它，比对才有意义：react-dom 从来不是 i18n-kit 的依赖（i18n-kit 只用
 * react 的类型）。若工作区根的 node_modules 里躺着 react-dom，它会被 i18n-kit 沿目录
 * 向上捡到，比对的就成了一个跟它无关的包 —— 宿主不该替库包提供依赖。
 */
const COMPARISON_PAIRS: Record<string, readonly [string, string]> = {
  react: [extensionPackage, workspacePackage],
  'react-i18next': [extensionPackage, workspacePackage],
  i18next: [extensionPackage, workspacePackage],
  // react-dom 只在这两个**真正渲染**的应用之间比对
  'react-dom': [extensionPackage, sitePackage]
};

/** 解析入口并还原软链，得到可直接比较的物理路径。 */
function resolveEntry(from: string, id: string): string {
  const require = createRequire(`${from}/package.json`);
  return realpathSync(require.resolve(id, { paths: [from] }));
}

/** 由入口路径反推包目录：`.../.pnpm/react@19.2.8/node_modules/react/index.js` → `.../react/`。 */
function packageDirOf(entry: string, id: string): string {
  const marker = `/node_modules/${id}/`;
  const at = entry.lastIndexOf(marker);
  if (at < 0) throw new Error(`无法从 ${entry} 定位 ${id} 的包目录`);
  return entry.slice(0, at + marker.length);
}

function versionFrom(from: string, id: string): string {
  const dir = packageDirOf(resolveEntry(from, id), id);
  return (JSON.parse(readFileSync(`${dir}package.json`, 'utf8')) as { version: string }).version;
}

describe('依赖单副本（跨 workspace 包）', () => {
  it('workspace 配置里钉住了这几个共享包（否则库包会按自己的范围解析出第二份）', () => {
    const yaml = readFileSync(`${projectRoot}pnpm-workspace.yaml`, 'utf8');
    const overrides = yaml.slice(yaml.indexOf('overrides:'));

    // 不解析 YAML、只认键：配置被挪走/改名时这里会红，而不是静默失效。
    for (const id of SHARED_PACKAGES) {
      // 允许精确版本或范围（^/~ 等），只要键在：配置被删/改名时这里会红。
      expect(overrides, `${id} 未被 overrides 钉住，可能出现两份副本`).toMatch(
        new RegExp(`^\\s*${id}:\\s*[<^~]?\\d`, 'm')
      );
    }
  });

  it.each(Object.entries(COMPARISON_PAIRS))('%s 在两个 importer 里解析出同一份', (id, pair) => {
    expect(
      resolveEntry(pair[0], id),
      `${id} 出现两份副本，侧边栏会因空 i18n 实例崩溃：检查 pnpm-workspace.yaml 的 autoInstallPeers`
    ).toBe(resolveEntry(pair[1], id));
  });

  it('react 与 react-dom 版本一致（不一致 = 两份 React，挂载必报 Invalid hook call）', () => {
    expect(versionFrom(extensionPackage, 'react-dom')).toBe(versionFrom(extensionPackage, 'react'));
  });
});
