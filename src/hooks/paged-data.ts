export interface PageState<T> {
  key: string;
  items: T[];
  loading: boolean;
  refreshing: boolean;
  moreLoading: boolean;
  hasMore: boolean;
  error: string;
}

export function emptyPage<T>(key: string): PageState<T> {
  return {
    key,
    items: [],
    loading: true,
    refreshing: false,
    moreLoading: false,
    hasMore: false,
    error: '',
  };
}

/** Keep visible rows in place, retain unchanged objects, and append newly discovered IDs. */
export function reconcilePage<T extends { id: string }>(previous: T[], incoming: T[]): T[] {
  const remaining = new Map(incoming.map((item) => [item.id, item]));
  const result: T[] = [];
  for (const old of previous) {
    const item = remaining.get(old.id);
    if (!item) continue;
    result.push(JSON.stringify(old) === JSON.stringify(item) ? old : item);
    remaining.delete(old.id);
  }
  return [...result, ...remaining.values()];
}

/** Owns request generations so a late search, next-page, or refresh response cannot replace a new query. */
export class PagedData<T extends { id: string }> {
  state = emptyPage<T>('');
  private generation = 0;
  private offset = 0;
  private loadedPages = 0;
  private busy = false;
  private pageSize = 50;
  private loader: (offset: number) => Promise<T[]> = async () => [];

  constructor(private readonly changed: (state: PageState<T>) => void) {}

  private publish(change: Partial<PageState<T>>) {
    this.state = { ...this.state, ...change };
    this.changed(this.state);
  }

  cancel() {
    this.generation++;
    this.busy = false;
    if (this.state.refreshing || this.state.moreLoading)
      this.publish({ refreshing: false, moreLoading: false });
  }

  async reset(key: string, loader: (offset: number) => Promise<T[]>, pageSize: number) {
    const current = ++this.generation;
    this.loader = loader;
    this.pageSize = pageSize;
    this.offset = 0;
    this.loadedPages = 0;
    this.busy = true;
    this.state = emptyPage<T>(key);
    this.changed(this.state);
    try {
      const result = await loader(0);
      if (current !== this.generation) return;
      this.offset = result.length;
      this.loadedPages = 1;
      this.publish({ items: reconcilePage([], result), hasMore: result.length >= pageSize });
    } catch (error) {
      if (current === this.generation)
        this.publish({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (current === this.generation) {
        this.busy = false;
        this.publish({ loading: false });
      }
    }
  }

  async refresh() {
    if (this.busy) return;
    const current = ++this.generation;
    const loader = this.loader;
    const pageSize = this.pageSize;
    const pages = Math.max(1, this.loadedPages);
    this.busy = true;
    this.publish({ loading: this.loadedPages === 0, refreshing: this.loadedPages > 0, error: '' });
    try {
      const incoming: T[] = [];
      let nextOffset = 0;
      let hasMore = false;
      let completedPages = 0;
      // Re-read the visible window, not only page zero. Commit atomically on success.
      for (let page = 0; page < pages; page++) {
        const result = await loader(nextOffset);
        if (current !== this.generation) return;
        incoming.push(...result);
        nextOffset += result.length;
        completedPages++;
        hasMore = result.length >= pageSize;
        if (!hasMore) break;
      }
      this.offset = nextOffset;
      this.loadedPages = completedPages;
      this.publish({ items: reconcilePage(this.state.items, incoming), hasMore });
    } catch (error) {
      if (current === this.generation)
        this.publish({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (current === this.generation) {
        this.busy = false;
        this.publish({ loading: false, refreshing: false });
      }
    }
  }

  async loadMore() {
    if (this.busy || !this.state.hasMore) return;
    const current = this.generation;
    const loader = this.loader;
    this.busy = true;
    this.publish({ moreLoading: true, error: '' });
    try {
      const result = await loader(this.offset);
      if (current !== this.generation) return;
      this.offset += result.length;
      this.loadedPages++;
      // Duplicate IDs can straddle API pages; update them without moving existing rows.
      const merged = new Map(this.state.items.map((item) => [item.id, item]));
      for (const item of result) merged.set(item.id, item);
      this.publish({
        items: reconcilePage(this.state.items, [...merged.values()]),
        hasMore: result.length >= this.pageSize,
      });
    } catch (error) {
      if (current === this.generation)
        this.publish({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (current === this.generation) {
        this.busy = false;
        this.publish({ moreLoading: false });
      }
    }
  }
}
