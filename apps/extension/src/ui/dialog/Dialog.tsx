import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isImeComposing } from '@/core/util/keyboard';
import { useTranslation } from '@/i18n';
import { Button } from '@/ui/common/Button';
import { Icons } from '@/ui/common/Icon';
import { IconButton } from '@/ui/common/IconButton';
import { TextField } from '@/ui/common/TextField';
import { useScrollFade } from '@/ui/common/useScrollFade';

/**
 * 自制弹窗族：替代浏览器原生 prompt/confirm。
 * 行为契约：打开聚焦首项、Tab 焦点陷阱、Esc 取消、关闭后焦点恢复、aria-modal。
 */

interface DialogShellProps {
  title: string;
  children: React.ReactNode;
  /** 底部按钮区（淡底 + 上分隔线）；不传则不渲染底栏（内容型弹窗如快照面板）。 */
  footer?: React.ReactNode;
  onClose: () => void;
  /** 覆盖默认宽度（宽度刻度见 main.css .dialog-sm/.dialog-md）。 */
  widthClassName?: string;
  /**
   * 不 portal，直接渲染在调用处。
   *
   * 使用场景只有一类：调用方自身处在**原生 `<dialog>` 的 showModal() 模态**中。
   * 模态 dialog 会让其子树之外的一切 inert，portal 到 body 的弹窗照样点不动；
   * 只有渲染成 dialog 的后代才能交互（命令面板里的快照恢复确认即此情形）。
   */
  inline?: boolean;
}

/** 弹窗内可聚焦元素选择器。 */
const FOCUSABLE_SELECTOR =
  'input, button, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * 弹窗栈（挂载序即层级序）：各级都在 document capture 阶段监听 keydown，同级按注册序
 * 执行、stopPropagation 拦不住——只有栈顶（最后挂载）实例有权响应键盘，否则嵌套时
 * 外层会先响应 Esc 连内层一起关掉、Tab 陷阱互相抢焦。
 */
const modalStack: symbol[] = [];

/**
 * 是否有模态正在打开。
 * 供全局快捷键短路：背景已由 background-inert 机制移出可访问树，⌘K/⌘P/⌘J 不会再
 * 把焦点移到遮罩后。
 */
export function isModalOpen(): boolean {
  return modalStack.length > 0;
}

/**
 * 背景惰性化：inert 一步把遮罩外内容移出可访问树并屏蔽焦点（Tab 陷阱只拦 Tab 走向，
 * 读屏虚拟光标不受其约束）。用「记录并恢复原值」而非无条件置 false：嵌套弹窗内层关闭
 * 时不能误把外层仍需的 inert 解掉。不支持 inert 的环境退化为 aria-hidden（只解决读屏）。
 */
const INERT_TARGET_SELECTOR = '.app, main, #root > *:not(.modal-overlay)';

/**
 * inert 支持性检测必须用 `in`，不能读原型上的值：inert 是 WebIDL 访问器属性，
 * 读 HTMLElement.prototype.inert 会以 prototype 自身作 this，Blink 抛
 * `Illegal invocation`。jsdom 未实现 inert 时读到 undefined。
 */
function supportsInert(): boolean {
  return typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype;
}

/** `dataset` 里的哨兵：标记目标元素原本**没有** `aria-hidden` 属性。 */
const ARIA_HIDDEN_ABSENT = '@absent';

function applyBackgroundInert(inert: boolean): void {
  if (typeof document === 'undefined') return;
  const targets = document.querySelectorAll<HTMLElement>(INERT_TARGET_SELECTOR);
  const useInert = supportsInert();
  for (const el of targets) {
    if (useInert) {
      el.inert = inert;
    } else if (inert) {
      // 记下原本的 aria-hidden：解除时若无条件 removeAttribute 会摘掉元素自带的
      // aria-hidden（本就对读屏隐藏的内容）。用 dataset 而非模块级 Map：元素可能在
      // 弹窗期间被替换，跟着元素走才不会记错对象。
      if (el.dataset.inertAriaHidden === undefined) {
        // '@' 前缀区分「属性不存在」与「原值为空串」，否则恢复时二者都是空串。
        const raw = el.getAttribute('aria-hidden');
        el.dataset.inertAriaHidden = raw === null ? ARIA_HIDDEN_ABSENT : `@${raw}`;
      }
      el.setAttribute('aria-hidden', 'true');
    } else {
      const previous = el.dataset.inertAriaHidden;
      // 没有记录说明这一次不是本函数置上的，不能动它。
      if (previous === undefined) continue;
      delete el.dataset.inertAriaHidden;
      if (previous === ARIA_HIDDEN_ABSENT) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', previous.slice(1));
    }
  }
}

/**
 * 弹窗行为契约 hook：打开聚焦首项、Tab 焦点陷阱、Esc 关闭、关闭后焦点恢复；
 * DialogShell / CommandPalette / OnboardingTour 共用。
 * onClose 用 ref 持有最新值：effect 只在挂载/卸载执行一次，避免父组件重渲染时重跑抢焦。
 * trapFocus=false 供短暂浮层（右键菜单）入栈：只借 isModalOpen 与背景惰性化，
 * 焦点陷阱与 Esc/Tab 留给浮层自己（菜单 Tab 语义是「离开」而非循环）。
 */
