// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { READLATER_LIMIT } from '@/core/schema/models';
import { useReadLaterStore } from '@/stores/readLaterStore';
import { readLaterRepository } from '@/platform/storage/repositories';

/**
 * 稍后读 store 行为规格（C3）：
 *  - 暂存去重（同 URL 重新变未读并刷新时间，不产生重复条目）；
 *  - 非 http(s) URL 一律拒绝（右键来源可被页面构造）；
 *  - 已读 / 全部已读 / 移除 / 批量移除（归档路径）。
 */

async function items() {
  return readLaterRepository.read();
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(async () => {
  await readLaterRepository.write([]);
  useReadLaterStore.setState({ items: [], ready: false });
});

describe('readLaterStore', () => {
  it('暂存标签并保持插入序', async () => {
    await useReadLaterStore.getState().addItem({ url: 'https://a.com/', title: 'A' });
    await useReadLaterStore.getState().addItem({ url: 'https://b.com/', title: 'B' });

    const list = await items();
    expect(list.map((item) => item.url)).toEqual(['https://a.com/', 'https://b.com/']);
    expect(list[0]!.readAt).toBeUndefined();
  });

  it('同 URL 重新暂存：不产生重复，已读条目变未读并刷新时间', async () => {
    await useReadLaterStore.getState().addItem({ url: 'https://a.com/', title: 'A' });
    await useReadLaterStore.getState().markRead((await items())[0]!.id);
    expect((await items())[0]!.readAt).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 5));
    await useReadLaterStore.getState().addItem({ url: 'https://a.com/', title: 'A2' });

    const list = await items();
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('A2');
    expect(list[0]!.readAt).toBeUndefined();
  });

  it('URL 归一化去重：带尾斜杠与不带视为同一条目', async () => {
    await useReadLaterStore.getState().addItem({ url: 'https://a.com/', title: 'A' });
    await useReadLaterStore.getState().addItem({ url: 'https://a.com', title: 'A' });

    expect(await items()).toHaveLength(1);
  });

  it('非 http(s) URL 一律拒绝（javascript: 不落库）', async () => {
    await useReadLaterStore.getState().addItem({ url: 'javascript:alert(1)', title: 'X' });
    await useReadLaterStore.getState().addItem({ url: 'chrome://extensions/', title: 'X' });

    expect(await items()).toHaveLength(0);
  });

  it('markAllRead 只影响未读条目（已读时间不被覆盖）', async () => {
    await useReadLaterStore.getState().addItem({ url: 'https://a.com/', title: 'A' });
    await useReadLaterStore.getState().addItem({ url: 'https://b.com/', title: 'B' });
    await useReadLaterStore.getState().markRead((await items())[0]!.id);
    const firstReadAt = (await items())[0]!.readAt;

    await useReadLaterStore.getState().markAllRead();

    const list = await items();
    expect(list.every((item) => item.readAt !== undefined)).toBe(true);
    expect(list[0]!.readAt).toBe(firstReadAt);
  });

  it('容量满时淘汰最旧，刚加入的条目必须留在列表里', async () => {
    // 直接铺满上限：验证不是 slice(0, limit) 那种「把新的切掉」
    const full = Array.from({ length: READLATER_LIMIT }, (_, i) => ({
      id: `rl-${i}`,
      url: `https://old.com/${i}`,
      title: `Old ${i}`,
      addedAt: 1000 + i
    }));
    await readLaterRepository.write(full);

    await useReadLaterStore.getState().addItem({ url: 'https://new.com/', title: 'New' });

    const list = await items();
    expect(list).toHaveLength(READLATER_LIMIT);
    expect(list.some((item) => item.url === 'https://new.com/')).toBe(true);
    // 最旧那条已被淘汰
    expect(list.some((item) => item.url === 'https://old.com/0')).toBe(false);
  });

  it('removeItems 批量移除（归档清空路径）', async () => {
    await useReadLaterStore.getState().addItem({ url: 'https://a.com/', title: 'A' });
    await useReadLaterStore.getState().addItem({ url: 'https://b.com/', title: 'B' });
    await useReadLaterStore.getState().addItem({ url: 'https://c.com/', title: 'C' });

    const list = await items();
    await useReadLaterStore.getState().removeItems([list[0]!.id, list[1]!.id]);

    expect((await items()).map((item) => item.url)).toEqual(['https://c.com/']);
  });
});
