import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/common/Button';
import { TextField } from '@/ui/common/TextField';

/**
 * 自制弹窗族：替代浏览器原生 prompt/confirm。
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
 * 弹窗栈（挂载序即层级序）：嵌套弹窗（如快照面板内嵌删除确认框）时，
 * 各级都在 document capture 阶段监听 keydown，同节点监听器按注册序执行，
 * stopPropagation 拦不住同级——外层会先响应 Esc 连内层一起关掉，
 * Tab 陷阱也会互相抢焦。只有栈顶（最后挂载）实例有权响应键盘。
 */
const modalStack: symbol[] = [];

/**
 * 是否有模态正在打开。
 *
 * 供全局快捷键短路：DialogShell 只拦 Tab/Esc；背景已由 background-inert 机制
 * 移出可访问树（见 applyBackgroundInert），⌘K/⌘P/⌘J 不会再把焦点移到遮罩后。
 */
export function isModalOpen(): boolean {
  return modalStack.length > 0;
}

/**
 * 背景惰性化（R13 / A-1）。
 *
 * 此前弹窗打开时遮罩外的背景仍在可访问树里：读屏能朗读到背景内容，Tab 循环也
 * 可能把焦点带出去（焦点陷阱拦的是 Tab 走向，但读屏的虚拟光标不受其约束）。
 * `inert` 一步解决两件事 —— 移出可访问树 + 屏蔽交互与焦点。
 *
 * 用「记录并恢复原值」而不是卸载时无条件置 false：嵌套弹窗（快照面板内嵌删除
 * 确认框）会让内层关闭时误把外层仍需的 inert 解掉。
 *
 * 兜底：不支持 inert 的旧内核退化为 aria-hidden（只解决读屏，不解决焦点）。
 */
const INERT_TARGET_SELECTOR = '.app, main, #root > *:not(.modal-overlay)';

/**
 * `inert` 支持性检测：必须用 `in`，**不能**读原型上的值。
 *
 * `inert` 是 WebIDL 访问器属性，读 `HTMLElement.prototype.inert` 会以
 * `HTMLElement.prototype` 自身作为 this —— 它不是平台对象，Blink 直接抛
 * `Illegal invocation`（与 `Element.prototype.innerHTML` 同类的坑）。
 * jsdom 未实现 `inert`，读到的是 `undefined`，因此这条在单测里始终走
 * 降级分支、永远全绿，只有在真实 Chrome 里打开任意弹窗才会崩。
 */
function supportsInert(): boolean {
  return typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype;
}

