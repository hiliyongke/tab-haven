import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/ui/common/EmptyState';
import { Icon, Icons } from '@/ui/common/Icon';

/**
 * 弹窗列表三态（与侧边栏 ListStates 同构）。
 *
 * 为什么不直接 import `@/entrypoints/sidepanel/ListStates`：那三个组件为侧边栏
 * 的版面而写（侧栏骨架屏的结构对齐分区头 + 行、错误态文案面向「面板常驻」），
 * 且 sidepanel/ListStates.tsx 还 import 了 `@/platform/tabs` 的建标签入口。
 * 弹窗是 420px 宽的瞬时浮层：骨架行数更少、错误态只需要「原因 + 重试」。
 * 更关键的是方向：`ui/` 与 `entrypoints/popup/**` 反向依赖 `entrypoints/sidepanel/**`
 * 会让入口之间产生横向耦合（options / about 已经这么引用了，不再新增一处）。
 * 这里按弹窗自身的密度重写，共享 `@/ui/common/EmptyState` 与同一组 i18n 键。
 */

/** 数据加载中的骨架屏：宽度与真实命中行对齐（图标 + 标题 + 尾巴），避免切换时版面跳。 */
export function PopupLoadingSkeleton() {
  const { t } = useTranslation();
  return (
    <div>
      {/* 骨架条是纯视觉占位（aria-hidden），读屏用户必须另有播报，
          否则「正在加载」在听觉上是一片空白。 */}
      <p className="sr-only" role="status">
        {t('popup.loading')}
      </p>
      <div className="flex flex-col gap-1 py-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5">
            <span className="skeleton h-4 w-4 shrink-0" />
            <span className="skeleton h-3 flex-1" />
            <span className="skeleton h-3 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 数据初始化失败：说明 + 重试出口。
 *
 * 此前此路径只写诊断日志、界面照常显示「输入以搜索」——用户看到的是一个能打字
 * 但怎么都搜不出东西的框，无法判断是「没匹配」还是「数据根本没加载」。
 */
export function PopupLoadErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<Icon d={Icons.infoAlert} className="h-4.5 w-4.5" />}
      title={t('errors.loadFailedTitle')}
      hint={t('popup.loadFailedHint')}
      action={
        <button
          type="button"
          className="mt-1 rounded-lg border border-accent-300 bg-accent-50 px-3 py-1.5 text-2xs font-medium text-accent-700 transition-base hover:bg-accent-100"
          onClick={onRetry}
        >
          {t('errors.retry')}
        </button>
      }
    />
  );
}
