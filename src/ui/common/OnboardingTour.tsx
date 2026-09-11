import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/common/Button';
import { useModalA11y } from '@/ui/dialog/Dialog';

const TOTAL = 3;

/**
 * 首启交互式引导：仅首次展示（settings.onboarded=false）。
 * 三步讲清核心价值（列表已就绪 / 固定空间 / 键盘直达）+ 功能发现清单，
 * 完成后调用 onDone 写回 onboarded 标记，不再出现。
 *
 * Esc 走 onDismiss（仅本次会话关闭、不落盘）：误按 Esc 不会永久失去引导，
 * 下次打开面板仍会再展示，直到用户显式「跳过 / 完成」。
 */
export function OnboardingTour({
  onDone,
  onDismiss
}: {
  onDone: () => void;
  /** Esc 关闭（不写回 onboarded 标记）。 */
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const last = step === TOTAL;
  const panelRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // 与弹窗族统一：焦点陷阱 + 关闭后焦点恢复；
  // 不加遮罩点击关闭，避免误点直接写回 onboarded 标记。
  useModalA11y(panelRef, onDismiss);

  // 原生 <dialog> 默认 hidden，必须显式 showModal() 才会显示并进入真正的模态。
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!panel.open) panel.showModal();
    return () => {
      if (panel.open) panel.close();
    };
  }, []);

  // Portal 到 body：与 DialogShell 同层（z-stack 50 档），脱离 .app 的
  // container-type 层叠上下文。
  return createPortal(
    <div
      className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="presentation"
    >
      <dialog
        ref={panelRef}
        className="modal-panel elev-3 relative m-0 w-full max-w-[calc(100%-16px)] rounded-xl border border-gray-200 bg-surface p-5 sm:max-w-sm"
        aria-labelledby={titleId}
        onCancel={(event) => {
          // Esc 已由 useModalA11y preventDefault 并走 onDismiss；此分支只兜底
          // 原生 cancel 事件路径（防御性），同样走 onDismiss 不落盘。
          event.preventDefault();
          panelRef.current?.close();
          onDismiss();
        }}
      >
        <p className="text-3xs font-medium tracking-wide text-accent-600">
          {t('onboarding.stepLabel', { current: step, total: TOTAL })}
        </p>
        <h2 id={titleId} className="mt-1 text-base font-semibold text-gray-800">
          {t(`onboarding.step${step}Title`)}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          {t(`onboarding.step${step}Body`)}
        </p>

        {last && (
          <div className="mt-4 rounded-lg bg-accent-50 p-3">
            <p className="text-xs font-medium text-accent-700">{t('onboarding.featuresTitle')}</p>
            <ul className="mt-1 space-y-1 text-3xs text-gray-600">
              <li>• {t('onboarding.feature1')}</li>
              <li>• {t('onboarding.feature2')}</li>
              <li>• {t('onboarding.feature3')}</li>
              <li>• {t('onboarding.feature4')}</li>
            </ul>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            className="text-3xs text-gray-500 transition-base hover:text-gray-600"
            onClick={onDone}
          >
            {t('onboarding.skip')}
          </button>
          <div className="flex gap-2">
            {step > 1 && (
              <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
                {t('onboarding.prev')}
              </Button>
            )}
            {last ? (
              <Button variant="primary" onClick={onDone}>
                {t('onboarding.finish')}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
                {t('onboarding.next')}
              </Button>
            )}
          </div>
        </div>

        {/* 进度点：可点击跳步（向导常见交互）。改用 button 并补 aria-label，
            读屏用户可获得「转到第 n 步」而非被 aria-hidden 整块吞掉。
            tour-dot 透明扩区把 6px 视觉高度撑到 ≥24px 命中（WCAG 2.5.8）。 */}
        <div className="mt-4 flex justify-center gap-1">
          {Array.from({ length: TOTAL }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStep(i + 1)}
              aria-label={t('onboarding.goToStep', { step: i + 1 })}
              aria-current={i + 1 === step ? 'step' : undefined}
              className={
                'tour-dot h-1.5 rounded-full transition-base ' +
                (i + 1 === step ? 'w-4 bg-accent-500' : 'w-1.5 bg-gray-200 hover:bg-gray-300')
              }
            />
          ))}
        </div>
      </dialog>
    </div>,
    document.body
  );
}
