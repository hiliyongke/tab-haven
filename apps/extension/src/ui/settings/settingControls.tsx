import { Children, isValidElement, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n';
import type { Settings } from '@/core/schema/models';
import { NO_CACHE_PATTERNS_LIMIT, normalizeNoCachePattern } from '@/core/nocache/noCachePattern';
import { normalizeWhitelistHost } from '@/core/url/hostname';
import { hasPermissions, requestPermissions, type PermissionQuery } from '@/platform/permissions';
import { logDegraded } from '@/platform/diagnostics';
import { Button } from '@/ui/common/Button';
import { Chip } from '@/ui/common/Chip';
import { Icon, Icons } from '@/ui/common/Icon';
import { ControlIdContext } from '@/ui/common/controlId';
import { Select } from '@/ui/common/Select';
import { TextField } from '@/ui/common/TextField';
import { Toggle } from '@/ui/common/Toggle';

/**
 * 设置页的**展示层控件**：分区容器、行容器与三个带本地交互态的编辑器。
 *
 * 与 `settingSections.tsx`（声明式配置）分层的原因：`buildSections` 的 render 闭包
 * 引用编辑器组件，若两者同文件，配置层与渲染层会互相依赖成环。
 * 本文件是叶子，不依赖任何配置层模块。
 */

/** 禁缓存能力所需的全站 host 权限（optional_host_permissions 申请单元）。 */
const SITE_ACCESS: PermissionQuery = { origins: ['<all_urls>'] };

function SectionCount({ count }: { count?: number }) {
  const { t } = useTranslation();
  if (count === undefined) return null;
  return (
    // 裸数字对读屏是孤立量词；可见数字 aria-hidden，改播完整语义。
    // 视觉走 .count-pill：与侧栏分区头的计数是同一个「计数胶囊」语义，
    // 不再单独维护一套描边矩形（此前两处计数长得不一样）。
    <>
      <span aria-hidden="true" className="count-pill">
        {count}
      </span>
      <span className="sr-only">{t('共 {{count}} 项', { count })}</span>
    </>
  );
}

/**
 * 设置分区：标题 + 计数 + 卡片容器。
 *
 * 曾支持 `collapsible`（details/summary 折叠「高级设置」抽屉）。该能力已移除：
 * 折叠的唯一价值是缩短滚动长度，而侧栏目录（SettingsOutline）已经提供了直达导航，
 * 折叠只剩代价 —— 用户看不见里面有什么（折叠态没有任何内容提示）。
 * `id` 供目录锚点定位，`scroll-mt-*` 让锚点跳转后标题不贴顶。
 */
export function Section({
  title,
  children,
  count,
  id
}: {
  title: string;
  children: ReactNode;
  count?: number;
  /** 目录锚点 id（通常传 titleKey）。 */
  id?: string;
}) {
  return (
    <section id={id} className="mb-6 scroll-mt-6 sm:mb-8">
      {/* px-4：与卡片内 Row 的 px-4 同线（16px），也让本标题与「快速预设」卡内
          标题（其 section 自带 p-4）处在同一条竖线上 —— 两者差 16px 会错开。 */}
      {/* section-title：与关于页共用同一套标题排版（此前两页各写一份常量）。 */}
      <h2 className="section-title mb-3 flex items-center gap-2 px-4">
        <span>{title}</span>
        <SectionCount count={count} />
      </h2>
      <div className="flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-200 bg-surface">
        {children}
      </div>
    </section>
  );
}

/**
 * 可与视觉标签做 `htmlFor` 关联的控件类型。
 *
 * 只在这几种「单一控件」时才渲染 `<label>`：其余 Row 的 children 是按钮组、
 * chip 编辑器或多控件组合，给它们挂 htmlFor 会指向不存在的 id（axe 报
 * 「label 必须关联到控件」），因此降级为普通 <div>。
 */
const ASSOCIABLE_CONTROLS: unknown[] = [Toggle, Select, TextField];

/** children 是否是「唯一的、可关联的表单控件」。 */
function isAssociableControl(children: ReactNode): boolean {
  // 先剔掉非元素子节点：`createPortal` 产出的不是 React 元素（isValidElement 为 false），
  // 但 Children.toArray 仍把它算作一项。带 confirmOffKey 的开关在确认框打开时
  // children 就是 [Toggle, Portal] —— 不剔就会被判成「多控件组合」，
  // <label> 退化成 <div>、htmlFor 也不再下发，点标签聚焦/切换的能力
  // **恰好在弹窗打开那一刻**丢失（交互中途失效，最难自查）。
  const items = Children.toArray(children).filter(isValidElement);
  const only = items[0];
  if (items.length !== 1 || only === undefined) return false;
  return ASSOCIABLE_CONTROLS.includes(only.type);
}

export function Row({
  label,
  hint,
  icon,
  children
}: {
  /** 允许 ReactNode：快捷键行需要传 <Kbd>，仅字符串无法表达键帽视觉。 */
  label: ReactNode;
  hint?: string;
  /** 左侧前置图标底座（能力清单这类「图标 + 两行说明 + 动作」的行）。 */
  icon?: ReactNode;
  children: ReactNode;
}) {
  const controlId = useId();
  const associable = isAssociableControl(children);
  // 可关联时才渲染 <label>：点击标签文本即可聚焦/切换控件，
  // 且视觉文案与程序化标签收敛为一份（不必再在控件上另写 aria-label）。
  const LabelTag = associable ? 'label' : 'div';
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <LabelTag
            className="block text-sm text-gray-800"
            {...(associable ? { htmlFor: controlId } : {})}
          >
            {label}
          </LabelTag>
          {/* text-3xs(11px)：hint 是需要阅读的正文说明，遵守 main.css 顶部自订的
              「正文说明一律 ≥ 11px」（10px 仅用于图标内文与徽角）。 */}
          {hint && <div className="mt-0.5 text-3xs text-gray-600">{hint}</div>}
        </div>
      </div>
      {/* 窄屏下控件撑满整行（右对齐改为起始对齐，避免长文本域溢出） */}
      <div className="w-full shrink-0 sm:w-auto sm:pl-4">
        <ControlIdContext.Provider value={associable ? controlId : undefined}>
          {children}
        </ControlIdContext.Provider>
      </div>
    </div>
  );
}

