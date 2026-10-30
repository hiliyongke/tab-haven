import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import { useUndoStore } from '@/stores/undoStore';
import { logDegraded } from '@/platform/diagnostics';
import { Button } from '@/ui/common/Button';
import { Icon, Icons } from '@/ui/common/Icon';
import { IconButton } from '@/ui/common/IconButton';

/** 状态提示条：消息 + 可选撤销按钮。 */
export function StatusToast() {
  const { t } = useTranslation();
  const toast = useUndoStore((state) => state.toast);
  const undo = useUndoStore((state) => state.undo);
  const clearToast = useUndoStore((state) => state.clearToast);
  /**
   * 异步动作（如「全部唤醒」reloadTabs）在途互斥：actionBusy 驱动按钮 disabled，
   * actionRunRef 拦同 tick 连点（disabled 要等重渲染才生效）。与 UndoHistoryPanel
   * restoringRef、SpaceStrip switching 同款口径。
   */
  const [actionBusy, setActionBusy] = useState(false);
  const actionRunRef = useRef(false);
  // 换一条新 toast 时复位在途标尺：旧按钮已被顶替，禁用态不能粘到新动作上。
  useEffect(() => {
    actionRunRef.current = false;
    setActionBusy(false);
  }, [toast]);

  const isError = toast?.tone === 'error';

  /**
   * 常驻 live region（ARIA 可靠性约束）：播报容器必须**预先存在于 DOM 且为空**，
   * 之后内容变化才可靠播报。原实现 `if (!toast) return null` 让 role/aria-live 随内容
   * 一起挂载，首次提示（尤其 polite 的撤销 / 成功回执）可能被读屏漏报——这是公认的
   * live region 反模式。
   *
   * 拆成两个常驻 region：polite 承载普通提示、assertive 承载错误（即时打断）。两者
   * role 固定、不随内容变化，内容按需填充。**刻意不写 role**：带 role="alert"/"status"
   * 的空容器会污染 `getByRole('alert'/'status')` 查询（如落盘降级横幅测试），而
   * aria-live 本身是全局属性、可独立生效，读屏照常订阅。
   *
   * 视觉条去掉 role/aria-live，播报完全交给这两个常驻 region，避免同一条消息被读两次。
   */
  const announce = toast ? (
    <>
      <span>{toast.message}</span>
      {toast.note && <span>{toast.note}</span>}
    </>
  ) : null;

  return (
    <>
      {/* 失败提示走 assertive：读屏会打断当前播报立即念出，而不是排在普通提示之后。 */}
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {isError ? announce : null}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {!isError ? announce : null}
      </div>
      {toast && (
        <div
          className={`status-toast flex items-center gap-2 py-1.5 pl-2.5 pr-2 text-xs ${
            isError ? 'is-error text-red-600' : 'text-gray-600'
          }`}
        >
          {/* 状态图标 + 左侧色条：让提示一眼可辨（灰字灰边时失败常被忽略）。
          图标取 400/500 档：600 档在深色主题下偏暗，色条与图标会一起发闷。 */}
          <Icon
            d={isError ? Icons.infoAlert : Icons.check}
            className={`h-3.5 w-3.5 flex-none ${isError ? 'text-red-500' : 'text-accent-400'}`}
          />
          {/* note 是附属信息（淘汰告知）：与回执同槽展示，避免被回执顶掉后永久漏发。 */}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{toast.message}</span>
            {toast.note && <span className="truncate text-gray-500">{toast.note}</span>}
          </div>
          {toast.canUndo && (
            /* soft-outline：撤销是这条提示的核心动作，灰底弱按钮会让人找不到入口 */
            <Button variant="soft-outline" size="sm" onClick={() => void undo()}>
              {t('撤销')}
            </Button>
          )}
          {toast.action && (
            <Button
              variant="soft-outline"
              size="sm"
              disabled={actionBusy}
              busy={actionBusy}
              onClick={() => {
                // 同 tick 连点用 ref 拦（disabled 反应比重渲染慢一拍）。
                if (actionRunRef.current) return;
                actionRunRef.current = true;
                setActionBusy(true);
                // 动作内是异步链路（如「全部唤醒」的 reloadTabs）：reject 无人接住时会
                // 变成一条无归属的 unhandled rejection，用户只看到按钮点了没反应。
                // run 的返回类型含 void（同步动作），包一层 Promise 才能统一接住 rejection。
                void Promise.resolve(toast.action?.run())
                  .catch((error: unknown) => {
                    logDegraded('toast', '提示条动作执行失败', error);
                  })
                  .finally(() => {
                    actionRunRef.current = false;
                    setActionBusy(false);
                  });
              }}
            >
              {toast.action.label}
            </Button>
          )}
          {/* 复用 IconButton：手写的关闭按钮只有 18px 命中区（p-0.5 + 14px 图标），
          低于项目自定的 24px 下限；IconButton 自带 min-h-6 min-w-6 与禁用/悬停口径。 */}
          <IconButton icon={Icons.close} label={t('关闭提示')} size="sm" onClick={clearToast} />
        </div>
      )}
    </>
  );
}
