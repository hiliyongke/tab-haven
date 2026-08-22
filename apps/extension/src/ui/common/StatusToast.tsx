import { useTranslation } from '@/i18n';
import { useUndoStore } from '@/stores/undoStore';
import { logDegraded } from '@/platform/diagnostics';
import { Button } from '@/ui/common/Button';
import { Icon, Icons } from '@/ui/common/Icon';

/** 状态提示条：消息 + 可选撤销按钮。 */
export function StatusToast() {
  const { t } = useTranslation();
  const toast = useUndoStore((state) => state.toast);
  const undo = useUndoStore((state) => state.undo);
  const clearToast = useUndoStore((state) => state.clearToast);

  if (!toast) return null;

  // 失败提示走 role="alert"：读屏会打断当前播报立即念出，而不是排在
  // 「已保存」这类普通提示之后。视觉上同时转为危险色，让失败不被误读为普通状态。
  const isError = toast.tone === 'error';

  return (
    <div
      className={`status-toast flex items-center gap-2 py-1.5 pl-2.5 pr-2 text-xs ${
        isError ? 'is-error text-red-600' : 'text-gray-600'
      }`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
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
          onClick={() => {
            // 动作内是异步链路（如「全部唤醒」的 reloadTabs）：reject 无人接住时会
            // 变成一条无归属的 unhandled rejection，用户只看到按钮点了没反应。
            // run 的返回类型含 void（同步动作），包一层 Promise 才能统一接住 rejection。
            void Promise.resolve(toast.action?.run()).catch((error: unknown) => {
              logDegraded('toast', '提示条动作执行失败', error);
            });
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <button
        type="button"
        className="rounded p-0.5 text-gray-500 transition-base hover:text-gray-700"
        aria-label={t('关闭提示')}
        onClick={clearToast}
      >
        <Icon d={Icons.close} className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
