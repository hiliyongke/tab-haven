import { getRepositories } from '@/platform/registry';

/**
 * 共享持久化仓库单例（storage key 的唯一权威出处）。
 *
 * 实例化已收口到组合根 `src/platform/registry.ts`；此处仅以具名常量
 * 重新导出默认实例，供 background / options / snapshot 等消费方零改动沿用。
 * 需要注入测试假实现的消费方（如 dataStore）应通过 `getRepositories()`
 * 取用，以便 `setRepositoriesForTest()` 生效。
 *
 * 所有写入都经过 zod 校验（见 DataRepository）。
 */

// 引用组合根默认实例，保证与 getRepositories() 返回的是同一组对象。
const current = getRepositories();

export const foldersRepository = current.folders;
export const pinsRepository = current.pins;
export const collapseRepository = current.collapse;
export const settingsRepository = current.settings;
export const undoRepository = current.undo;
export const autoGroupsRepository = current.autoGroups;
export const autoDiscardRepository = current.autoDiscard;
export const seededRepository = current.seeded;
export const snapshotsRepository = current.snapshots;

export { getRepositories } from '@/platform/registry';
