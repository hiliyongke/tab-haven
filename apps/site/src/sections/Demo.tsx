import { MockupPanel, type MockupVariant } from '../components/MockupPanel';
import { Section } from '../components/Section';
import { useSiteI18n } from '../i18n';

/**
 * 演示区。
 *
 * 渐进增强：SSR 产物是无脚本静态内容，四帧纵向可读且不暴露 tablist / tabpanel 语义；
 * client.ts 接管后才建立 tablist 关系、收起非首帧并加上 ←→ / Home / End 键盘操作。
 */
const DEMO_TABS: readonly { id: MockupVariant; labelKey: string; captionKey: string }[] = [
  {
    id: 'main',
    labelKey: '主界面',
    captionKey: '默认形态：搜索框常驻顶部，同域名标签自动聚合成分组，分组头带计数与静音、分屏徽章。'
  },
  {
    id: 'search',
    labelKey: '搜索',
    captionKey: '标题、网址、拼音首字母都能搜，命中位置高亮，方向键与回车全程可操作。'
  },
  {
    id: 'fixed',
    labelKey: '收藏夹',
    captionKey: '文件夹与常驻磁贴：拖进去就收好，可挂起转正、一键打开全部，也能导出为书签。'
  },
  {
    id: 'undo',
    labelKey: '撤销历史',
    captionKey:
      '关错了就一层层撤回来：撤销历史面板可恢复任意批次，也列出浏览器最近关闭的标签与窗口。'
  }
];

export function Demo() {
  const { t } = useSiteI18n();

  return (
    <Section
      id="demo"
      eyebrow={t('演示')}
      title={t('四个画面看懂它每天在做什么')}
      intro={t('下面是按真实布局还原的侧边栏：分组、搜索、收藏夹与撤销历史。')}
    >
      <div className="demo">
        <div
          className="demo-tabs demo-enhanced-only"
          data-role="tablist"
          data-label={t('界面演示')}
        >
          {DEMO_TABS.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              data-role="tab"
              id={`demo-tab-${tab.id}`}
              data-controls={`demo-panel-${tab.id}`}
              data-selected={index === 0}
              aria-hidden="true"
              tabIndex={-1}
              className="demo-tab"
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {DEMO_TABS.map((tab) => (
          <div
            key={tab.id}
            data-role="tabpanel"
            id={`demo-panel-${tab.id}`}
            data-labelledby={`demo-tab-${tab.id}`}
            className="demo-panel"
          >
            <figure className="demo-figure">
              <MockupPanel variant={tab.id} />
              <figcaption>{t(tab.captionKey)}</figcaption>
            </figure>
          </div>
        ))}
      </div>
    </Section>
  );
}
