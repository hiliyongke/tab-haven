/**
 * 保留策略独立模块（与 DuplicateIndex 同目录导出，语义见 DuplicateIndex 文档）。
 * 单独文件便于扩展（如按域名规则定制保留偏好）。
 */

export { KeeperPolicy, type DuplicateGroup } from './DuplicateIndex';
