import { getRepositories } from '@/platform/registry';

/**
 * 共享持久化仓库单例（storage key 的唯一权威出处）。
 * 实例化已收口到组合根 `src/platform/registry.ts`；此处仅以具名常量重新导出默认实例，
 * 供 background / options / snapshot 等消费方零改动沿用。运行时不可替换（registry 不提供注入 setter）。
 * 所有写入都经过 zod 校验（见 DataRepository）。
 */

// 引用组合根默认实例，保证与 getRepositories() 返回的是同一组对象。
const current = getRepositories();

// 只导出消费方使用的实例；其他仓库通过 getRepositories() 按需获取。
export const foldersRepository = current.folders;
export const pinsRepository = current.pins;
export const settingsRepository = current.settings;
export const undoRepository = current.undo;
export const redoRepository = current.redo;
export const autoGroupsRepository = current.autoGroups;
export const autoDiscardRepository = current.autoDiscard;
export const snapshotsRepository = current.snapshots;

export { getRepositories } from '@/platform/registry';
