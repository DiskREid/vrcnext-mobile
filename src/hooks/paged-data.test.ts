import { describe, expect, it, vi } from 'vitest';
import { PagedData } from './paged-data';

type Item = { id: string; value: number };
const item = (id: string, value = 1): Item => ({ id, value });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('paged query refresh', () => {
  it('retains rows after leaving a screen during refresh and ignores the late response', async () => {
    const late = deferred<Item[]>();
    const page = new PagedData<Item>(() => {});
    await page.reset('all', async () => [item('a'), item('b')], 2);
    let pending = false;
    await page.reset('all', () => pending ? late.promise : Promise.resolve([item('a'), item('b')]), 2);
    pending = true;
    const request = page.refresh();
    page.cancel();
    expect(page.state.refreshing).toBe(false);
    expect(page.state.items.map((row) => row.id)).toEqual(['a', 'b']);
    late.resolve([item('c')]);
    await request;
    expect(page.state.items.map((row) => row.id)).toEqual(['a', 'b']);
    await page.refresh();
    expect(page.state.items.map((row) => row.id)).toEqual(['c']);
  });
  it('keeps loaded pages and row order while updating changed objects and pagination', async () => {
    let refreshing = false;
    const loader = vi.fn(async (offset: number) => {
      if (offset === 0) return refreshing ? [item('b', 2), item('a')] : [item('a'), item('b')];
      if (offset === 2) return refreshing ? [item('d'), item('c')] : [item('c'), item('d')];
      return [item('e')];
    });
    const changed = vi.fn();
    const page = new PagedData<Item>(changed);
    await page.reset('worlds', loader, 2);
    await page.loadMore();
    const original = page.state.items;
    refreshing = true;
    const pending = page.refresh();
    expect(page.state.items).toBe(original);
    expect(page.state.loading).toBe(false);
    expect(page.state.refreshing).toBe(true);
    await pending;
    expect(page.state.items.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(page.state.items[0]).toBe(original[0]);
    expect(page.state.items[1]).toEqual(item('b', 2));
    expect(page.state.items[1]).not.toBe(original[1]);
    expect(loader.mock.calls.map(([offset]) => offset)).toEqual([0, 2, 0, 2]);
    await page.loadMore();
    expect(loader.mock.calls.at(-1)).toEqual([4]);
    expect(page.state.items.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(page.state.hasMore).toBe(false);
  });

  it('resets search immediately and ignores its previous late response', async () => {
    const old = deferred<Item[]>();
    const page = new PagedData<Item>(() => {});
    const oldRequest = page.reset('old search', () => old.promise, 2);
    const newRequest = page.reset('new search', async () => [item('new')], 2);
    expect(page.state.items).toEqual([]);
    expect(page.state.key).toBe('new search');
    expect(page.state.loading).toBe(true);
    await newRequest;
    old.resolve([item('old')]);
    await oldRequest;
    expect(page.state.items).toEqual([item('new')]);
  });

  it('retains every visible page and offset when a later refresh page fails', async () => {
    let fail = false;
    const loader = vi.fn(async (offset: number) => {
      if (offset === 2 && fail) throw new Error('Connection interrupted');
      return offset === 0 ? [item('a'), item('b')] : offset === 2 ? [item('c'), item('d')] : [];
    });
    const page = new PagedData<Item>(() => {});
    await page.reset('all', loader, 2);
    await page.loadMore();
    const original = page.state.items;
    fail = true;
    await page.refresh();
    expect(page.state.items).toBe(original);
    expect(page.state.error).toBe('Connection interrupted');
    expect(page.state.refreshing).toBe(false);
    expect(page.state.loading).toBe(false);
    fail = false;
    await page.loadMore();
    expect(loader.mock.calls.at(-1)).toEqual([4]);
  });

  it('blocks duplicate refresh and next-page requests during refresh', async () => {
    const request = deferred<Item[]>();
    let pending = false;
    const loader = vi.fn(() =>
      pending ? request.promise : Promise.resolve([item('a'), item('b')]),
    );
    const page = new PagedData<Item>(() => {});
    await page.reset('all', loader, 2);
    pending = true;
    const refresh = page.refresh();
    await page.refresh();
    await page.loadMore();
    expect(loader).toHaveBeenCalledTimes(2);
    request.resolve([item('b'), item('a')]);
    await refresh;
    expect(page.state.items.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('does not commit a next-page response after switching queries', async () => {
    const late = deferred<Item[]>();
    const page = new PagedData<Item>(() => {});
    await page.reset('old', (offset) => (offset ? late.promise : Promise.resolve([item('a')])), 1);
    const more = page.loadMore();
    await page.reset('new', async () => [item('new')], 2);
    late.resolve([item('stale')]);
    await more;
    expect(page.state.items).toEqual([item('new')]);
    expect(page.state.moreLoading).toBe(false);
  });

  it('uses raw consumed offsets when deduplicating and stops refetching a shortened window', async () => {
    let shortened = false;
    const loader = vi.fn(async (offset: number) =>
      shortened ? [item('a', 3)] : offset === 0 ? [item('a'), item('a', 2)] : [item('b')],
    );
    const page = new PagedData<Item>(() => {});
    await page.reset('all', loader, 2);
    expect(page.state.items).toEqual([item('a', 2)]);
    await page.loadMore();
    expect(loader.mock.calls.at(-1)).toEqual([2]);
    shortened = true;
    await page.refresh();
    expect(loader.mock.calls.map(([offset]) => offset)).toEqual([0, 2, 0]);
    expect(page.state.items).toEqual([item('a', 3)]);
    expect(page.state.hasMore).toBe(false);
  });

  it('shows a loading state on retry after the first request failed', async () => {
    let fail = true;
    const page = new PagedData<Item>(() => {});
    await page.reset(
      'all',
      async () => {
        if (fail) throw new Error('Network unavailable');
        return [item('a')];
      },
      2,
    );
    fail = false;
    const retry = page.refresh();
    expect(page.state.loading).toBe(true);
    await retry;
    expect(page.state.items).toEqual([item('a')]);
    expect(page.state.error).toBe('');
  });
});
