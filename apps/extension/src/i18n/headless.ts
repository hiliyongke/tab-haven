import i18next from 'i18next';
import { createTranslate, type TranslationOptions } from 'i18n-kit';
import zhCN from './locales/zh-CN/translation.json';
import en from './locales/en/translation.json';
import { settingsRepository } from '@/platform/storage/repositories';

/**
 * 无 UI 环境的文案轨道（background SW 等非 React 上下文）。
 * 与 UI 轨道（`src/i18n/index.ts`）共用同一份资源，语言决策链一致：settings.language → 浏览器语言 → en 兜底。
 *
 * 说明：
 * - 不引 react-i18next，避免把 React 拉进 SW bundle；
 * - i18next 无后端时同步初始化完成，`initHeadlessI18n` 之前的 `t()` 即刻可用（浏览器语言）；
 * - SW 每次被回收后重新拉起时模块重新执行，无需额外恢复逻辑。
 */

const browserLanguage = globalThis.navigator?.language ?? '';
// 与 UI 轨道同一判定：只认中文前缀，其余落 en。方向反过来会让日文/德文用户拿到中文的右键菜单与通知，
// 而同一浏览器里面板却是英文 —— 两条轨道必须同解。
const initialLanguage = browserLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';

const instance = i18next.createInstance();
void instance.init({
  // 两条轨道共用同一份扁平词条：词条文件即编译产物（`i18n-kit apply` 生成，勿手改）。
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en }
  },
  lng: initialLanguage,
  // 与 UI 轨道一致：default_locale 是 en，两条轨道必须同解，否则英文用户的右键菜单/通知掉成中文。
  fallbackLng: 'en',
  // 关掉 ns 分隔：含 URL 的原文（如卸载页提示）不会被 ':' 截断。
  nsSeparator: false,
  // 词条文件扁平，按 '.' 深挖只会把含点号的原文切成不存在的层级。
  keySeparator: false,
  interpolation: {
    escapeValue: false
  }
});

/** 查表实现与 UI 轨道同源（packages/i18n-kit/src/translate.ts），避免两条轨道口径漂移。 */
const translate = createTranslate(instance);

/** 已启动标记：重复调用幂等（模块级状态在 SW 回收后自然重置）。 */
let started = false;

/**
 * 按设置初始化语言并订阅变更。读取失败保持浏览器语言兜底，不抛错（文案属尽力而为链路）。
 */
export async function initHeadlessI18n(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const settings = await settingsRepository.read();
    if (settings.language) await instance.changeLanguage(settings.language);
    settingsRepository.watch((next) => {
      // 与 UI 轨道 SettingsSync 一致：有覆盖值才切换，否则回到浏览器语言判定。
      if (next.language) void instance.changeLanguage(next.language);
    });
  } catch {
    // settings 读取失败：保持 initialLanguage，后续 watch 纠正
  }
}

/** 无 UI 上下文的翻译函数（与 UI 轨道的 `t()` 同一份资源、同一份查表逻辑）。同样接受母语原文。 */
export function t(sentence: string, options?: TranslationOptions): string {
  return translate(sentence, options);
}
