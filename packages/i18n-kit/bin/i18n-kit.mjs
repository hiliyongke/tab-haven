#!/usr/bin/env node
/**
 * CLI 薄壳。
 *
 * 逻辑全在 `src/cli.ts`（TypeScript 源码，与运行时共享同一份哈希实现）。
 * Node 22.6+ 原生支持加载 `.ts`（类型剥离），无需预编译步骤——这也是本工具集
 * 把实现留在 TS 里的原因：运行时与 CLI 必须同源，预编译产物只会带来漂移。
 */
import { run } from '../src/cli.ts';

const code = await run(process.argv.slice(2));
process.exit(code);
