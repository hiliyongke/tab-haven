import type { Translate } from 'i18n-kit';

/**
 * 双语 SEO 元信息。
 *
 * 中文原文写在 t() 里，由 i18n-kit 扫描进词典（site/i18n/source/zh-CN.json），
 * 英文译文人工填在 site/i18n/translation/en.json。
 */
export function siteMeta(t: Translate): { title: string; description: string } {
  return {
    title: t('Tabs —— 本地优先、无账号无云端浏览器的标签工作台'),
    description: t(
      '把散乱的标签整理成一个本地侧边栏：按站点聚合、收进文件夹、关错了也能一键找回。数据只留在本机，扩展不发起任何网络请求。'
    )
  };
}
