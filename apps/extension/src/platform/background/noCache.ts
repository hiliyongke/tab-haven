import { browser } from 'wxt/browser';
import { type Settings } from '@/core/schema/models';
import { buildNoCacheDnrRules, type NoCacheDnrRule } from '@/platform/nocache/noCacheRules';
import { settingsRepository } from '@/platform/storage/repositories';
import { checkPermissions, type PermissionState } from '@/platform/permissions';
import { logDegraded } from '@/platform/diagnostics';
import { createSerialChain } from '@/core/util/concurrency';

/**
 * 开发者禁缓存能力（SW 侧编排）：设置变更 / SW 启动 → DNR 动态规则全量同步
 * （modifyHeaders 强制 no-store）。命中状态由 TabRow 角标展示，不注入页面横幅。
 * host 权限走 optional（<all_urls>），未授权时规则不生效；授权请求由设置页发起。
 */

/** DNR updateDynamicRules 的规则入参类型（从 API 签名反查，避免手写同步）。 */
type DnrApiRule = NonNullable<
  Parameters<typeof browser.declarativeNetRequest.updateDynamicRules>[0]['addRules']
>[number];

const ALL_URLS_PERMISSION = { origins: ['<all_urls>'] };
const noCacheSyncChain = createSerialChain();

/**
 * 是否持有 optional 全站 host 权限。必须三态：contains 抛错与「确实没授权」若都
 * 塌缩成 false，一次瞬时异常就会撤掉已生效的 DNR 规则，禁缓存静默失效。
 */
function siteAccessPermission(): Promise<PermissionState> {
  return checkPermissions(ALL_URLS_PERMISSION);
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
async function syncNoCacheRulesNow(settings: Settings): Promise<void> {
  const dnr = browser.declarativeNetRequest;
  try {
    const permitted = await siteAccessPermission();
    if (permitted === 'unknown') {
      // 保留现状：撤掉已生效规则会把故障放大成功能失效，什么都不做最坏只是本次同步没对齐
      // （下一次设置变更 / 权限变化 / SW 启动会重试）。
      logDegraded('no-cache', '权限查询结果未知，本次同步保留现有禁缓存规则不做改动');
      return;
    }
    const addRules =
      settings.noCacheEnabled && permitted === 'granted' && settings.noCachePatterns.length > 0
        ? buildNoCacheDnrRules(settings.noCachePatterns).map(toApiRule)
        : [];
    const removeRuleIds = (await dnr.getDynamicRules()).map((rule) => rule.id);
    if (removeRuleIds.length > 0 || addRules.length > 0) {
      await dnr.updateDynamicRules({ removeRuleIds, addRules });
    }
  } catch (error) {
    // 必须进诊断导出：DNR 同步失败时禁缓存能力静默失效，用户无从察觉。
    logDegraded('no-cache', '禁缓存规则同步失败', error);
  }
}

/** 串行完成整轮权限读取与规则替换，保证较晚的设置最终覆盖较早的同步请求。 */
export function syncNoCacheRules(settings: Settings): Promise<void> {
  return noCacheSyncChain.enqueue(() => syncNoCacheRulesNow(settings));
}

/** 将设置读取也放进串行链，避免迟到的启动/权限读取结果覆盖后续设置事件。 */
function enqueueCurrentSettingsSync(failureMessage: string): Promise<void> {
  return noCacheSyncChain
    .enqueue(async () => {
      const settings = await settingsRepository.read();
      await syncNoCacheRulesNow(settings);
    })
    .catch((error: unknown) => {
      logDegraded('no-cache', failureMessage, error);
    });
}

/** SW 入口：启动对齐 + 设置监听 + 权限变化监听。 */
export function setupNoCache(): void {
  // 仅写入诊断日志，不作为界面文案。
  // @i18n-ignore
  void enqueueCurrentSettingsSync('禁缓存规则同步：读取设置失败，本次同步未对齐');
  settingsRepository.watch((settings) => {
    void syncNoCacheRules(settings);
  });

  // 用户在浏览器设置中手动增删 optional host 权限时重新对齐规则。
  const onPermissionChanged = () => {
    // 仅写入诊断日志，不作为界面文案。
    // @i18n-ignore
    void enqueueCurrentSettingsSync('权限变化后重对齐禁缓存规则失败');
  };
  browser.permissions.onAdded?.addListener(onPermissionChanged);
  browser.permissions.onRemoved?.addListener(onPermissionChanged);
}
