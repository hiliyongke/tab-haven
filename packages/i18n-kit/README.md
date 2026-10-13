# i18n-kit

写**母语原文**、自动出哈希 key 词典的 i18n 工具集：扫描源码抽词、编译运行时词条、守卫未登记与未翻译。
零网络、零翻译平台依赖——译文走本地文件流转。

## 开发体验

写业务代码时只写中文，不用想 key、不用先去词条文件登记：

```tsx
const { t } = useTranslation();
t('外观与布局');
t('共 {{count}} 个标签', { count: n }); // 插值：整句 + 占位符
t('打开', { context: 'verb' }); // 同句不同语境
<Trans>
  已选 <Slot content={count} /> 个标签
</Trans>; // 中间夹组件
```

写完跑一条命令：

```bash
i18n-kit scan     # 抽出原文 → i18n/source/zh-CN.json，缺译 → i18n/untranslated/en.json
                  #   --dry  只列新增/失效，不落盘
                  #   --prune 失效词条归档后，一并从译文文件移除（否则 check 的「孤立译文」一直红）
i18n-kit apply    # 词典 → src/i18n/locales/<lng>/translation.json（运行时资源）
i18n-kit check    # 守卫：产物已编译 / 无孤立译文 / 无未登记 / 无未翻译 / 白名单不过期
i18n-kit lint     # 检查未被词典接管的裸露中文
i18n-kit migrate  # 一次性：把既有语义 key 词条迁成哈希 key 词典
```

译文补齐流程：把 `i18n/untranslated/en.json` 里的条目译好，填回
`i18n/translation/en.json`，再跑 `apply`。

改文案后：原文一变就是一个新 key，旧译文成了「词典里已无此条」的孤立译文
（`check` 规则 2 会失败）。旧译文已自动归档进 `i18n/retired/<lng>.json`（改回旧文案时
还能捞回来），确认不再需要就跑 `i18n-kit scan --prune` 把译文文件里那份删掉。

## 接入

### 1. 运行时（一次）

```ts
// src/i18n/index.ts
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { createTranslate } from 'i18n-kit';
import { createUseTranslation, Slot, Trans } from 'i18n-kit/react';
import zhCN from './locales/zh-CN/translation.json';
import en from './locales/en/translation.json';

i18next.use(initReactI18next).init({
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  lng: 'zh-CN',
  fallbackLng: 'en',
  // 词条是平铺的哈希 key，且原文里可能含 URL：两个分隔符都必须关掉，
  // 否则 i18next 会把 `https://…` 切成不存在的命名空间/层级。
  nsSeparator: false,
  keySeparator: false
});

export const translate = createTranslate(i18next);
export const useTranslation = createUseTranslation(i18next, translate);
export { Trans, Slot };
```

非 React 上下文（如 Service Worker）用 `createTranslate(instance)` 即可，两条轨道共用同一份实现。

### 2. 目录约定（可覆盖）

| 路径                                      | 说明                                       |
| ----------------------------------------- | ------------------------------------------ |
| `i18n/source/<母语>.json`                 | 母语原文词典（扫描产物，勿手改）           |
| `i18n/translation/<lng>.json`             | 译文（键与 source 对齐，人维护）           |
| `i18n/untranslated/<lng>.json`            | 待翻译清单（生成物）                       |
| `i18n/retired/<lng>.json`                 | 失效词条的译文归档（改回旧文案时可复用）   |
| `src/i18n/locales/<lng>/translation.json` | 运行时资源（apply 产物，**平铺**，勿手改） |

覆盖：`--root --src --dict --locales --lngs en,ja`。

### 3. 可选配置 `i18n-kit.config.mjs`

```js
export default {
  emptyAllowed: ['共'], // 允许译文为空串的原文（量词/语气词）
  sameAsNativeAllowed: ['简体中文'], // 允许译文与原文相同（语言名用本名）
  dynamicKeys: [], // 动态拼接的语义 key 固定豁免
  dynamicKeyPatterns: [] // 同上，正则（字符串形式）
};
```

## 约定与限制

- **key 形如 `i18n_1a2b3c4`**：由「原文去空白后的 djb2-xor 摘要」取 36 进制末 7 位。
  哈希算法在 `src/hashKey.ts` **单一实现**，运行时与 CLI 都 import 它——抄一份就一定会漂移，
  而漂移的表现是「英文模式整片露中文且查不出原因」。
- **含汉字的插值模板串不支持**：``t(`共 ${n} 个`)`` 运行时原文随变量变化，key 无从计算；
  改写成 `t('共 {{count}} 个', { count: n })`。纯语义 key 拼接不含汉字，不受此限。
- **context 必须是字面量**：变量无法被静态扫描，扫不到的词条运行时必然查不到。
- **常量表通道的后缀可配置**：`{ labelKey: '中文' }` 的值会原样传进 `t()`，扫描器默认只认
  以 `Key` 结尾的属性名；项目里若用 `title` / `placeholder` 之类命名，在
  `i18n-kit.config.mjs` 里配 `keySuffixes: ['Key', 'Title']`（默认 `['Key']`，配 `[]` 关闭）。
  扫描器与 `lint` 读同一份配置——只加 `@i18n-ignore` 压住告警、词条依然进不来。
- **词条一律平铺**（`{ "i18n_xxx": "译文" }`），不做对象嵌套：嵌套会让键路径与原文两套体系互相纠缠。
- **译文可复用**：失效词条的译文进 `i18n/retired/`，文案改回旧版本时不会白丢。

### 豁免未标记中文（lint）

- 行级：本行或上一行写 `// @i18n-ignore`；
- 块级：`// @i18n-ignore-start` … `// @i18n-ignore-end`（原文常量表用这个）；
- 文件级：文件顶部写 `// @i18n-noscan`（该文件既不扫词也不检查）；
- 诊断日志（`logFailure` / `logDegraded` / `logInfo` / `console.*`）自动豁免——那是给开发者看的，
  翻译它反而让排障时看到的语种随用户语言变化。其它诊断函数名在 `src/commands/lint.ts` 的
  `DIAGNOSTIC_CALLS` 里登记。

## 环境要求

Node >= 22.6：CLI 直接由 Node 加载 TypeScript 源码（类型剥离），不引入预编译步骤，
以保证 CLI 与运行时共用同一份实现。包内相对导入因此一律带 `.ts` 后缀
（原生 ESM 不做扩展名补全）；消费方若用 TS 需开启 `allowImportingTsExtensions`。
