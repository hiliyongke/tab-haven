/**
 * 归组键：站点的身份标识（同一键的标签归入同一虚拟站点组）。
 *
 * 键的三种形态（由 SiteResolver 依据主机类型产出）：
 *  - 注册域（eTLD+1，如 tencent.com）
 *  - 托管域三级（如 user.github.io）
 *  - 本地/IP 带端口主机（如 localhost:3000）
 */

export interface SiteKey {
  /** 归组标识（比较与聚合用）。 */
  value: string;
  /** 展示标签（默认与 value 一致）。 */
  label: string;
  /** 注册域；本地/IP 场景为原始主机。 */
  registrableDomain: string;
  /** 子域部分（不含 www）；无子域为空串。 */
  subdomain: string;
}
