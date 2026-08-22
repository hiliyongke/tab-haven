import { MockupPanel, type MockupVariant } from '../components/MockupPanel';
import { Section } from '../components/Section';
import { useSiteI18n } from '../i18n';

/**
 * 演示区。
 *
 * 渐进增强的取舍要说清：预渲染时四个面板**全部可见**（无脚本就是四帧纵向排列，
 * 内容照样读得到），client.ts 接管后才收成 tablist 并加上 ←→ / Home / End 键盘操作。
 * 因此无脚本状态下 `aria-selected` 只有一个为 true 却四帧都可见，这是刻意的，
 * 不是 bug —— 收起动作只由 client.ts 的 `panel.hidden` 完成，HTML 里没有任何
 * 预置的隐藏标记。
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
        <div className="demo-tabs" role="tablist" aria-label={t('界面演示')}>
          {DEMO_TABS.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`demo-tab-${tab.id}`}
              aria-controls={`demo-panel-${tab.id}`}
              aria-selected={index === 0}
              tabIndex={index === 0 ? 0 : -1}
              className="demo-tab"
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {DEMO_TABS.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={`demo-panel-${tab.id}`}
            aria-labelledby={`demo-tab-${tab.id}`}
            tabIndex={0}
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
