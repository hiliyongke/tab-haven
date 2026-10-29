import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '@/i18n';
import { Button } from '@/ui/common/Button';
import { Callout } from '@/ui/common/Callout';
import { useModalA11y } from '@/ui/dialog/Dialog';

const TOTAL = 3;

/**
 * 三步引导文案（中文原文）。`onboarding.step${step}Title/Body` 运行时拼接会让静态扫描拿不到
 * 完整 key（英文露中文），故改为按步号取原文再查词典。属性名以 `Key` 结尾是扫描器的抽取
 * 约定（见 packages/i18n-kit/src/collect.ts）：常量表原文不是 t() 调用点，只有 `*Key` 属性
 * 会被抽进词典；靠 `@i18n-ignore-start/end` 只压告警、词条不进词典，所以必须走 `*Key` 通道。
 */
const ONBOARDING_STEPS = [
  {
    titleKey: '你的标签已经在这里',
    bodyKey: '当前窗口的标签会自动列在侧边栏，无需任何配置即可查看与整理。'
  },
  {
    titleKey: '把常用页面固定起来',
    bodyKey: '把高频页面拖到顶部常驻磁贴随时切换，或拖入「收藏夹」的文件夹长期保存，一点即达。'
  },
  {
    titleKey: '敲几下键盘直达任意标签',
    // 必须点出 ⌘P：命令面板是全产品最高效的入口，漏掉它等于把最高效的路径藏起来。
    bodyKey:
      '按 ⌘K / Ctrl+K 聚焦搜索，输入标题、网址或拼音首字母，↑↓ 选择、回车切换；按 ⌘P / Ctrl+P 打开命令面板，一步执行休眠、存快照、导出备份。'
  }
] as const;

/**
 * 首启交互式引导：仅首次展示（settings.onboarded=false），完成后 onDone 写回标记不再出现。
 * Esc 走 onDismiss（仅本次会话关闭、不落盘）：误按 Esc 不会永久失去引导。
 */
export function OnboardingTour({
  onDone,
  onDismiss,
  onExport
}: {
  onDone: () => void;
  /** Esc 关闭（不写回 onboarded 标记）。 */
  onDismiss: () => void;
  /** 可选：终步的「立即导出备份」；不传则只显示提示文案。 */
  onExport?: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const last = step === TOTAL;
  // step 恒在 1..TOTAL，回退首步仅用于收掉下标访问的 undefined。
  const current = ONBOARDING_STEPS[step - 1] ?? ONBOARDING_STEPS[0];
  const panelRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // 与弹窗族统一：焦点陷阱 + 关闭后焦点恢复；不加遮罩点击关闭，避免误点写回 onboarded 标记。
  useModalA11y(panelRef, onDismiss);

  // 原生 <dialog> 默认 hidden，必须显式 showModal() 才显示并进入真正的模态。
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!panel.open) panel.showModal();
    return () => {
      if (panel.open) panel.close();
    };
  }, []);

  // Portal 到 body：与 DialogShell 同层（z-stack 50 档），脱离 .app 的 container-type 层叠上下文。
  return createPortal(
    <div
      className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
    >
      <dialog
        ref={panelRef}
        /* dialog-sm + px-4 py-3：与弹窗族同一宽度刻度与内边距（侧边栏 ≤500px，sm:max-w-sm 断点永不命中）。 */
        /* m-auto 而非 m-0：原生 <dialog> 经 showModal() 后居中靠浏览器默认 margin:auto，m-0 会贴左上角。 */
        className="dialog-sm modal-panel modal-surface relative m-auto px-4 py-3"
        aria-labelledby={titleId}
        onCancel={(event) => {
          // Esc 已由 useModalA11y 走 onDismiss；此分支兜底原生 cancel 事件，同样不落盘。
          event.preventDefault();
          panelRef.current?.close();
          onDismiss();
        }}
      >
        <p className="text-3xs font-medium tracking-wide text-accent-600">
          {t('第 {{current}} / {{total}} 步', { current: step, total: TOTAL })}
        </p>
        <h2 id={titleId} className="mt-1 text-base font-semibold text-gray-800">
          {t(current.titleKey)}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">{t(current.bodyKey)}</p>

        {last && (
          <div className="mt-4 rounded-lg bg-accent-50 p-3">
            <p className="text-xs font-medium text-accent-700">{t('你还能用这些功能')}</p>
            <ul className="mt-1 space-y-1 text-3xs text-gray-600">
              <li>• {t('右键菜单：在页面 / 链接 / 标签栏右键快速休眠、固定、按域名搜索')}</li>
              <li>• {t('地址栏命令：输入 t 加关键词，直达标签与收藏夹条目')}</li>
              <li>• {t('撤销历史：所有关闭操作都可撤销，误关也不怕')}</li>
              <li>• {t('工具栏角标：实时显示重复标签数 / 总标签数')}</li>
            </ul>
          </div>
        )}

        {/* 终步的备份提醒：数据只存在本机，卸载即清除 —— 在用户最有耐心看完的终局给一次导出机会。 */}
        {last && (
          <Callout
            tone="plain"
            density="page"
            align="center"
            className="mt-3"
            action={
              onExport && (
                <Button variant="secondary" size="sm" onClick={onExport}>
                  {t('立即导出')}
                </Button>
              )
            }
          >
            <p className="text-3xs leading-relaxed">
              {t('数据只保存在这台设备的浏览器里，卸载扩展会一并清除。建议现在导出一份备份。')}
            </p>
          </Callout>
        )}

        <div className="mt-5 flex items-center justify-between">
          {/* 命中下限与 disabled:hover 兜底交给 ghost 变体；11px 字号走 dense 档。 */}
          <Button variant="ghost" size="dense" className="hover:text-gray-600" onClick={onDone}>
            {t('跳过')}
          </Button>
          <div className="flex gap-2">
            {step > 1 && (
              <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
                {t('上一步')}
              </Button>
            )}
            {last ? (
              <Button variant="primary" onClick={onDone}>
                {t('开始使用')}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
                {t('下一步')}
              </Button>
            )}
          </div>
        </div>

        {/* 进度点：用 button + aria-label（读屏得「转到第 n 步」）；tour-dot 透明扩区把 6px 撑到
            ≥24px 命中。刻意不用 Button/IconButton：它们 min-h-6 会把 6px 圆点撑成 24px 实心块。 */}
        <div className="mt-4 flex justify-center gap-1">
          {Array.from({ length: TOTAL }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStep(i + 1)}
              aria-label={t('转到第 {{step}} 步', { step: i + 1 })}
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
