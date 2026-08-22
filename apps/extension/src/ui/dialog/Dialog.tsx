import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
 * 背景惰性化。
 *
 * 遮罩外的背景若仍在可访问树里：读屏能朗读到背景内容，Tab 循环也可能
 * 把焦点带出去（焦点陷阱拦的是 Tab 走向，但读屏的虚拟光标不受其约束）。
 * `inert` 一步解决两件事 —— 移出可访问树 + 屏蔽交互与焦点。
 *
 * 用「记录并恢复原值」而不是卸载时无条件置 false：嵌套弹窗（快照面板内嵌删除
 * 确认框）会让内层关闭时误把外层仍需的 inert 解掉。
 *
 * 兜底：不支持 inert 的运行环境退化为 aria-hidden（只解决读屏，不解决焦点）。
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
      // 记下原本的 aria-hidden：解除时若无条件 removeAttribute，会顺手摘掉目标
      // 元素**自带**的 aria-hidden（某块内容本就对读屏隐藏），弹窗一开一关
      // 就把它变成可见，而没有任何一处代码"故意"这么做过。
      // 用 dataset 而不是模块级 Map：元素可能在弹窗期间被替换（路由/重挂载），
      // 跟着元素走才不会记错对象。
      if (el.dataset.inertAriaHidden === undefined) {
        // `'@'` 前缀同时编码「属性是否存在」与「原值」：只存原值的话，
        // `aria-hidden=""`（无值）与「属性不存在」会存成同一个空串，恢复时
        // 只能二选一 —— 用哨兵前缀把两者区分开。
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
      // 跳过关闭按钮（data-dialog-dismiss）：弹窗一打开焦点应落在输入框或主按钮
      // 上，而不是右上角的 ✕ —— 否则输入型弹窗要再按一次 Tab 才能开始打字。
      const focusable = Array.from(
        shellRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []
      ).filter((el) => !el.hasAttribute('data-dialog-dismiss'));
      focusable[0]?.focus();
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
 * 弹窗外壳（focus trap + Esc + 焦点恢复 + 遮罩点击关闭 + 可见关闭按钮）。
 *
 * 三段式结构（标题栏 / 内容区 / 底部按钮区）：
 * 「标题 + 内容 + 按钮」一整块白板靠 margin 撑开层次，长内容弹窗里显得是塞进去的
 * 一块。**必须有可见的关闭入口** —— 只有 Esc 或点遮罩时用户不知道怎么关。
 * 标题栏与底栏用淡底 + 细分隔线分区，滚动落在内容区（标题与按钮常驻可见）。
 */
export function DialogShell({
  title,
  children,
  footer,
  onClose,
  widthClassName = 'dialog-sm'
}: DialogShellProps) {
  const { t } = useTranslation();
  const shellRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalA11y(shellRef, onClose);
  // 不传第二个（重挂信号）参数：children 每次渲染都是新引用，传它等于每次渲染
  // 都解绑/重挂 scroll + ResizeObserver + MutationObserver。内容增删由 hook 内部
  // 的 MutationObserver 覆盖，本容器挂载后引用也不再变化。
  useScrollFade(contentRef);

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
        // overflow-hidden + 内容区滚动：标题与底栏在长内容弹窗里始终可见，
        // 圆角也不会被滚动内容切掉。
        className={`${widthClassName} modal-panel elev-3 flex max-h-[85vh] flex-col overflow-hidden rounded-xl border border-gray-200 bg-surface`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* px-4：与内容区（px-4）同线。标题栏/底栏与内容区各用一套缩进时，
            三段式各自一条竖线：标题比输入框靠外 4px、× 比输入框右边缘多 4px。 */}
        <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">
            {title}
          </h2>
          {/* 可见的关闭入口：只有 Esc / 点遮罩两条隐藏路径用户不会知道。
              dismiss 标记让「打开聚焦首项」跳过它（焦点应落在输入框或主按钮上）。 */}
          <IconButton icon={Icons.close} box="md" title={t('关闭')} dismiss onClick={onClose} />
        </div>
        {/* min-h-0：flex 子项默认 min-height:auto，会顶破父级 max-h 而滚不起来。
            scroll-fade：快照面板 20 条、撤销历史都在这一层里滚，没有底部边界提示
            时用户滚到一半会以为到底了。 */}
        <div ref={contentRef} className="scroll-fade min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {children}
        </div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-2">
            {footer}
          </div>
        )}
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
  // 受控值：确认按钮随输入实时禁用 —— 空值点「确定」完全静默会被当成「按钮坏了」，
  // 禁用态让不可提交的原因一目了然。
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
    <DialogShell
      title={title}
      onClose={onCancel}
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
