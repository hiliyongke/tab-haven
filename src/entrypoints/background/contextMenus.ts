import { browser } from 'wxt/browser';
import type { FixedFolder } from '@/core/schema/models';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { canSafelyDiscardTab } from '@/core/tab-types';
import { createFolderItem } from '@/core/fixed/FolderOps';
import { mapTab } from '@/platform/tabs';
import { foldersRepository, settingsRepository } from '@/platform/storage/repositories';
import { FOLDERS_RMW_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';
import { t } from '@/i18n/headless';
import { notifyUser } from './shared';

export const MENU_IDS = {
  pageDiscard: 'th:page:discard',
  pagePin: 'th:page:pin',
  pageSearchSite: 'th:page:search-site',
  pageFolderParent: 'th:page:folder-parent',
  linkFolderParent: 'th:link:folder-parent',
  tabDiscard: 'th:tab:discard',
  tabSearchSite: 'th:tab:search-site',
  actionOpenPanel: 'th:action:open-panel',
  actionDiscardInactive: 'th:action:discard-inactive',
  actionSettings: 'th:action:settings'
} as const;

/** contextMenus 标题的 i18n 消息键（与 _locales 一一对应）。 */
type MenuMessageKey =
  | 'menuDiscardPage'
  | 'menuPinPage'
  | 'menuSearchSite'
  | 'menuAddPageToFolder'
  | 'menuAddLinkToFolder'
  | 'menuDiscardTab'
  | 'menuOpenPanel'
  | 'menuDiscardInactive'
  | 'menuOpenSettings';

// getMessage 缺失时返回空串而非 null/undefined，须用 || 兜底。
const menuText = (key: MenuMessageKey): string => browser.i18n.getMessage(key) || key;

/**
 * 菜单写操作串行队列：rebuild/removeAll 可由 folders watch、settings watch、
 * setupMenus 并发触发，removeAll 与 create 交错会产生重复 id 的 rejection，
 * 全部菜单写操作经此队列串行执行；单次失败只告警不阻塞后续。
 */
let menuWriteChain: Promise<void> = Promise.resolve();

function enqueueMenuWrite(task: () => Promise<void>): void {
  menuWriteChain = menuWriteChain.then(() =>
    task().catch((error) => console.warn('[contextMenus] write failed', error))
  );
}

export function clearContextMenus(): void {
  const menus = browser.contextMenus;
  if (!menus) return;
  enqueueMenuWrite(() => menus.removeAll());
}

/** 重建右键菜单（文件夹列表变化时刷新子菜单；串行，先清后建）。 */
export function rebuildContextMenus(folders: readonly FixedFolder[]): void {
  const menus = browser.contextMenus;
  if (!menus) return;
  enqueueMenuWrite(async () => {
    await menus.removeAll();
    // 页面右键
    await menus.create({
      id: MENU_IDS.pageDiscard,
      title: menuText('menuDiscardPage'),
      contexts: ['page']
    });
    await menus.create({
      id: MENU_IDS.pagePin,
      title: menuText('menuPinPage'),
      contexts: ['page']
    });
    await menus.create({
      id: MENU_IDS.pageSearchSite,
      title: menuText('menuSearchSite'),
      contexts: ['page']
    });
    if (folders.length > 0) {
      await menus.create({
        id: MENU_IDS.pageFolderParent,
        title: menuText('menuAddPageToFolder'),
        contexts: ['page']
      });
      for (const folder of folders) {
        await menus.create({
          id: `th:page:add-folder:${folder.id}`,
          title: folder.name,
          parentId: MENU_IDS.pageFolderParent,
          contexts: ['page']
        });
      }
    }
    // 链接右键
    if (folders.length > 0) {
      await menus.create({
        id: MENU_IDS.linkFolderParent,
        title: menuText('menuAddLinkToFolder'),
        contexts: ['link']
      });
      for (const folder of folders) {
        await menus.create({
          id: `th:link:add-folder:${folder.id}`,
          title: folder.name,
          parentId: MENU_IDS.linkFolderParent,
          contexts: ['link']
        });
      }
    }
    // 标签栏右键
    await menus.create({
      id: MENU_IDS.tabDiscard,
      title: menuText('menuDiscardTab'),
      contexts: ['tab']
    });
    await menus.create({
      id: MENU_IDS.tabSearchSite,
      title: menuText('menuSearchSite'),
      contexts: ['tab']
    });
    // 工具栏图标右键
    await menus.create({
      id: MENU_IDS.actionOpenPanel,
      title: menuText('menuOpenPanel'),
      contexts: ['action']
    });
    await menus.create({
      id: MENU_IDS.actionDiscardInactive,
      title: menuText('menuDiscardInactive'),
      contexts: ['action']
    });
    await menus.create({
      id: MENU_IDS.actionSettings,
      title: menuText('menuOpenSettings'),
      contexts: ['action']
    });
  });
}

/** 把单个条目加入固定文件夹（URL 全局唯一；绑定由面板 reconcile 自动建立）。 */
export async function addEntryToFolder(
  folderId: string,
  entry: { url: string; title: string; favIconUrl?: string }
): Promise<boolean> {
  // 跨页锁内重读再合并：面板 coalesced「末值落盘」在途时，锁外的
  // read-modify-write 会被后写覆盖（新增条目静默丢失）。与面板共用 FOLDERS_RMW_LOCK。
  return withCrossPageLock(FOLDERS_RMW_LOCK, async () => {
    const folders = await foldersRepository.read();
    const target = folders.find((folder) => folder.id === folderId);
    if (!target) return false;
    // 非 http(s) 一律拒绝，不回落到原始字符串：右键的 linkUrl 由被点击页面提供，
    // 页面可控；javascript: / data: 等一旦落库，用户点一下固定图标即执行。
    const key = webComparisonKey(entry.url, undefined);
    if (key === null) return false;
    const exists = folders.some((folder) =>
      folder.items.some((item) => webComparisonKey(item.url, undefined) === key)
    );
    if (exists) return false;
    const item = createFolderItem({ url: key, title: entry.title, favIconUrl: entry.favIconUrl });
    const next = folders.map((folder) =>
      folder.id === folderId
        ? { ...folder, collapsed: false, items: [...folder.items, item] }
        : folder
    );
    const ok = await foldersRepository.write(next);
    // write 返回 boolean：quota 超限时落盘失败，若照常返回 true，用户收到
    // 「已添加」通知而条目重启即丢——按真实结果反馈。
    if (!ok) {
      notifyUser('Tabs', t('bg.addToFolderFailed'));
      return false;
    }
    return true;
  });
}

/** 休眠单个标签（带安全判定与结果通知）。 */
export async function discardTabSafely(
  rawTab: Parameters<typeof mapTab>[0] | undefined
): Promise<boolean> {
  if (!rawTab || rawTab.id === undefined) return false;
  const tab = mapTab(rawTab);
  if (!canSafelyDiscardTab(tab)) {
    notifyUser('Tabs', t('bg.discardNotSafe'));
    return false;
  }
  const ok = await browser.tabs
    .discard(tab.id)
    .then(() => true)
    .catch(() => false);
  if (ok) notifyUser('Tabs', t('bg.discardDone'));
  return ok;
}

/** 注册/刷新右键菜单（按设置开关与当前文件夹列表）。 */
export async function setupMenus(): Promise<void> {
  const [folders, settings] = await Promise.all([
    foldersRepository.read(),
    settingsRepository.read()
  ]);
  if (!settings.contextMenusEnabled) {
    clearContextMenus();
    return;
  }
  rebuildContextMenus(folders);
}
