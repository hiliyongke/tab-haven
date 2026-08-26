import i18next from 'i18next';
import zhCN from './locales/zh-CN/translation.json';
import en from './locales/en/translation.json';
import { settingsRepository } from '@/platform/storage/repositories';

/**
 * 无 UI 环境的文案轨道（FR-D10.2）：供 background SW 等非 React 上下文使用。
 *
 * 与 `src/i18n/index.ts`（UI 轨道）共用同一份资源文件，语言决策链一致：
 * settings.language（用户覆盖，实时跟随）→ 浏览器 UI 语言 → zh-CN 兜底。
 *
 * 说明：
 * - 不引 react-i18next，避免把 React 拉进 SW bundle；
 * - i18next 无后端时同步初始化完成，initHeadlessI18n 之前的 t() 调用
 *   即刻可用（浏览器语言），设置读取完成后按需切换；
 * - SW 每次被回收后重新拉起时模块重新执行，无需额外恢复逻辑。
 */

const browserLanguage = globalThis.navigator?.language ?? '';
const initialLanguage = browserLanguage.toLowerCase().startsWith('en') ? 'en' : 'zh-CN';

const instance = i18next.createInstance();
void instance.init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en }
  },
  lng: initialLanguage,
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false
  }
});

/** 已启动标记：重复调用幂等（模块级状态在 SW 回收后自然重置）。 */
let started = false;

/**
 * 按设置初始化语言并订阅变更（设置存储变更 → 实时切换文案语言）。
 * 读取失败保持浏览器语言兜底，不抛错（文案属尽力而为链路）。
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

/** 无 UI 上下文的翻译函数（与 UI 轨道的 t() 同一份文案资源）。 */
export function t(key: string, options?: Record<string, unknown>): string {
  return instance.t(key, options) as string;
}
