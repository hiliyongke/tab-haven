import { browser } from 'wxt/browser';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 可选权限（optional_host_permissions）查询与申请。
 *
 * 收敛到 platform 的原因：权限是「能力边界」，查询与申请必须成对出现在同一处，
 * 且失败必须可观测 —— 此前入口层各自处理，请求被拒时用户得不到任何反馈。
 */

/** 与浏览器 API 同形的查询体（直接复用其参数类型，避免自造一套许可名枚举）。 */
export type PermissionQuery = Parameters<typeof browser.permissions.contains>[0];

/** 是否持有指定权限（API 不可用或查询失败时返回 false）。 */
export async function hasPermissions(query: PermissionQuery): Promise<boolean> {
  try {
    return (await browser.permissions.contains(query)) === true;
  } catch (error) {
    logDegraded('permissions', '权限查询失败', error);
    return false;
  }
}

/**
 * 申请指定权限。
 *
 * 注意：必须在用户手势内首发调用（如开关的 onChange），否则浏览器直接拒绝。
 * @returns 用户是否授予；API 不可用或调用异常返回 false。
 */
export async function requestPermissions(query: PermissionQuery): Promise<boolean> {
  try {
    return (await browser.permissions.request(query)) === true;
  } catch (error) {
    // 不在用户手势内调用、或用户拒绝，都会走到这里：都要留痕，
    // 否则「点开关没反应」无从排查。
    logDegraded('permissions', '权限申请失败或被拒绝', error);
    return false;
  }
}
