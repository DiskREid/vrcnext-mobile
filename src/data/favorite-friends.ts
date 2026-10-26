import { useEffect, useSyncExternalStore } from 'react';
import type { Favorite } from '../api';
import { favoriteApi } from '../api/favorites';
import { demoFriends } from '../demo';

export interface FriendFavoritesSnapshot {
  records: Favorite[];
  loaded: boolean;
  loading: boolean;
  error: string;
  updated: number;
}
type Entry = { snapshot: FriendFavoritesSnapshot; listeners: Set<() => void>; pending?: Promise<void>; generation: number };
const empty = (): FriendFavoritesSnapshot => ({ records: [], loaded: false, loading: false, error: '', updated: 0 });
const cache = new Map<string, Entry>();
const key = (account: string, demo: boolean) => `${demo ? 'demo' : 'account'}:${account}`;
function entry(account: string, demo: boolean): Entry {
  const identity = key(account, demo);
  let result = cache.get(identity);
  if (!result) { result = { snapshot: empty(), listeners: new Set(), generation: 0 }; cache.set(identity, result); }
  return result;
}
function publish(value: Entry, snapshot: FriendFavoritesSnapshot) {
  value.snapshot = snapshot;
  for (const listener of value.listeners) listener();
}
/** All visible consumers share one paginated account-relative list, not one GET per card. */
export function loadFriendFavorites(account: string, demo = false, force = false): Promise<void> {
  const value = entry(account, demo);
  if (value.pending) return value.pending;
  if (!force && value.snapshot.loaded && Date.now() - value.snapshot.updated < 60_000) return Promise.resolve();
  const generation = value.generation;
  publish(value, { ...value.snapshot, loading: true, error: '' });
  value.pending = Promise.resolve().then(() => demo
    ? demoFriends.map((user, index): Favorite => ({ id: `fvrt_demo_${user.id}`, type: 'friend', favoriteId: user.id, tags: [index % 2 ? 'group_1' : 'group_0'] }))
    : favoriteApi.favorites('friend'))
    .then((records) => {
      if (generation !== value.generation) return;
      if (records.some((record) => record.type !== 'friend' || !record.favoriteId?.startsWith('usr_') || !Array.isArray(record.tags))) throw new Error('VRChat вернул некорректное избранное друзей.');
      publish(value, { records, loaded: true, loading: false, error: '', updated: Date.now() });
    }).catch((failure) => {
      if (generation === value.generation) publish(value, { ...value.snapshot, loading: false, error: failure instanceof Error ? failure.message : 'Не удалось проверить избранное друзей.' });
    }).finally(() => { if (generation === value.generation) value.pending = undefined; });
  return value.pending;
}
export function clearFriendFavoritesCache() {
  for (const value of cache.values()) {
    value.generation++;
    value.pending = undefined;
    publish(value, empty());
  }
  // Retained subscribers remain attached, but completed account data is discarded.
  for (const [identity, value] of cache) if (!value.listeners.size) cache.delete(identity);
}
export function invalidateFriendFavoritesCache() {
  for (const value of cache.values()) {
    value.generation++;
    value.pending = undefined;
    publish(value, { ...value.snapshot, loading: false, updated: 0 });
  }
}
/** Mutations invalidate reads begun before the write; their late response cannot restore an old star. */
export function refreshFriendFavorites(account: string, demo = false): Promise<void> {
  const value = entry(account, demo);
  value.generation++;
  value.pending = undefined;
  return loadFriendFavorites(account, demo, true);
}
/** Only a validated server mutation may update the shared star before its list read-back. */
export function commitFriendFavorite(account: string, userId: string, record: Favorite | undefined, demo = false) {
  const value = entry(account, demo);
  value.generation++;
  value.pending = undefined;
  const records = value.snapshot.records.filter((item) => item.favoriteId !== userId);
  if (record) records.push(record);
  publish(value, { records, loaded: true, loading: false, error: '', updated: Date.now() });
}
export function favoriteFriendRecords(records: Favorite[], userId: string) {
  return records.filter((record) => record.type === 'friend' && record.favoriteId === userId);
}
export function getFriendFavoritesSnapshot(account: string, demo = false): FriendFavoritesSnapshot {
  return entry(account, demo).snapshot;
}
export function useFriendFavorites(account: string, demo: boolean, revision: number, enabled = true) {
  const value = entry(account, demo);
  const snapshot = useSyncExternalStore(
    (listener) => { value.listeners.add(listener); return () => { value.listeners.delete(listener); }; },
    () => value.snapshot,
  );
  useEffect(() => { if (enabled) void loadFriendFavorites(account, demo, revision > 0); }, [account, demo, revision, enabled]);
  return { ...snapshot, reload: () => loadFriendFavorites(account, demo, true) };
}
