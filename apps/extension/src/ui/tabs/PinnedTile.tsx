import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { useTranslation } from '@/i18n';
import { hostnameOf } from '@/core/url/UrlInspector';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import { ContextMenu, useRowContextMenu, type ContextMenuItem } from '@/ui/common/ContextMenu';
import { useDomainAccent } from '@/ui/tabs/accent';

/** dnd-kit 排序接入点（顶部永久固定区 PinnedStrip 传入；无排序的场景不传）。 */
interface PinnedTileSortable {
  setNodeRef: (node: HTMLElement | null) => void;
  /**
   * 用 dnd-kit 的具名类型而非 `object`：宽类型会让 props 拼写错误（如把
   * `listeners` 写成 `listener`）在接入点静默通过 —— 而拖拽监听丢失的表现
   * 只是「这块拖不动」，没人会想到是类型没接住。
   */
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  style: CSSProperties;
  isDragging: boolean;
  /**
   * 落点反馈：`target` 可投放 / `rejected` 结构上不接受当前拖拽类型。
   * 磁贴贴在条内、离容器边界远，容器高亮会被磁贴自己挡住 —— 必须由磁贴本体表达。
   */
  dropState?: 'target' | 'rejected';
}

/**
 * 固定标签磁贴（浏览器原生固定区 / 顶部永久固定区共用）：
 * 主按钮（单击激活、中键关闭）+ 悬停取消固定。
 * 传 `sortable` 时参与 dnd-kit 排序。
 *
 * 不提供「复制」：固定标签的语义是单例常驻入口，复制会产生非固定副本，
 * 与「同 URL 唯一化」的去重主轴相悖；复制普通标签在临时区行内已有入口。
 */
export function PinnedTile({
  title,
  favIconUrl,
  url,
  isActive = false,
  isDiscarded = false,
  isAudible = false,
  onClick,
  onMiddleClick,
  onUnpin,
  unpinTitle,
  sortable
}: {
  title: string;
  favIconUrl?: string;
  url?: string;
  isActive?: boolean;
  isDiscarded?: boolean;
  isAudible?: boolean;
  onClick: () => void;
  /** 中键关闭（仅关闭页面，固定入口保留）。 */
  onMiddleClick?: () => void;
  onUnpin?: () => void;
  /** 移除按钮文案（默认「取消固定」，永久固定区传「移除固定入口」）。 */
  unpinTitle?: string;
  sortable?: PinnedTileSortable;
}) {
  const { t } = useTranslation();
  // 磁贴主色：优先 favicon（data: URL 可取色）主色，否则域名哈希色——与站点组圆点同源。
  // hostname 判定复用 core 唯一实现：此处内联一份会与固定空间 / 休眠白名单
  // 的口径来源不同，修一处漏一处。
  const domain = useMemo(() => hostnameOf(url) || undefined, [url]);
  const accent = useDomainAccent(favIconUrl, domain);
  const tileClass =
    'pinned-tile' +
    (isActive ? ' is-active' : '') +
    (isDiscarded ? ' is-discarded' : '') +
    (isAudible ? ' is-audible' : '') +
    (sortable?.isDragging ? ' is-dragging' : '') +
    (sortable?.dropState === 'target'
      ? ' is-drop-target'
      : sortable?.dropState === 'rejected'
        ? ' is-drop-rejected'
        : '');

  /* 右键菜单：磁贴只有一个 16px 的取消固定按钮（hover 才出现），触屏与键盘用户
     都没有替代路径。右键补齐带文字的操作列表。 */
  const { menu, open: openMenu, close: closeMenu } = useRowContextMenu();
  const menuItems = useMemo<ContextMenuItem[]>(() => {
    const items: ContextMenuItem[] = [{ id: 'open', label: t('打开'), onSelect: onClick }];
    if (onUnpin) {
      items.push({ id: 'unpin', label: t('取消固定'), danger: true, onSelect: onUnpin });
    }
    return items;
  }, [onClick, onUnpin, t]);

  return (
    <article
      className={tileClass}
      style={accent ? ({ '--tile-accent': accent } as CSSProperties) : undefined}
      onContextMenu={openMenu}
    >
      <button
        ref={sortable?.setNodeRef}
        type="button"
        className="pinned-main"
        style={sortable?.style}
        title={title || url}
        aria-label={title || url}
        onClick={onClick}
        onAuxClick={(event) => {
          if (event.button === 1) onMiddleClick?.();
        }}
        {...sortable?.attributes}
        {...sortable?.listeners}
      >
        <span className="pinned-favicon-wrap">
          <Favicon pageUrl={url} title={title || ''} cssSized />
        </span>
        {/* 无 hover 的设备（触屏）拿不到 title tooltip，36×36 的纯图标磁贴完全
            不可辨识。名称默认不渲染（视觉设计取舍：磁贴只放 favicon），
            仅在 @media (hover: none) 下由 CSS 显形。 */}
        <span className="pinned-tile-name" aria-hidden="true">
          {title || url}
        </span>
      </button>
      {onUnpin && (
        <button
          type="button"
          className="row-action pinned-unpin"
          title={unpinTitle ?? t('取消固定')}
          aria-label={unpinTitle ?? t('取消固定')}
          onClick={onUnpin}
        >
          <Icon d={Icons.close} className="h-3 w-3" />
        </button>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
    </article>
  );
}