function applyBackgroundInert(inert: boolean): void {
  if (typeof document === 'undefined') return;
  const targets = document.querySelectorAll<HTMLElement>(INERT_TARGET_SELECTOR);
  const useInert = supportsInert();
  for (const el of targets) {
    if (useInert) {
      el.inert = inert;
    } else if (inert) {
      el.setAttribute('aria-hidden', 'true');
    } else {
      el.removeAttribute('aria-hidden');
    }
  }
}

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
  // 提交后更新：onClose 只在用户按键时读取，effect 保证读到的是最新值，
  // 同时避免在并发渲染下把未提交的中间回调写进 ref。
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    // 初始聚焦推迟到微任务：原生 <dialog> 场景（CommandPalette/OnboardingTour）
    // 的 showModal() 注册在本 effect 之后，同一批 passive effect 同步执行完才轮到
    // 微任务，此时 dialog 已打开、子树可聚焦。否则 focus() 打在 display:none 的
    // 子树上静默失效，焦点落在 dialog 元素自身（键盘漫游整体不可用）。
    queueMicrotask(() => {
      const focusable = shellRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      focusable?.focus();
    });

    // 背景滚动锁定：模态打开时背景仍随滚轮滚动，会让遮罩与内容错位、且把
    // 「在遮罩上滚一下」变成误操作。嵌套弹窗只在最外层上锁/解锁 —— 内层
    // 卸载时若直接解锁，外层还开着却已可滚动。
    const isOutermost = modalStack.length === 0;
    const root = document.documentElement;
    const previousOverflow = isOutermost ? root.style.overflow : undefined;
    const previousPaddingRight = isOutermost ? root.style.paddingRight : undefined;
    if (isOutermost) {
      // 补偿滚动条宽度：直接 overflow:hidden 会让滚动条消失、内容横向跳一下，
      // 在窄侧栏里这个跳动非常明显。
      const scrollbarWidth = window.innerWidth - root.clientWidth;
      root.style.overflow = 'hidden';
      // 钳到真实滚动条量级（≤40px）：无头/无布局环境下 clientWidth 可能为 0，
      // 差值会大得离谱（jsdom 下得到视口整宽），直接拿来补 padding 会把内容挤没。
      if (scrollbarWidth > 0 && scrollbarWidth <= 40) {
        root.style.paddingRight = `${scrollbarWidth}px`;
      }
    }

    const self = Symbol('modal');
    // 首个弹窗打开时才惰性化背景；嵌套弹窗沿用已有的 inert（见 applyBackgroundInert）。
    if (modalStack.length === 0) applyBackgroundInert(true);
    modalStack.push(self);

    const onKeyDown = (event: KeyboardEvent) => {
      // 仅栈顶弹窗响应（嵌套场景下非栈顶实例的监听器直接放行）。
      if (modalStack[modalStack.length - 1] !== self) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        // preventDefault：原生 <dialog> 场景的默认行为会再派发 cancel 事件，
        // onCancel 与这里各调一次 onClose（引导弹窗的 onDone 副作用执行两次）。
        // 统一由本路径出口；dialog 的关闭由组件卸载时的 cleanup（panel.close()）承担。
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !shellRef.current) return;
      const focusableElements = Array.from(
        shellRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (focusableElements.length === 0) return;
      const first = focusableElements[0]!;
      const last = focusableElements[focusableElements.length - 1]!;
      const active = document.activeElement;
      const index = active ? focusableElements.indexOf(active as HTMLElement) : -1;
      // 焦点已逃出弹窗（如点击了遮罩外的 body，或动态插入的节点替换了原元素）：
      // 拉回首个可聚焦项，而不是放任焦点泄漏到背景内容。
      if (index === -1) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
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
      const index = modalStack.indexOf(self);
      if (index !== -1) modalStack.splice(index, 1);
      // 栈顶清空（所有嵌套层都已关闭）才解除背景惰性。
      if (modalStack.length === 0) applyBackgroundInert(false);
      if (modalStack.length === 0 && previousOverflow !== undefined) {
        root.style.overflow = previousOverflow;
        root.style.paddingRight = previousPaddingRight ?? '';
      }
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
  const titleId = useId();
  useModalA11y(shellRef, onClose);

  // Portal 到 body：侧边栏根节点 .app 带 container-type: inline-size，
  // 会成为 fixed 后代的包含块并创建层叠上下文。挂到 body 后遮罩始终相对视口，
  // 且不再受 .app 内部 z-index 影响（层级由 z-stack 的 50 档统一保证）。
  return createPortal(
    <div
      className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={shellRef}
        // elev-3 而非 shadow-xl：阴影统一走 shadow-tint 暖调令牌（见 main.css）
        className={`${widthClassName} modal-panel elev-3 max-h-[85vh] overflow-y-auto rounded-xl border border-gray-200 bg-surface p-4`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="mb-3 text-sm font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body
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
  // 受控值：确认按钮随输入实时禁用 —— 空值点「确定」此前完全静默，
  // 用户会当成「按钮坏了」，禁用态让不可提交的原因一目了然。
  const [value, setValue] = useState(initialValue ?? '');
  const canSubmit = value.trim().length > 0;

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <DialogShell title={title} onClose={onCancel}>
      <TextField
        inputRef={inputRef}
        value={value}
        placeholder={placeholder}
        /* 视觉 label 由弹窗标题承担，读屏需要程序化关联（placeholder 不算标签） */
        ariaLabel={title}
        className="w-full"
        onChange={setValue}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && canSubmit) submit();
        }}
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t('dialog.cancel')}
        </Button>
        <Button disabled={!canSubmit} onClick={submit}>
          {t('dialog.confirm')}
        </Button>
      </div>
    </DialogShell>
  );
}

/** 确认弹窗（危险操作二次确认）。 */
export function ConfirmDialog({
  title,
  message,
  danger = false,
  confirmLabel,
  onConfirm,
  onCancel
}: {
  title: string;
  message: string;
  danger?: boolean;
  /** 确认按钮文案；缺省用通用「确定」。危险操作建议传入动作本身（如「确认删除」），
      让用户点下的那一刻知道自己要做什么，而不是一个中性的「确定」。 */
  confirmLabel?: string;
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
          {confirmLabel ?? t('dialog.confirm')}
        </Button>
      </div>
    </DialogShell>
  );
}
