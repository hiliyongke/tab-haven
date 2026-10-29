import { browser } from 'wxt/browser';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 可选权限（optional_host_permissions）查询与申请。
 * 收敛到 platform：权限是能力边界，查询与申请必须成对出现在同一处，失败必须可观测。
 */

/** 与浏览器 API 同形的查询体（复用其参数类型，避免自造许可名枚举）。 */
export type PermissionQuery = Parameters<typeof browser.permissions.contains>[0];

/**
 * 权限查询结果（三态，不是布尔）。
 * 「查不到」与「没授权」后果不同：查不到时按未授权处理会让调用方主动拆掉已生效的能力
 * （如清空全部 DNR 动态规则），一次瞬时异常就让功能自己消失。三态让调用方在 unknown 时保留现状。
 */
export type PermissionState = 'granted' | 'denied' | 'unknown';

/**
 * 查询是否持有指定权限（三态）。
 * 只在 API 明确回答 `true` 时为 granted；明确 false / 查询异常分别归 denied / unknown。
 */
export async function checkPermissions(query: PermissionQuery): Promise<PermissionState> {
  try {
    return (await browser.permissions.contains(query)) === true ? 'granted' : 'denied';
  } catch (error) {
    logDegraded('permissions', '权限查询失败，本次按「未知」处理（不改变现有能力）', error);
    return 'unknown';
  }
}

/**
 * 布尔口径（仅供「只关心能不能用」的调用方）。
 * `unknown` 在此归为 false；需要「保留现状而非撤除」语义的调用方必须改用 `checkPermissions`。
 */
export async function hasPermissions(query: PermissionQuery): Promise<boolean> {
  return (await checkPermissions(query)) === 'granted';
}

/**
 * 申请指定权限。必须在用户手势内首发调用（如开关 onChange），否则浏览器直接拒绝。
 * @returns 用户是否授予；API 不可用或调用异常返回 false。
 */
export async function requestPermissions(query: PermissionQuery): Promise<boolean> {
  try {
    return (await browser.permissions.request(query)) === true;
  } catch (error) {
    // 不在手势内调用或用户拒绝都走到这里，都要留痕，否则「点开关没反应」无从排查。
    logDegraded('permissions', '权限申请失败或被拒绝', error);
    return false;
  }
}