/** 休眠白名单编辑器：输入域名 → 添加；chip 列表可单个删除。 */
export function WhitelistEditor({
  value,
  onChange
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  /** 添加未生效的原因（无效 / 重复）：静默 return 会让用户以为已经加上了。 */
  const [notice, setNotice] = useState<string | null>(null);
  const add = () => {
    // 归一化走 core 的唯一来源（schema 落盘与 SW 匹配端用同一函数）：
    // 此处内联一份时，改口径会让另外两处（schema / buildWhitelistMatcher）漏改。
    const host = normalizeWhitelistHost(input);
    // 归一化判空 = 这条永不命中（凭据串 / 越界端口 / 非法主机）。
    if (!host) {
      setNotice(t('不是有效的域名或「域名:端口」，未添加'));
      return;
    }
    // 归一化后与既有条目撞车（`WWW.A.com` 与 `a.com`）：不重复添加，但要说清楚。
    if (value.includes(host)) {
      setNotice(t('该域名已在白名单中'));
      setInput('');
      return;
    }
    setNotice(null);
    onChange([...value, host]);
    setInput('');
  };
  return (
    /* 窄屏（sm 以下）下本块变成 w-full 且起始对齐，硬写 items-end / justify-end
       会让 chip 靠右、输入框靠左，同块内出现两套水平基准。跟随断点切换对齐方向。 */
    <div className="flex w-full flex-col items-start gap-1.5 sm:w-auto sm:items-end">
      {value.length > 0 && (
        /* sm:max-w-60（15rem = 240px）：去掉全仓唯一的任意值宽度 class */
        <ul className="flex max-w-full flex-wrap justify-start gap-1 sm:max-w-60 sm:justify-end">
          {value.map((entry) => (
            <li key={entry}>
              {/* 描边 Chip：可移除标签的视觉只有一个来源（此前与计数胶囊各写一串）。 */}
              <Chip tone="outline" className="flex items-center gap-1 px-1.5 py-0.5">
                {entry}
                {/* 刻意保留裸 button：.whitelist-remove 已用 inset -6px 把 12px 图标
                    的命中区扩到 24px（无缺陷可修），而 RowActionButton 内部固定
                    .row-action 的 20×20 盒 + 品牌色 hover，会把这枚 chip 从 16px 撑到
                    24px、并把 hover 语义从「灰字变深」改成品牌底。 */}
                <button
                  type="button"
                  aria-label={t('移出白名单')}
                  title={t('移出白名单')}
                  onClick={() => onChange(value.filter((v) => v !== entry))}
                  /* whitelist-remove 透明扩区：12px 图标命中区远低于 WCAG 2.5.8 的 24px */
                  className="whitelist-remove text-gray-500 hover:text-gray-600"
                >
                  <Icon d={Icons.close} className="h-3 w-3" />
                </button>
              </Chip>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1">
        <TextField
          size="sm"
          className="w-32"
          placeholder={t('输入域名')}
          ariaLabel={t('输入域名')}
          value={input}
          onChange={(next) => {
            setInput(next);
            // 重新输入即视为已知晓上一次的结果，避免提示粘在屏幕上。
            if (notice !== null) setNotice(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
        />
        <Button variant="secondary" size="sm" onClick={add}>
          {t('添加')}
        </Button>
      </div>
      {notice !== null && (
        /* text-3xs(11px)：正文说明的最小字号（10px 仅用于图标内文与徽角）。 */
        <p role="status" className="text-3xs text-red-600">
          {notice}
        </p>
      )}
    </div>
  );
}

/** 禁缓存站点编辑器：大文本框即列表（每行一条 pattern），所见即所得。
 *  编辑/删行直接改文本；失焦或点「保存」时按行归一化、去重写回设置，
 *  无效行被忽略并计数提示；外部变更（重置/导入）经 useEffect 回流同步。 */
export function NoCachePatternEditor({
  value,
  onChange
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  /**
   * 文本框的草稿态：当前文本 + 最近一次与设置对齐的文本。
   *
   * 二者刻意合成**一个** state 而不是「state + ref」：它们是同一份草稿的两个
   * 字段，分开存放时任何一处漏更新都会让「保存 → settings 回流 → 重置光标」
   * 的回灌判定失准。
   */
  const [draft, setDraft] = useState(() => {
    const joined = value.join('\n');
    return { text: joined, synced: joined };
  });
  const [invalidCount, setInvalidCount] = useState(0);
  const full = value.length >= NO_CACHE_PATTERNS_LIMIT;

  // 外部变更（重置设置 / 导入备份）同步进文本框；内容一致时跳过。
  useEffect(() => {
    const joined = value.join('\n');
    setDraft((prev) => (joined === prev.synced ? prev : { text: joined, synced: joined }));
  }, [value]);

  const commit = () => {
    const lines = draft.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const next: string[] = [];
    let invalid = 0;
    for (const line of lines) {
      const normalized = normalizeNoCachePattern(line);
      if (!normalized) {
        invalid++;
        continue;
      }
      if (seen.has(normalized) || next.length >= NO_CACHE_PATTERNS_LIMIT) continue;
      seen.add(normalized);
      next.push(normalized);
    }
    setInvalidCount(invalid);
    const joined = next.join('\n');
    // 文本框规整为归一化后的权威列表（无效行移除、空行压缩）。
    if (joined !== draft.synced) {
      setDraft({ text: joined, synced: joined });
      onChange(next);
    } else if (draft.text !== joined) {
      setDraft((prev) => ({ ...prev, text: joined }));
    }
  };

  return (
    <div className="flex w-full flex-col items-end gap-1 sm:w-96">
      <TextField
        multiline
        rows={5}
        resize
        className="font-mono leading-5"
        placeholder={t('每行一条，例：\nexample.com\nexample.com/app\nhttps://example.com/app')}
        ariaLabel={t('禁缓存站点列表')}
        inputProps={{ spellCheck: false }}
        value={draft.text}
        onChange={(next) => {
          setDraft((prev) => ({ ...prev, text: next }));
          if (invalidCount > 0) setInvalidCount(0);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          // ⌘/Ctrl+Enter 快捷保存（Enter 保持默认换行：列表编辑语义优先）
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            commit();
          }
        }}
      />
      <div className="flex w-full items-center justify-between gap-2">
        <span className="min-w-0 truncate text-3xs text-gray-500">
          {invalidCount > 0
            ? t('已忽略 {{count}} 行格式无效的条目', { count: invalidCount })
            : t('每行一条，回车换行；失焦或点保存生效（⌘/Ctrl+Enter）')}
        </span>
        <Button variant="secondary" size="sm" onClick={commit}>
          {t('保存')}
        </Button>
      </div>
      {full && <span className="text-3xs text-gray-500">{t('已达上限（50 条）')}</span>}
    </div>
  );
}

/** 禁缓存总开关：开启前请求 optional 全站 host 权限（拒绝则不开启）；权限被回收时引导重新授权。 */
export function NoCacheToggle({
  settings,
  update
}: {
  settings: Settings;
  update: (key: keyof Settings, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const [denied, setDenied] = useState(false);
  const [permissionLost, setPermissionLost] = useState(false);

  useEffect(() => {
    if (!settings.noCacheEnabled) {
      setPermissionLost(false);
      return;
    }
    let cancelled = false;
    void hasPermissions(SITE_ACCESS)
      .then((has) => {
        if (!cancelled) setPermissionLost(!has);
      })
      .catch((error: unknown) => {
        // 权限查询失败与「权限真的丢了」在 UI 上同形，但处置完全不同：
        // 后者点一下就能补授权，前者补了也没用。不留痕就无法区分。
        logDegraded('options', '站点访问权限查询失败，按「未授权」提示', error);
        if (!cancelled) setPermissionLost(true);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.noCacheEnabled]);

  const requestSiteAccess = () => requestPermissions(SITE_ACCESS);

  const handleToggle = async (enabled: boolean) => {
    if (enabled) {
      // permissions.request 必须在用户手势内首发调用（Toggle onChange 满足）。
      const granted = await requestSiteAccess();
      if (!granted) {
        setDenied(true);
        return;
      }
      setDenied(false);
    }
    update('noCacheEnabled', enabled);
  };

  const regrant = async () => {
    const granted = await requestSiteAccess();
    if (granted) {
      setPermissionLost(false);
      setDenied(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Toggle
        checked={settings.noCacheEnabled}
        onChange={(enabled) => void handleToggle(enabled)}
        ariaLabel={t('开发者：指定站点禁用缓存')}
      />
      {denied && !settings.noCacheEnabled && (
        <span className="text-3xs text-red-600">{t('未授予网站权限，功能未开启')}</span>
      )}
      {permissionLost && settings.noCacheEnabled && (
        <span className="flex items-center gap-1.5 text-3xs text-warn-600">
          {t('网站权限已失效，规则未生效')}
          <Button variant="secondary" size="sm" onClick={() => void regrant()}>
            {t('重新授权')}
          </Button>
        </span>
      )}
    </div>
  );
}
