import { browser } from 'wxt/browser';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 可选权限（optional_host_permissions）查询与申请。
 *
 * 收敛到 platform 的原因：权限是「能力边界」，查询与申请必须成对出现在同一处，
 * 且失败必须可观测 —— 入口层各自处理时，请求被拒用户得不到任何反馈。
 */

/** 与浏览器 API 同形的查询体（直接复用其参数类型，避免自造一套许可名枚举）。 */
export type PermissionQuery = Parameters<typeof browser.permissions.contains>[0];

/**
 * 权限查询结果（三态，不是布尔）。
 *
 * 「查不到」与「没授权」在后果上完全不同：查不到时按未授权处理会让调用方**主动拆掉
 * 已经生效的能力**（如清空全部 DNR 动态规则），一次 `permissions.contains` 的瞬时
 * 异常就把用户正在用的功能撤了，且表现为「功能自己消失了」。三态让调用方得以在
 * unknown 时保留现状。
 */
export type PermissionState = 'granted' | 'denied' | 'unknown';

/**
 * 查询是否持有指定权限（三态）。
 *
 * 只在 API 明确回答 `true` 时才是 granted：其余情况（明确 false / 查询异常）
 * 分别归为 denied / unknown，不再塌缩成同一个 false。
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
 * 是否持有指定权限（布尔口径，仅供「只关心能不能用」的调用方）。
 *
 * 注意：`unknown` 在此归为 false。需要「保留现状而非撤除」语义的调用方
 * （如 DNR 规则同步）必须改用 `checkPermissions` 的三态。
 */
export async function hasPermissions(query: PermissionQuery): Promise<boolean> {
  return (await checkPermissions(query)) === 'granted';
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
