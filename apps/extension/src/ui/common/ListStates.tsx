import { useTranslation } from '@/i18n';
import { createPlainNewTab } from '@/platform/tabs';
import { Button } from '@/ui/common/Button';
import { EmptyState } from '@/ui/common/EmptyState';
import { Icon, Icons } from '@/ui/common/Icon';

/**
 * 标签列表三态展示：加载骨架 / 无标签 / 搜索无结果。
 * 空态复用通用 EmptyState（侧边栏与设置页共用）。
 */

/**
 * 数据加载中的骨架屏（区分「同步中」与「真的没有标签」）。
 *
 * 版面不跳的关键：**不手写尺寸，直接复用真实元素的盒模型** ——
 * 分区头挂 .section-head、行挂 .row-item，padding / gap / density 全部由同一套
 * CSS 决定。骨架自己写 px/py 时，真实行的度量一变（密度档位、缩进调整）骨架
 * 就对不上，且「真实行高」取决于 density × showUrl 组合，靠常量根本同步不了。
 *
 * @param density 与真实列表同档，否则切到「大字号」时骨架与真实行差 4px。
 */
export function LoadingSkeleton({ density = 'cozy' }: { density?: 'compact' | 'cozy' | 'large' }) {
  return (
    <div className="flex flex-col py-1">
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

/**
 * 窗口内没有标签的空态（教学型：说明能做什么 + 一步动作）。
 *
 * hasSnapshots 为真时追加「从快照恢复」引导块：窗口为空的最可能成因之一是
 * 崩溃/误关，此时「新建标签」不是用户想要的动作 —— 找回整窗才是。这条
 * 更相关的路只在撤销历史面板里出现（snapshots.crashGuidance）时空态看不到。
 * 两个 prop 均可选：没有快照来源的调用方保持原样。
 */
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
          {/* 复用统一按钮：此处手写一份 accent 原子类，改主题/圆角时要改两处 */}
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
            <div className="mx-1 max-w-56 rounded-lg border border-accent-200 bg-accent-50 px-2.5 py-2 text-3xs leading-relaxed text-accent-700">
              <p>{t('这个窗口现在是空的。如果你刚遇到崩溃或误关，可以从快照把整个窗口找回来。')}</p>
              <button
                type="button"
                className="mt-1 rounded font-medium underline underline-offset-2 transition-base hover:bg-accent-100 hover:text-accent-700"
                onClick={onOpenSnapshots}
              >
                {t('查看我的快照')}
              </button>
            </div>
          )}
        </div>
      }
    />
  );
}

/** 数据初始化失败（自动重试仍失败）：说明 + 手动重试出口，替代无出口的骨架屏。 */
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

/**
 * 搜索无结果空态。
 *
 * 除「清除搜索」外再给一个「在所有窗口搜索」：搜索默认只覆盖当前窗口
 * （`searchAllWindows` 默认 false），多窗口用户搜不到记得开过的标签时，
 * 只有一个「清除」出口会把「范围默认」误读成「搜索坏了 / 标签丢了」。
 */
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
