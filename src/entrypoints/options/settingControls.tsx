import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Settings } from '@/core/schema/models';
import { NO_CACHE_PATTERNS_LIMIT, normalizeNoCachePattern } from '@/core/nocache/noCachePattern';
import { hasPermissions, requestPermissions, type PermissionQuery } from '@/platform/permissions';
import { Button } from '@/ui/common/Button';
import { Icon, Icons } from '@/ui/common/Icon';
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

export function SectionCount({ count }: { count?: number }) {
  if (count === undefined) return null;
  return (
    <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-2xs leading-none text-gray-500">
      {count}
    </span>
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
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-gray-600">
        <span>{title}</span>
        <SectionCount count={count} />
      </h2>
      <div className="flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-200 bg-surface">
        {children}
      </div>
    </section>
  );
}

export function Row({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="text-sm text-gray-800">{label}</div>
        {hint && <div className="mt-0.5 text-2xs text-gray-600">{hint}</div>}
      </div>
      {/* 窄屏下控件撑满整行（右对齐改为起始对齐，避免长文本域溢出） */}
      <div className="w-full shrink-0 sm:w-auto sm:pl-4">{children}</div>
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
  const add = () => {
    const host = input
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./, '');
    if (!host) return;
    if (!value.includes(host)) onChange([...value, host]);
    setInput('');
  };
  return (
    <div className="flex w-full flex-col items-end gap-1.5 sm:w-auto">
      {value.length > 0 && (
        <ul className="flex max-w-full flex-wrap justify-end gap-1 sm:max-w-[240px]">
          {value.map((entry) => (
            <li
              key={entry}
              className="flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-2xs text-gray-600"
            >
              {entry}
              <button
                type="button"
                aria-label={t('settings.whitelistRemove')}
                title={t('settings.whitelistRemove')}
                onClick={() => onChange(value.filter((v) => v !== entry))}
                /* whitelist-remove 透明扩区：12px 图标命中区远低于 WCAG 2.5.8 的 24px */
                className="whitelist-remove text-gray-500 hover:text-gray-600"
              >
                <Icon d={Icons.close} className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1">
        <TextField
          size="sm"
          className="w-32"
          placeholder={t('settings.whitelistPlaceholder')}
          ariaLabel={t('settings.whitelistPlaceholder')}
          value={input}
          onChange={setInput}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
        />
        <Button variant="secondary" size="sm" onClick={add}>
          {t('settings.whitelistAdd')}
        </Button>
      </div>
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
  const [text, setText] = useState(() => value.join('\n'));
  const [invalidCount, setInvalidCount] = useState(0);
  /** 最近一次与设置对齐的文本（防「保存 → settings 回流 → 重置光标」循环）。 */
  const lastSyncedRef = useRef(value.join('\n'));
  const full = value.length >= NO_CACHE_PATTERNS_LIMIT;

  // 外部变更（重置设置 / 导入备份）同步进文本框；内容一致时跳过。
  useEffect(() => {
    const joined = value.join('\n');
    if (joined !== lastSyncedRef.current) {
      lastSyncedRef.current = joined;
      setText(joined);
    }
  }, [value]);

  const commit = () => {
    const lines = text
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
    if (joined !== lastSyncedRef.current) {
      lastSyncedRef.current = joined;
      onChange(next);
    }
    // 文本框规整为归一化后的权威列表（无效行移除、空行压缩）。
    if (text !== joined) setText(joined);
  };

  return (
    <div className="flex w-full flex-col items-end gap-1 sm:w-96">
      <TextField
        multiline
        rows={5}
        resize
        className="font-mono leading-5"
        placeholder={t('settings.noCachePatternPlaceholder')}
        ariaLabel={t('settings.noCachePatterns')}
        inputProps={{ spellCheck: false }}
        value={text}
        onChange={(next) => {
          setText(next);
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
        <span className="min-w-0 truncate text-2xs text-gray-500">
          {invalidCount > 0
            ? t('settings.noCachePatternInvalidLines', { count: invalidCount })
            : t('settings.noCachePatternHelp')}
        </span>
        <Button variant="secondary" size="sm" onClick={commit}>
          {t('settings.noCachePatternSave')}
        </Button>
      </div>
      {full && <span className="text-2xs text-gray-500">{t('settings.noCachePatternFull')}</span>}
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
      .catch(() => {
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
        ariaLabel={t('settings.noCache')}
      />
      {denied && !settings.noCacheEnabled && (
        <span className="text-2xs text-red-600">{t('settings.noCachePermissionDenied')}</span>
      )}
      {permissionLost && settings.noCacheEnabled && (
        <span className="flex items-center gap-1.5 text-2xs text-warn-600">
          {t('settings.noCachePermissionLost')}
          <Button variant="secondary" size="sm" onClick={() => void regrant()}>
            {t('settings.noCachePermissionRegrant')}
          </Button>
        </span>
      )}
    </div>
  );
}
