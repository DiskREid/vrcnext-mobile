import { useEffect, useRef, useState } from 'react';
import { emptyPage, PagedData } from './paged-data';

/** Query changes reset; an explicit refresh keeps cards, ordering and every loaded page. */
export function usePaged<T extends { id: string }>(
  loader: (offset: number) => Promise<T[]>,
  queryDeps: unknown[],
  pageSize = 50,
  refreshToken?: unknown,
) {
  const key = JSON.stringify(queryDeps);
  const [state, setState] = useState(() => emptyPage<T>(key));
  const pager = useRef<PagedData<T> | null>(null);
  if (!pager.current) pager.current = new PagedData(setState);
  const latestLoader = useRef(loader);
  latestLoader.current = loader;
  const previousRefresh = useRef(refreshToken);
  useEffect(() => {
    const controller = pager.current!;
    void controller.reset(key, latestLoader.current, pageSize);
    return () => controller.cancel();
  }, [key, pageSize]);
  useEffect(() => {
    if (Object.is(previousRefresh.current, refreshToken)) return;
    previousRefresh.current = refreshToken;
    void pager.current!.refresh();
  }, [refreshToken]);
  // Effects run after render: never briefly show another search/account's cards.
  const visible = state.key === key ? state : emptyPage<T>(key);
  return {
    ...visible,
    reload: () => void pager.current!.refresh(),
    loadMore: () => void pager.current!.loadMore(),
  };
}
