import { createTabsWithUrls } from '@/platform/tabs';
import { foldersRepository, pinsRepository } from '@/platform/storage/repositories';
import { hostnameOf, openSidePanel, queueAction } from './shared';

interface OmniSuggestion {
  content: string;
  description: string;
}

/**
 * 转义建议描述中的 XML 标记字符。
 *
 * Chrome 把 omnibox 的 description 当作受限 XML 解析（支持 `<url>` / `<match>` / `<dim>`），
 * 而文件夹名与固定条目标题可来自**导入的备份文件**——含 `<url>` 之类片段时会被
 * 当成样式指令解析，轻则吞掉文案，重则把普通文本渲染成可点击链接的观感。
 */
function escapeSuggestionText(text: string): string {
  return text.replace(/[<>&]/g, (char) =>
    char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&amp;'
  );
}

/** 仅 http(s) 才允许经地址栏打开（固定图标可来自导入的备份）。 */
function isOpenableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** 实时建议：文件夹 / 固定条目 / 站内搜索。 */
async function queryOmnibox(text: string): Promise<OmniSuggestion[]> {
  const q = text.trim().toLowerCase();
  const [folders, pins] = await Promise.all([foldersRepository.read(), pinsRepository.read()]);
  const out: OmniSuggestion[] = [];
  for (const folder of folders) {
    if (!q || folder.name.toLowerCase().includes(q)) {
      out.push({
        content: `folder:${folder.id}`,
        description: `Open folder: ${escapeSuggestionText(folder.name)}`
      });
    }
  }
  for (const pin of pins) {
    // 非 http(s) 的固定图标不给建议（同时下方回车路径也会再校验一次）。
    if (!isOpenableUrl(pin.url)) continue;
    const host = hostnameOf(pin.url);
    if (!q || host.includes(q) || pin.title.toLowerCase().includes(q)) {
      out.push({
        content: `pin:${pin.url}`,
        description: `Open pinned: ${escapeSuggestionText(pin.title)}`
      });
    }
  }
  if (q) {
    out.push({
      content: `search:${q}`,
      description: `Search tabs for: ${escapeSuggestionText(q)}`
    });
  }
  return out;
}

/** 回车处理：按建议类型打开。 */
async function handleOmniboxEnter(text: string, disposition?: string): Promise<void> {
  const raw = text.trim();
  const foreground = disposition === 'newForegroundTab';
  if (raw.startsWith('folder:')) {
    const id = raw.slice('folder:'.length);
    const folders = await foldersRepository.read();
    const folder = folders.find((f) => f.id === id);
    if (folder) {
      // url 可选：过滤掉尚未转正的待定条目，避免把 undefined 传给创建逻辑。
      const urls = folder.items.map((i) => i.url).filter((u): u is string => Boolean(u));
      await createTabsWithUrls(urls, undefined, foreground);
    }
    return;
  }
  if (raw.startsWith('pin:')) {
    const url = raw.slice('pin:'.length).trim();
    // 必须再校验一次：用户可以直接敲 `th pin:javascript:...` 而不选建议，
    // 建议列表的过滤拦不住手输内容。
    if (isOpenableUrl(url)) await createTabsWithUrls([url], undefined, foreground);
    return;
  }
  if (raw.startsWith('search:')) {
    const query = raw.slice('search:'.length);
    await runPanelSearch(query);
    return;
  }
  // 纯文本默认站内搜索
  await runPanelSearch(raw);
}

/**
 * 地址栏搜索：先开面板，再把搜索动作挂起投递。
 *
 * 旧实现只 `runtime.sendMessage`——面板未打开时无人接收，用户输入 `th 关键词`
 * 回车后毫无反馈，等同于功能失效。改为与快捷键一致的「开面板 + 队列」路径。
 */
async function runPanelSearch(query: string): Promise<void> {
  await openSidePanel().catch(() => undefined);
  await queueAction({ type: 'search-domain', query });
}

export { queryOmnibox, handleOmniboxEnter };
