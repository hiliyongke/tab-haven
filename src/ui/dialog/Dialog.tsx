import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 自制弹窗族（FR-D10.3）：替代浏览器原生 prompt/confirm。
 * 行为契约：打开聚焦首项、Enter 确认、Esc 取消、焦点陷阱、aria-modal。
 */

interface DialogShellProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}

function DialogShell({ title, children, onClose }: DialogShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const focusable = shellRef.current?.querySelector<HTMLElement>(
      'input, button, [tabindex]'
    );
    focusable?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={shellRef}
        className="w-[min(360px,88vw)] rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="mb-3 text-sm font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** 文本输入弹窗（替代 window.prompt）。 */
export function PromptDialog({
  title,
  initialValue,
  placeholder,
  onConfirm,
  onCancel
}: {
  title: string;
  initialValue?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const value = inputRef.current?.value.trim() ?? '';
    if (value) onConfirm(value);
  };

  return (
    <DialogShell title={title} onClose={onCancel}>
      <input
        ref={inputRef}
        type="text"
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
        defaultValue={initialValue}
        placeholder={placeholder}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
          if (event.key === 'Escape') onCancel();
        }}
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
          onClick={onCancel}
        >
          {t('dialog.cancel')}
        </button>
        <button
          type="button"
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
          onClick={submit}
        >
          {t('dialog.confirm')}
        </button>
      </div>
    </DialogShell>
  );
}

/** 确认弹窗（危险操作二次确认）。 */
export function ConfirmDialog({
  title,
  message,
  danger = false,
  onConfirm,
  onCancel
}: {
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogShell title={title} onClose={onCancel}>
      <p className="mb-3 text-sm text-gray-600">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
          onClick={onCancel}
        >
          {t('dialog.cancel')}
        </button>
        <button
          type="button"
          className={
            'rounded px-3 py-1 text-sm text-white hover:opacity-90' +
            (danger ? ' bg-red-600' : ' bg-blue-600')
          }
          onClick={onConfirm}
        >
          {t('dialog.confirm')}
        </button>
      </div>
    </DialogShell>
  );
}
