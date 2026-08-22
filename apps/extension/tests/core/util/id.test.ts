import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@/core/util/id';

/**
 * 行为规格：全域 id 生成（`core/util/id`）。
 *
 * 契约只有一句：**要么都拿到 UUID，要么都走退化，不存在第三种行为**。
 * `crypto.randomUUID()` 散落五处（core 三处 + undo 一处 + 快照一处）时，
 * 只有快照那处写了退化路径，非安全上下文 / 旧引擎下各处表现不一致
 * （有的退化、有的直接崩）。这里把两条路径分别钉死。
 *
 * 环境说明：默认 node 环境，宿主 `crypto` 是 **只有 getter 的全局访问器**，
 * 故用 `defineProperty` 临时替换并在 afterEach 还原描述符 —— `vi.stubGlobal`
 * 走赋值路径，在 ESM 严格模式下对无 setter 的访问器会抛。
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FALLBACK_ID = /^[a-z0-9]*-[0-9a-z]+-[0-9a-z]{1,8}$/;

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

function stubCrypto(value: unknown): void {
  Object.defineProperty(globalThis, 'crypto', {
    value,
    configurable: true,
    writable: true,
    enumerable: cryptoDescriptor?.enumerable ?? false
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (cryptoDescriptor) {
    Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
  }
});

describe('newId —— 主路径（安全上下文，crypto.randomUUID 可用）', () => {
  it('返回 v4 UUID', () => {
    // Given 宿主提供 randomUUID
    // When 取一个 id
    const id = newId('snap');
    // Then 是标准 v4 UUID 形态
    expect(id).toMatch(UUID_V4);
  });

  it('直接委派给 crypto.randomUUID（只调一次，不自造实现）', () => {
    // Given 一个可观测的 randomUUID
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555');
    stubCrypto({ randomUUID });
    // When 取一个 id
    const id = newId('snap');
    // Then 返回值即 randomUUID 的返回值，且只调用一次
    expect(id).toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('连续调用不重复（uuid 空间足够，进程内不碰撞）', () => {
    // When 取 500 个
    const ids = new Set(Array.from({ length: 500 }, () => newId('item')));
    // Then 全部唯一
    expect(ids.size).toBe(500);
  });

  it('【已知偏差】主路径丢弃 prefix：id 不带调用方传入的前缀', () => {
    // Given 五个调用方分别传 'snap' / 'item' / 'folder' / 'pin' / 'undo'
    // When 在安全上下文取 id
    const id = newId('snap');
    // Then 结果是裸 UUID —— prefix 只在退化路径生效（见下一组用例）。
    // 这意味着同一个调用方在安全上下文与降级上下文拿到两种形态的 id；
    // 目前没有代码按前缀解析 id，故仅为形态漂移，不改实现，此处锁定现状。
    expect(id).not.toMatch(/^snap-/);
    expect(id).toMatch(UUID_V4);
  });
});

describe('newId —— 退化路径（非安全上下文 / 旧引擎）', () => {
  it('crypto 全局缺失时退化，且不抛异常', () => {
    // Given 无 crypto 全局（旧引擎）
    stubCrypto(undefined);
    // When 取 id
    const id = newId('snap');
    // Then 走退化：保留 prefix，形状为 prefix-时间戳-随机
    expect(id.startsWith('snap-')).toBe(true);
    expect(id).toMatch(FALLBACK_ID);
  });

  it('crypto 存在但没有 randomUUID 时退化', () => {
    // Given crypto 存在而 randomUUID 缺失（非安全上下文的典型形态）
    stubCrypto({});
    // When 取 id
    const id = newId('folder');
    // Then 走退化并保留 prefix
    expect(id.startsWith('folder-')).toBe(true);
    expect(id).toMatch(FALLBACK_ID);
  });

  it('randomUUID 抛错时被吞掉并退化（不向上冒泡）', () => {
    // Given randomUUID 存在但调用即抛（实现存在、权限不足）
    stubCrypto({
      randomUUID: () => {
        throw new Error('randomUUID is not available in this context');
      }
    });
    // When 取 id
    // Then 不抛异常，走退化
    expect(() => newId('undo')).not.toThrow();
    expect(newId('undo').startsWith('undo-')).toBe(true);
  });

  it('退化 id 的时间戳段随系统时间变化（base36 编码）', () => {
    // Given 冻结时间 + 缺失 randomUUID
    stubCrypto(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    // When 取一个 id 并与预期编码比对
    const id = newId('pin');
    // Then 时间戳段等于当前 Date.now() 的 36 进制
    expect(id).toBe(`pin-${Date.now().toString(36)}-${id.split('-').slice(-1)[0]}`);
    expect(id.split('-')[1]).toBe(Date.now().toString(36));
  });

  it('退化路径下连续调用不重复（同毫秒也靠随机段区分）', () => {
    // Given 冻结时间（时间戳段恒定）+ 缺失 randomUUID
    stubCrypto(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    // When 同一毫秒内取 500 个
    const ids = new Set(Array.from({ length: 500 }, () => newId('item')));
    // Then 仍全部唯一
    expect(ids.size).toBe(500);
  });

  it('前缀为空串时退化 id 以 - 开头（不产生无前缀的裸串）', () => {
    // Given 缺失 randomUUID + 空前缀
    stubCrypto(undefined);
    // When 取 id
    const id = newId('');
    // Then 形状仍稳定可解析
    expect(id.startsWith('-')).toBe(true);
    expect(id.split('-')).toHaveLength(3);
  });
});
