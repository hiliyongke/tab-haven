import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/common/Button';
import { useModalA11y } from '@/ui/dialog/Dialog';

const TOTAL = 3;

/**
 * 首启交互式引导（P0 激活）：仅首次展示（settings.onboarded=false）。
 * 三步讲清核心价值（列表已就绪 / 固定空间 / 键盘直达）+ 功能发现清单，
 * 完成后调用 onDone 写回 onboarded 标记，不再出现。
 */
export function OnboardingTour({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const last = step === TOTAL;
  const panelRef = useRef<HTMLDialogElement>(null);
  // 与弹窗族统一：焦点陷阱 + Esc 跳过（=onDone）+ 关闭后焦点恢复；
  // 不加遮罩点击关闭，避免误点直接写回 onboarded 标记。
  useModalA11y(panelRef, onDone);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" role="presentation">
      <dialog
        open
        ref={panelRef}
        className="relative m-0 w-full max-w-sm rounded-xl border border-gray-200 bg-surface p-5 shadow-lg"
        aria-modal="true"
        aria-label={t('onboarding.title')}
      >
        <p className="text-2xs font-medium tracking-wide text-accent-600">
          {t('onboarding.stepLabel', { current: step, total: TOTAL })}
        </p>
        <h2 className="mt-1 text-base font-semibold text-gray-800">
          {t(`onboarding.step${step}Title`)}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          {t(`onboarding.step${step}Body`)}
        </p>

        {last && (
          <div className="mt-4 rounded-lg bg-accent-50 p-3">
            <p className="text-xs font-medium text-accent-700">{t('onboarding.featuresTitle')}</p>
            <ul className="mt-1 space-y-1 text-2xs text-gray-600">
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
            className="text-2xs text-gray-500 transition-base hover:text-gray-600"
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

        <div className="mt-4 flex justify-center gap-1">
          {Array.from({ length: TOTAL }, (_, i) => (
            <span
              key={i}
              className={
                'h-1.5 rounded-full transition-base ' +
                (i + 1 === step ? 'w-4 bg-accent-500' : 'w-1.5 bg-gray-200')
              }
              aria-hidden="true"
            />
          ))}
        </div>
      </dialog>
    </div>
  );
}