export function useModalA11y(
  shellRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  trapFocus = true
): void {
  const onCloseRef = useRef(onClose);
  // 提交后更新：只在按键时读取最新 onClose，避免并发渲染写入未提交的中间回调。
  const trapFocusRef = useRef(trapFocus);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    trapFocusRef.current = trapFocus;
  }, [trapFocus]);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    // 初始聚焦推迟到微任务：原生 <dialog> 的 showModal() 注册在本 effect 之后，
    // 同步 effect 跑完才轮到微任务，此时子树可聚焦；否则 focus() 打在 display:none
    // 子树上静默失效。跳过关闭按钮（data-dialog-dismiss），让焦点落在输入框/主按钮。
    if (trapFocusRef.current) {
      queueMicrotask(() => {
        const focusable = Array.from(
          shellRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []
        ).filter((el) => !el.hasAttribute('data-dialog-dismiss'));
        focusable[0]?.focus();
      });
    }

    // 背景滚动锁定：模态打开时背景随滚轮滚动会让遮罩与内容错位。嵌套弹窗只在最外层
    // 上锁/解锁——内层卸载时不能直接解锁（外层还开着）。
    const isOutermost = modalStack.length === 0;
    const root = document.documentElement;
    const previousOverflow = isOutermost ? root.style.overflow : undefined;
    const previousPaddingRight = isOutermost ? root.style.paddingRight : undefined;
    if (isOutermost) {
      // 补偿滚动条宽度：直接 overflow:hidden 会让滚动条消失、内容横向跳一下。
      const scrollbarWidth = window.innerWidth - root.clientWidth;
      root.style.overflow = 'hidden';
      // 钳到真实滚动条量级（≤40px）：无布局环境下 clientWidth 可能为 0，
      // 差值会大得离谱，直接补 padding 会把内容挤没。
      if (scrollbarWidth > 0 && scrollbarWidth <= 40) {
        root.style.paddingRight = `${scrollbarWidth}px`;
      }
    }

    const self = Symbol('modal');
    // 首个弹窗打开时才惰性化背景；嵌套弹窗沿用已有的 inert。
    if (modalStack.length === 0) applyBackgroundInert(true);
    modalStack.push(self);

    const onKeyDown = (event: KeyboardEvent) => {
      // 仅栈顶弹窗响应（嵌套场景下非栈顶实例的监听器直接放行）。
      if (modalStack[modalStack.length - 1] !== self) return;
      // 输入法组合中 Esc 是「取消候选」，放行给输入法（组合态按键不属于模态语义）。
      if (isImeComposing(event)) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        // preventDefault：原生 <dialog> 默认会再派发 cancel 事件，导致 onClose 被调两次。
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
      // 焦点已逃出弹窗：拉回首个可聚焦项。
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
    // 不抢陷阱的浮层自带 Esc/Tab 处理：两个监听器都在 document 捕获阶段，
    // stopPropagation 拦不住彼此，同一次按键会关两次。
    if (trapFocusRef.current) document.addEventListener('keydown', onKeyDown, true);
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
 * 弹窗外壳（focus trap + Esc + 焦点恢复 + 遮罩点击关闭 + 可见关闭按钮）。
 * 三段式结构（标题栏 / 内容区 / 底部按钮区）：必须有可见关闭入口——只有 Esc 或点遮罩
 * 用户不知道怎么关；标题栏与底栏淡底 + 细分隔线分区，滚动落在内容区。
 */
export function DialogShell({
  title,
  children,
  footer,
  onClose,
  widthClassName = 'dialog-sm',
  inline = false
}: DialogShellProps) {
  const { t } = useTranslation();
  const shellRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalA11y(shellRef, onClose);
  // 不传第二个（重挂信号）参数：children 每次渲染都是新引用，传它会导致每次渲染都
  // 解绑/重挂监听；内容增删由 hook 内部的 MutationObserver 覆盖。
  useScrollFade(contentRef);

  // Portal 到 body：.app 的 container-type: inline-size 会成为 fixed 后代的包含块
  // 并创建层叠上下文；挂到 body 后遮罩相对视口，不受 .app 内部 z-index 影响。
  // inline 时留在原地（见 DialogShellProps.inline：模态 dialog 之外的一切都 inert）。
  const content = (
    <div
      className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={shellRef}
        // overflow-hidden + 内容区滚动：标题与底栏常驻可见，圆角不被滚动内容切掉。
        className={`${widthClassName} modal-panel modal-surface flex max-h-[85vh] flex-col overflow-hidden`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* px-4：与内容区同线，避免三段式缩进各自一条竖线。 */}
        <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">
            {title}
          </h2>
          {/* 可见的关闭入口；dismiss 标记让「打开聚焦首项」跳过它。 */}
          <IconButton icon={Icons.close} size="md" label={t('关闭')} dismiss onClick={onClose} />
        </div>
        {/* min-h-0：flex 子项默认 min-height:auto 会顶破父级 max-h 而滚不起来。 */}
        <div ref={contentRef} className="scroll-fade min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {children}
        </div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
  return inline ? content : createPortal(content, document.body);
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
  // 受控值：确认按钮随输入实时禁用，空值静默会被当成「按钮坏了」。
  const [value, setValue] = useState(initialValue ?? '');
  const canSubmit = value.trim().length > 0;

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <DialogShell
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t('取消')}
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {t('确定')}
          </Button>
        </>
      }
    >
      <TextField
        value={value}
        placeholder={placeholder}
        /* 视觉 label 由弹窗标题承担，读屏需要程序化关联（placeholder 不算标签） */
        ariaLabel={title}
        className="w-full"
        onChange={setValue}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && canSubmit && !isImeComposing(event)) submit();
        }}
      />
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
  onCancel,
  inline = false
}: {
  title: string;
  message: string;
  danger?: boolean;
  /** 确认按钮文案；缺省用通用「确定」，危险操作建议传动作本身（如「确认删除」）。 */
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 见 DialogShellProps.inline：调用方在原生模态 dialog 内时必须置 true。 */
  inline?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <DialogShell
      title={title}
      onClose={onCancel}
      inline={inline}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t('取消')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel ?? t('确定')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-600">{message}</p>
    </DialogShell>
  );
}
