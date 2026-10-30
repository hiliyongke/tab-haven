import { useTranslation } from '@/i18n';
import type { Density } from '@/core/schema/models';
import { createPlainNewTab } from '@/platform/tabs';
import { Button } from '@/ui/common/Button';
import { Callout } from '@/ui/common/Callout';
import { EmptyState } from '@/ui/common/EmptyState';
import { Icon, Icons } from '@/ui/common/Icon';

/** 标签列表三态展示：加载骨架 / 无标签 / 搜索无结果。空态复用通用 EmptyState。 */

/**
 * 数据加载中的骨架屏（区分「同步中」与「真的没有标签」）。
 * 版面不跳的关键：不手写尺寸，直接复用真实元素的盒模型（.section-head / .row-item），
 * padding/gap/density 由同一套 CSS 决定，真实行高随 density × showUrl 变化时骨架自动跟随。
 *
 * @param density 与真实列表同档，否则切到「大字号」时骨架与真实行差 4px。
 */
export function LoadingSkeleton({ density = 'cozy' }: { density?: Density }) {
  const { t } = useTranslation();
  return (
    // role=status + aria-busy：读屏用户在加载期得到「正在加载」反馈，而非空白被
    // 误判成「没有标签」。骨架本身是纯装饰 div，语义全靠这一层承载。
    <div className="flex flex-col py-1" role="status" aria-busy="true">
      <span className="sr-only">{t('正在加载…')}</span>
      <div className="section-head">
        <span className="head-leading">
          <span className="skeleton h-3.5 w-0.5 shrink-0 rounded-full" />
        </span>
        {/* h-4：与真实 .count-pill(16px) 同高，决定分区头的 28px 总高 */}
        <span className="skeleton h-4 w-20 flex-1" />
        <span className="skeleton h-4 w-6 rounded-full" />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={
            'row-item' +
            (density === 'tight' ? ' density-tight' : '') +
            (density === 'cozy' ? ' density-cozy' : '') +
            (density === 'large' ? ' density-large' : '')
          }
        >
          <span className="skeleton h-4 w-4 shrink-0" />
          <span className="skeleton h-3 flex-1" />
          <span className="skeleton h-3 w-8" />
        </div>
      ))}
    </div>
  );
}

/** 窗口内没有标签的空态（教学型）。hasSnapshots 为真时追加「从快照恢复」引导块：窗口为空
 *  常因崩溃/误关，此时「找回整窗」比「新建标签」更相关。两 prop 均可选。 */
export function EmptyTabs({
  hasSnapshots = false,
  onOpenSnapshots
}: {
  hasSnapshots?: boolean;
  onOpenSnapshots?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<Icon d={Icons.plus} className="h-4 w-4" />}
      title={t('这个窗口还没有标签')}
      hint={t('新建标签会自动显示在这里；把常用页拖到顶部常驻磁贴，随时一键直达。')}
      action={
        <div className="flex flex-col items-center gap-1.5">
          {/* 使用统一按钮变体，主题与圆角由 Button 组件保持一致。 */}
          <Button
            variant="soft-outline"
            size="xs"
            className="mt-1"
            onClick={() => void createPlainNewTab()}
          >
            {t('打开新标签')}
          </Button>
          {/* 与 UndoHistoryPanel 同款引导块：强调色块 + 文案 + 一步跳转 */}
          {hasSnapshots && onOpenSnapshots && (
            <Callout className="mx-1 max-w-56">
              <p className="text-3xs leading-relaxed">
                {t('这个窗口现在是空的。如果你刚遇到崩溃或误关，可以从快照把整个窗口找回来。')}
              </p>
              {/* accent-ghost + xs：命中下限由变体承担（原手写按钮命中区仅约 16px）。 */}
              <Button
                variant="accent-ghost"
                size="xs"
                className="mt-1 underline underline-offset-2"
                onClick={onOpenSnapshots}
              >
                {t('查看我的快照')}
              </Button>
            </Callout>
          )}
        </div>
      }
    />
  );
}

/** 数据初始化在自动重试后仍失败时，呈现说明与手动重试出口。 */
export function LoadErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<Icon d={Icons.infoAlert} className="h-4 w-4" />}
      title={t('数据加载失败')}
      hint={t(
        '本地数据暂时无法读取，可能是浏览器存储被占用或正在重启。可重试，或关闭侧边栏后重新打开。'
      )}
      action={
        <Button variant="soft-outline" size="xs" className="mt-1" onClick={onRetry}>
          {t('重试')}
        </Button>
      }
    />
  );
}

/** 搜索无结果空态。除「清除搜索」外再给「在所有窗口搜索」：搜索默认只覆盖当前窗口，
 *  只有一个「清除」出口会把「范围默认」误读成「搜索坏了 / 标签丢了」。 */
export function NoSearchResults(props: { onClear: () => void; onSearchAllWindows?: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<Icon d={Icons.search} className="h-4 w-4" />}
      title={t('没有匹配的标签')}
      hint={t('试试标题 / 网址 / 拼音首字母')}
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="soft-outline" size="xs" onClick={props.onClear}>
            {t('清除搜索')}
          </Button>
          {props.onSearchAllWindows && (
            <Button variant="soft-outline" size="xs" onClick={props.onSearchAllWindows}>
              {t('在所有窗口搜索')}
            </Button>
          )}
        </div>
      }
    />
  );
}
