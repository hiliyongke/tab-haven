import { browser } from 'wxt/browser';
import type { FixedFolder } from '@/core/schema/models';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { canSafelyDiscardTab } from '@/core/tab-types';
import { createFolderItem } from '@/core/fixed/FolderOps';
import { createSerialChain } from '@/core/util/concurrency';
import { mapTab } from '@/platform/tabs';
import { foldersRepository, settingsRepository } from '@/platform/storage/repositories';
import { FOLDERS_RMW_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';
import { logDegraded } from '@/platform/diagnostics';
import { t } from '@/i18n/headless';
import { notifyUser } from './shared';

/**
 * 右键菜单项 id（前缀即上下文：`page` 网页 / `link` 链接 / `tab` 标签栏 / `action` 工具栏图标）。
 * id 是稳定的对外契约，改动需同步 `_locales` 与点击分发。
 */
export const MENU_IDS = {
  pageDiscard: 'th:page:discard',
  pagePin: 'th:page:pin',
  pageSearchSite: 'th:page:search-site',
  pageFolderParent: 'th:page:folder-parent',
  linkFolderParent: 'th:link:folder-parent',
  tabDiscard: 'th:tab:discard',
  tabPin: 'th:tab:pin',
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
const menuWriteChain = createSerialChain();

function enqueueMenuWrite(task: () => Promise<void>): void {
  void menuWriteChain.enqueueSettled(task, (error) =>
    // 走诊断管道而非 console.warn：本模块运行在 SW 上下文，那里 console 的输出
    // 无法被 readAllDiagnostics / 「导出诊断」读到（同 ReuseCoordinator 的纪律）。
    logDegraded('contextMenus', '右键菜单写入失败', error)
  );
}

/** 清空全部右键菜单（关闭菜单开关或重建前调用）。 */
export function clearContextMenus(): void {
  const menus = browser.contextMenus;
  if (!menus) return;
  enqueueMenuWrite(() => menus.removeAll());
}

/**
 * 单条菜单创建：失败只丢这一项，不中断整批。
 *
 * Chrome 对不支持的 contexts 值（如较新内核才支持的 `tab`）直接在 create 处抛错。
 * 整批 create 串行 await 时，首项抛错即中断：removeAll 已执行，后续菜单（含工具栏
 * 的「打开面板」）全部不会创建，而错误只落诊断 —— 表现为右键菜单大面积消失且
 * 用户无从知晓。逐项兜底后，不支持的上下文只是自己不出现，其余菜单照常。
 */
async function createMenuItem(
  menus: NonNullable<typeof browser.contextMenus>,
  props: Parameters<NonNullable<typeof browser.contextMenus>['create']>[0]
): Promise<void> {
  try {
    await menus.create(props);
  } catch (error) {
    logDegraded('contextMenus', `右键菜单创建失败，已跳过该项：${String(props.id)}`, error);
  }
}

/** 重建右键菜单（文件夹列表变化时刷新子菜单；串行，先清后建）。 */
export function rebuildContextMenus(folders: readonly FixedFolder[]): void {
  const menus = browser.contextMenus;
  if (!menus) return;
  enqueueMenuWrite(async () => {
    await menus.removeAll();
    // 页面右键
    await createMenuItem(menus, {
      id: MENU_IDS.pageDiscard,
      title: menuText('menuDiscardPage'),
      contexts: ['page']
    });
    await createMenuItem(menus, {
      id: MENU_IDS.pagePin,
      title: menuText('menuPinPage'),
      contexts: ['page']
    });
    await createMenuItem(menus, {
      id: MENU_IDS.pageSearchSite,
      title: menuText('menuSearchSite'),
      contexts: ['page']
    });
    if (folders.length > 0) {
      await createMenuItem(menus, {
        id: MENU_IDS.pageFolderParent,
        title: menuText('menuAddPageToFolder'),
        contexts: ['page']
      });
      for (const folder of folders) {
        await createMenuItem(menus, {
          id: `th:page:add-folder:${folder.id}`,
          title: folder.name,
          parentId: MENU_IDS.pageFolderParent,
          contexts: ['page']
        });
      }
    }
    // 链接右键
    if (folders.length > 0) {
      await createMenuItem(menus, {
        id: MENU_IDS.linkFolderParent,
        title: menuText('menuAddLinkToFolder'),
        contexts: ['link']
      });
      for (const folder of folders) {
        await createMenuItem(menus, {
          id: `th:link:add-folder:${folder.id}`,
          title: folder.name,
          parentId: MENU_IDS.linkFolderParent,
          contexts: ['link']
        });
      }
    }
    // 工具栏图标右键（先建：这是最稳定的入口，不能因下方较新上下文失败而丢失）
    await createMenuItem(menus, {
      id: MENU_IDS.actionOpenPanel,
      title: menuText('menuOpenPanel'),
      contexts: ['action']
    });
    await createMenuItem(menus, {
      id: MENU_IDS.actionDiscardInactive,
      title: menuText('menuDiscardInactive'),
      contexts: ['action']
    });
    await createMenuItem(menus, {
      id: MENU_IDS.actionSettings,
      title: menuText('menuOpenSettings'),
      contexts: ['action']
    });
    // 标签栏右键（contexts: 'tab' 需较新 Chrome，不支持时逐项跳过）
    await createMenuItem(menus, {
      id: MENU_IDS.tabDiscard,
      title: menuText('menuDiscardTab'),
      contexts: ['tab']
    });
    // 标签栏「固定」：与 page 上下文的同语义项共用 menuPinPage 文案
    // （menuSearchSite 同为跨 page、tab 两个上下文复用同一键）。
    await createMenuItem(menus, {
      id: MENU_IDS.tabPin,
      title: menuText('menuPinPage'),
      contexts: ['tab']
    });
    await createMenuItem(menus, {
      id: MENU_IDS.tabSearchSite,
      title: menuText('menuSearchSite'),
      contexts: ['tab']
    });
  });
}

/**
 * 加入固定文件夹的三种结局。
 *
 * 三态（而非布尔）是必需的：写入失败与「已存在」若都返回 false，调用方只能统一
 * 提示「已在文件夹中」——写失败的用户会收到一条与事实相反的通知，且内部还额外
 * 发了一条失败通知（两条通知互相矛盾）。
 */
export type AddEntryResult = 'added' | 'exists' | 'failed';

/** 把单个条目加入固定文件夹（URL 全局唯一；绑定由面板 reconcile 自动建立）。 */
export async function addEntryToFolder(
  folderId: string,
  entry: { url: string; title: string; favIconUrl?: string }
): Promise<AddEntryResult> {
  // 跨页锁内重读再合并：面板 coalesced「末值落盘」在途时，锁外的
  // read-modify-write 会被后写覆盖（新增条目静默丢失）。与面板共用 FOLDERS_RMW_LOCK。
  return withCrossPageLock(FOLDERS_RMW_LOCK, async () => {
    const folders = await foldersRepository.read();
    const target = folders.find((folder) => folder.id === folderId);
    if (!target) return 'failed';
    // 非 http(s) 一律拒绝，不回落到原始字符串：右键的 linkUrl 由被点击页面提供，
    // 页面可控；javascript: / data: 等一旦落库，用户点一下固定图标即执行。
    const key = webComparisonKey(entry.url, undefined);
    if (key === null) return 'failed';
    const exists = folders.some((folder) =>
      folder.items.some((item) => webComparisonKey(item.url, undefined) === key)
    );
    if (exists) return 'exists';
    const item = createFolderItem({ url: key, title: entry.title, favIconUrl: entry.favIconUrl });
    const next = folders.map((folder) =>
      folder.id === folderId
        ? { ...folder, collapsed: false, items: [...folder.items, item] }
        : folder
    );
    const ok = await foldersRepository.write(next);
    // write 返回 boolean：quota 超限时落盘失败，若照常返回成功，用户收到
    // 「已添加」通知而条目重启即丢——按真实结果反馈。
    if (!ok) {
      // 只有失败分支在此发通知：成功与「已存在」由调用方按结果各发一次，
      // 避免同一动作出现两条语义冲突的通知。
      notifyUser('Tabs', t('保存失败，请重试'));
      return 'failed';
    }
    return 'added';
  });
}

/** 休眠单个标签（带安全判定与结果通知）。 */
export async function discardTabSafely(
  rawTab: Parameters<typeof mapTab>[0] | undefined
): Promise<boolean> {
  if (!rawTab || rawTab.id === undefined) return false;
  const tab = mapTab(rawTab);
  if (!canSafelyDiscardTab(tab)) {
    notifyUser('Tabs', t('这个标签正在使用（播放声音或尚未加载完），无法休眠'));
    return false;
  }
  let ok: boolean;
  try {
    await browser.tabs.discard(tab.id);
    ok = true;
  } catch {
    // 已被关闭 / 正在播放音频等浏览器拒绝：按失败反馈，不逃逸为 unhandled rejection。
    ok = false;
  }
  if (ok) notifyUser('Tabs', t('已休眠标签'));
  return ok;
}

/**
 * 注册/刷新右键菜单（按设置开关与当前文件夹列表）。
 *
 * 内部自行兜住异常：调用方（`background.ts` 的 onInstalled / onStartup /
 * settings watch）都是 `void setupMenus()` 的一次性触发点，reject 会变成
 * 无归属的 unhandled rejection —— 菜单没建起来这件事在诊断里一条线索都没有。
 */
export async function setupMenus(): Promise<void> {
  try {
    const [folders, settings] = await Promise.all([
      foldersRepository.read(),
      settingsRepository.read()
    ]);
    if (!settings.contextMenusEnabled) {
      clearContextMenus();
      return;
    }
    rebuildContextMenus(folders);
  } catch (error) {
    logDegraded('contextMenus', '右键菜单重建失败', error);
  }
}
