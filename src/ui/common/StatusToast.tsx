import { useTranslation } from 'react-i18next';
import { useUndoStore } from '@/stores/undoStore';
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
      className={`status-toast flex items-center gap-2 px-3 py-1.5 text-xs ${
        isError ? 'text-red-600' : 'text-gray-600'
      }`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      <span className="flex-1 truncate">{toast.message}</span>
      {toast.canUndo && (
        <Button variant="soft" size="sm" onClick={() => void undo()}>
          {t('undo.action')}
        </Button>
      )}
      {toast.action && (
        <Button variant="soft" size="sm" onClick={() => void toast.action?.run()}>
          {toast.action.label}
        </Button>
      )}
      <button
        type="button"
        className="rounded p-0.5 text-gray-500 transition-base hover:text-gray-700"
        aria-label={t('undo.dismiss')}
        onClick={clearToast}
      >
        <Icon d={Icons.close} className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
