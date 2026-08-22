import { useTranslation } from 'react-i18next';
import { useUndoStore } from '@/stores/undoStore';

/** 状态提示条：消息 + 可选撤销按钮（FR-D8.1 的撤销入口）。 */
export function StatusToast() {
  const { t } = useTranslation();
  const toast = useUndoStore((state) => state.toast);
  const undo = useUndoStore((state) => state.undo);
  const clearToast = useUndoStore((state) => state.clearToast);

  if (!toast) return null;

  return (
    <div
      className="status-toast flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600"
      role="status"
      aria-live="polite"
    >
      <span className="flex-1 truncate">{toast.message}</span>
      {toast.canUndo && (
        <button
          type="button"
          className="rounded bg-accent-50 px-2 py-0.5 font-medium text-accent-600 hover:bg-accent-100"
          onClick={() => void undo()}
        >
          {t('undo.action')}
        </button>
      )}
      <button
        type="button"
        className="text-gray-400 hover:text-gray-600"
        aria-label={t('undo.dismiss')}
        onClick={clearToast}
      >
        ×
      </button>
    </div>
  );
}
