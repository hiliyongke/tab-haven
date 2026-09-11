import { useEffect, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 设置页侧栏目录（大纲）。
 *
 * 设置页有十余个分区、跨越数屏，纯靠滚动找设置效率低 —— 尤其「高级与恢复」
 * 这类低频分区位于页尾，用户往往不知道它存在。目录提供两条路径：
 * 锚点直达 + 滚动高亮当前分区，让长页面像文档一样可导航。
 *
 * 同时它是「取消折叠」的前提：此前用 details 折叠低频分区来缩短页面，
 * 代价是内容被隐藏；有了目录之后，缩短页面不再需要牺牲可发现性。
 */
export interface OutlineItem {
  /** 目标分区的 DOM id（通常为 titleKey）。 */
  id: string;
  label: string;
}

export function SettingsOutline({ items }: { items: OutlineItem[] }) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? '');

  useEffect(() => {
    if (items.length === 0) return;
    /**
     * 高亮规则：以视口上方 30% 为「阅读线」，取线附近最靠上的可见分区。
     * 用 IntersectionObserver 而非 scroll 事件：后者每帧触发且需手算 rect，
     * 而这里只关心「哪个分区进入了阅读区」。
     * rootMargin 下边距收 70% 是为了忽略页面底部尚未读到的分区，
     * 避免滚动到底时高亮乱跳。
     */
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  const jumpTo = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    // 保留 <a href="#id"> 语义（可复制链接 / 可中键新标签打开），仅接管滚动方式
    event.preventDefault();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    setActiveId(id);
    // 同步 hash：刷新后仍停在原处，也便于分享具体设置位置
    window.history.replaceState(null, '', `#${id}`);
  };

  return (
    <nav aria-label={t('settings.outline')} className="hidden w-40 shrink-0 lg:block">
      <div className="sticky top-10">
        <p className="mb-2 px-2 text-2xs font-semibold tracking-wide text-gray-500">
          {t('settings.outline')}
        </p>
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const active = item.id === activeId;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={active ? 'true' : undefined}
                  onClick={(event) => jumpTo(event, item.id)}
                  className={
                    'block truncate rounded px-2 py-1 text-xs transition-base ' +
                    (active
                      ? 'bg-accent-50 font-medium text-accent-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800')
                  }
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
