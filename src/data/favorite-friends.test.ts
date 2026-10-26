import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { favoriteApi } from '../api/favorites';
import type { Favorite } from '../api';
import { clearFriendFavoritesCache, getFriendFavoritesSnapshot, loadFriendFavorites, refreshFriendFavorites } from './favorite-friends';

const record: Favorite = { id: 'fvrt_actual', favoriteId: 'usr_friend', type: 'friend', tags: ['group_0', 'group_2'] };
beforeEach(() => clearFriendFavoritesCache());
afterEach(() => { vi.restoreAllMocks(); clearFriendFavoritesCache(); });
describe('shared friend favorites', () => {
  it('coalesces profile and list reads and retains every category from the server', async () => {
    const read = vi.spyOn(favoriteApi, 'favorites').mockResolvedValue([record]);
    const first = loadFriendFavorites('usr_owner');
    expect(loadFriendFavorites('usr_owner')).toBe(first);
    await first;
    expect(read).toHaveBeenCalledTimes(1);
    expect(getFriendFavoritesSnapshot('usr_owner')).toMatchObject({ loaded: true, records: [record], error: '' });
    await loadFriendFavorites('usr_owner');
    expect(read).toHaveBeenCalledTimes(1);
    expect(getFriendFavoritesSnapshot('usr_other').records).toEqual([]);
  });
  it('a read started before mutation cannot restore an obsolete favorite after refresh', async () => {
    let finish!: (records: Favorite[]) => void;
    const read = vi.spyOn(favoriteApi, 'favorites').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue([]);
    const old = loadFriendFavorites('usr_owner');
    await Promise.resolve();
    await refreshFriendFavorites('usr_owner');
    finish([record]); await old;
    expect(read).toHaveBeenCalledTimes(2);
    expect(getFriendFavoritesSnapshot('usr_owner')).toMatchObject({ loaded: true, records: [] });
  });
  it('logout clears records and ignores late reads from the old session', async () => {
    let finish!: (records: Favorite[]) => void;
    vi.spyOn(favoriteApi, 'favorites').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = loadFriendFavorites('usr_owner'); await Promise.resolve();
    clearFriendFavoritesCache(); finish([record]); await old;
    expect(getFriendFavoritesSnapshot('usr_owner')).toMatchObject({ loaded: false, records: [] });
  });
  it('failed checks remain unknown instead of falsely showing an empty confirmed favorite list', async () => {
    vi.spyOn(favoriteApi, 'favorites').mockRejectedValue(new Error('Unavailable'));
    await loadFriendFavorites('usr_owner');
    expect(getFriendFavoritesSnapshot('usr_owner')).toMatchObject({ loaded: false, error: 'Unavailable' });
  });
});
