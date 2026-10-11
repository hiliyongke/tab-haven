import { browser } from 'wxt/browser';
import { type Settings } from '@/core/schema/models';
import { buildNoCacheDnrRules, type NoCacheDnrRule } from '@/platform/nocache/noCacheRules';
import { settingsRepository } from '@/platform/storage/repositories';
import { hasPermissions } from '@/platform/permissions';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 开发者禁缓存能力（SW 侧编排）：
 *  - 设置变更 / SW 启动 → DNR 动态规则全量同步（modifyHeaders 强制 no-store）。
 *  - 用户感知交给侧边栏：TabRow 角标展示命中状态，页面本身不再注入横幅，
 *    避免遮挡原站内容。
 *
 * 权限模型：host 权限走 optional（`<all_urls>`），未授权时规则不生效；
 * UI 侧（设置页）负责在开启开关时发起授权请求，并在权限缺失时引导重新授权。
 */

/** DNR updateDynamicRules 的规则入参类型（从 API 签名反查，避免手写同步）。 */
type DnrApiRule = NonNullable<
  Parameters<typeof browser.declarativeNetRequest.updateDynamicRules>[0]['addRules']
>[number];

const ALL_URLS_PERMISSION = { origins: ['<all_urls>'] };

/** 是否已持有 optional 的全站 host 权限（未授权时 DNR modifyHeaders 不生效）。 */
function hasSiteAccessPermission(): Promise<boolean> {
  return hasPermissions(ALL_URLS_PERMISSION);
}

/** 纯逻辑规则 → DNR API 规则（resourceTypes 为字符串字面量集合，是 ResourceType 枚举值的子集）。 */
function toApiRule(rule: NoCacheDnrRule): DnrApiRule {
  return {
    ...rule,
    condition: {
      ...rule.condition,
      resourceTypes: rule.condition.resourceTypes as DnrApiRule['condition']['resourceTypes']
    }
  };
}

/** 设置变更 / SW 启动：DNR 规则全量替换。 */
export async function syncNoCacheRules(settings: Settings): Promise<void> {
  const dnr = browser.declarativeNetRequest;
  try {
    const permitted = await hasSiteAccessPermission();
    const addRules =
      settings.noCacheEnabled && permitted && settings.noCachePatterns.length > 0
        ? buildNoCacheDnrRules(settings.noCachePatterns).map(toApiRule)
        : [];
    const removeRuleIds = (await dnr.getDynamicRules()).map((rule) => rule.id);
    if (removeRuleIds.length > 0 || addRules.length > 0) {
      await dnr.updateDynamicRules({ removeRuleIds, addRules });
    }
  } catch (error) {
    // 必须进诊断导出：DNR 同步失败时禁缓存能力静默失效，用户完全无从察觉。
    logDegraded('no-cache', '禁缓存规则同步失败', error);
  }
}

/** SW 入口：启动对齐 + 设置监听 + 权限变化监听。 */
export function setupNoCache(): void {
  void settingsRepository
    .read()
    .then((settings) => syncNoCacheRules(settings))
    .catch(() => {
      // 读取失败（坏数据隔离场景）保持现状，下一次 watch 会纠正
    });
  settingsRepository.watch((settings) => {
    void syncNoCacheRules(settings);
  });

  // 用户在浏览器设置中手动增删 optional host 权限时重新对齐规则。
  const onPermissionChanged = () => {
    void settingsRepository
      .read()
      .then((settings) => syncNoCacheRules(settings))
      .catch(() => {});
  };
  browser.permissions.onAdded?.addListener(onPermissionChanged);
  browser.permissions.onRemoved?.addListener(onPermissionChanged);
}
