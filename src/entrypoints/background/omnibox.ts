import { browser } from 'wxt/browser';
import { createTabsWithUrls } from '@/platform/tabs';
import { foldersRepository, pinsRepository } from '@/platform/storage/repositories';
import { hostnameOf } from './shared';

// ---------------------------------------------------------------------------
// omnibox 地址栏命令
// ---------------------------------------------------------------------------

interface OmniSuggestion {
  content: string;
  description: string;
}

/** 实时建议：文件夹 / 固定条目 / 站内搜索。 */
async function queryOmnibox(text: string): Promise<OmniSuggestion[]> {
  const q = text.trim().toLowerCase();
  const [folders, pins] = await Promise.all([foldersRepository.read(), pinsRepository.read()]);
  const out: OmniSuggestion[] = [];
  for (const folder of folders) {
    if (!q || folder.name.toLowerCase().includes(q)) {
      out.push({ content: `folder:${folder.id}`, description: `Open folder: ${folder.name}` });
    }
  }
  for (const pin of pins) {
    const host = hostnameOf(pin.url);
    if (!q || host.includes(q) || pin.title.toLowerCase().includes(q)) {
      out.push({ content: `pin:${pin.url}`, description: `Open pinned: ${pin.title}` });
    }
  }
  if (q) {
    out.push({ content: `search:${q}`, description: `Search tabs for: ${q}` });
  }
  return out;
}

/** 回车处理：按建议类型打开。 */
async function handleOmniboxEnter(text: string): Promise<void> {
  const raw = text.trim();
  if (raw.startsWith('folder:')) {
    const id = raw.slice('folder:'.length);
    const folders = await foldersRepository.read();
    const folder = folders.find((f) => f.id === id);
    if (folder) await createTabsWithUrls(folder.items.map((i) => i.url));
    return;
  }
  if (raw.startsWith('pin:')) {
    const url = raw.slice('pin:'.length);
    await createTabsWithUrls([url]);
    return;
  }
  if (raw.startsWith('search:')) {
    const query = raw.slice('search:'.length);
    await browser.runtime.sendMessage({ type: 'search-domain', query }).catch(() => {});
    return;
  }
  // 纯文本默认站内搜索
  await browser.runtime.sendMessage({ type: 'search-domain', query: raw }).catch(() => {});
}

export { queryOmnibox, handleOmniboxEnter };
