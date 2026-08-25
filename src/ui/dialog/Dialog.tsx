import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/common/Button';
import { TextField } from '@/ui/common/TextField';

/**
 * 自制弹窗族（FR-D10.3）：替代浏览器原生 prompt/confirm。
 * 行为契约：打开聚焦首项、Tab 焦点陷阱、Esc 取消、关闭后焦点恢复、aria-modal。
 */

interface DialogShellProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  /** 覆盖默认宽度（宽度刻度见 main.css .dialog-sm/.dialog-md）。 */
  widthClassName?: string;
}

/** 弹窗内可聚焦元素选择器。 */
const FOCUSABLE_SELECTOR =
  'input, button, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * 弹窗行为契约 hook：打开聚焦首项、Tab 焦点陷阱、Esc 关闭、关闭后焦点恢复。
 * DialogShell / CommandPalette / OnboardingTour 共用，保证所有浮层行为一致。
 * onClose 用 ref 持有最新值：effect 只在挂载/卸载执行一次，避免父组件因后台
 * 标签更新重渲染时重跑焦点逻辑抢焦、或 triggerRef 被覆盖导致焦点恢复失效。
 */
export function useModalA11y(
  shellRef: React.RefObject<HTMLElement | null>,
  onClose: () => void
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const focusable = shellRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    focusable?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !shellRef.current) return;
      const focusableElements = Array.from(
        shellRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusableElements.length === 0) return;
      const first = focusableElements[0]!;
      const last = focusableElements[focusableElements.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === shellRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      trigger?.focus?.();
    };
    // eslint 依赖提示：onClose 已通过 ref 持有，effect 仅需挂载/卸载各执行一次。
  }, [shellRef]);
}

/**
 * 弹窗外壳（focus trap + Esc + 焦点恢复 + 遮罩点击关闭）。供扩展弹窗复用统一行为契约。
 */
export function DialogShell({
  title,
  children,
  onClose,
  widthClassName = 'dialog-sm'
}: DialogShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  useModalA11y(shellRef, onClose);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={shellRef}
        className={`${widthClassName} rounded-xl border border-gray-200 bg-surface p-4 shadow-xl`}
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
      <TextField
        inputRef={inputRef}
        defaultValue={initialValue}
        placeholder={placeholder}
        className="w-full"
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t('dialog.cancel')}
        </Button>
        <Button onClick={submit}>{t('dialog.confirm')}</Button>
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
        <Button variant="secondary" onClick={onCancel}>
          {t('dialog.cancel')}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {t('dialog.confirm')}
        </Button>
      </div>
    </DialogShell>
  );
}
