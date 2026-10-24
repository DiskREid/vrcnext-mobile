import { api, ApiError, unwrapList } from './index';
import type { Avatar, Favorite, FavoriteGroup, FavoriteType, User, World } from './types';

export type FavoriteEntity = User | World | Avatar;
export type FavoriteVisibility = 'private' | 'friends' | 'public';
type Request = typeof api.request;
const enc = encodeURIComponent;
const detail = (e: unknown) => e instanceof Error ? e.message : 'Неизвестная ошибка';
const sameTags = (a: string[], b: string[]) => [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
async function optionalVrcPlus<T>(load: () => Promise<T[]>): Promise<T[]> {
  try { return await load(); }
  catch (error) {
    // The optional subscription-only collection must not hide ordinary favorites.
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return [];
    throw error;
  }
}

export class FavoriteMoveError extends Error {
  constructor(message: string, public readonly original: Favorite, public readonly restored: boolean, public readonly uncertain: boolean) {
    super(message); this.name = 'FavoriteMoveError';
  }
}

/** Favorite IDs identify records. favoriteId identifies the referenced user/world/avatar. */
export function createFavoritesClient(request: Request = api.request) {
  async function pages<T>(path: string, identity: (value: T) => string): Promise<T[]> {
    const result: T[] = [], seen = new Set<string>();
    for (let offset = 0; offset < 10000; offset += 100) {
      const rows = unwrapList<T>(await request<unknown>(`${path}${path.includes('?') ? '&' : '?'}n=100&offset=${offset}`));
      let added = 0;
      for (const row of rows) {
        const id = identity(row);
        if (!id) throw new ApiError('VRChat вернул некорректную запись избранного.');
        if (!seen.has(id)) { seen.add(id); result.push(row); added++; }
      }
      if (rows.length < 100) return result;
      if (!added) throw new ApiError('VRChat повторил страницу избранного. Повторите загрузку.');
    }
    throw new ApiError('Достигнут предел загрузки избранного.');
  }
  const favorites = (type: FavoriteType) => pages<Favorite>(`/favorites?type=${enc(type)}`, (r) => r.id);
  async function familyFavorites(type: FavoriteType) {
    if (type !== 'world' && type !== 'vrcPlusWorld') return favorites(type);
    return (await Promise.all([favorites('world'), optionalVrcPlus(() => favorites('vrcPlusWorld'))])).flat();
  }
  async function groups(ownerId: string, type: FavoriteType): Promise<FavoriteGroup[]> {
    try {
      const value = await request<{ favoriteGroups: FavoriteGroup[] }>(`/favorites/groups/${enc(type)}?ownerId=${enc(ownerId)}`);
      if (!value || !Array.isArray(value.favoriteGroups)) throw new ApiError('VRChat вернул некорректный список коллекций.');
      return value.favoriteGroups.map((group) => {
        if (!group || typeof group.name !== 'string' || !group.name) throw new ApiError('VRChat вернул коллекцию без имени.');
        return { ...group, type };
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      const rows = await pages<FavoriteGroup>(`/favorite/groups?type=${enc(type)}&ownerId=${enc(ownerId)}`, (r) => r.id || `${r.type}:${r.name}`);
      return rows.filter((g) => g.type === type);
    }
  }
  const metadata = (type: 'world' | 'avatar', tag?: string) => pages<World | Avatar>((type === 'world' ? '/worlds/favorites' : '/avatars/favorites') + (tag ? `?tag=${enc(tag)}` : ''), (r) => r.id);
  async function add(favoriteId: string, type: FavoriteType, tags: string[]): Promise<Favorite> {
    if (!tags.length || tags.some((t) => !t)) throw new ApiError('Выберите коллекцию избранного.');
    const result = await request<Favorite>('/favorites', 'POST', { type, favoriteId, tags });
    if (!result || typeof result.id !== 'string' || !result.id || result.favoriteId !== favoriteId || result.type !== type || !Array.isArray(result.tags))
      throw new ApiError('VRChat не вернул подтверждение записи избранного. Обновите список перед повторной попыткой.');
    return result;
  }
  const remove = (recordId: string) => request('/favorites/' + enc(recordId), 'DELETE');
  async function recover(original: Favorite): Promise<Favorite> {
    const current = (await familyFavorites(original.type)).find((f) => f.favoriteId === original.favoriteId);
    if (current) {
      if (current.type === original.type && sameTags(current.tags, original.tags)) return current;
      throw new ApiError('Запись уже находится в другой коллекции. Обновите список и проверьте её перед изменением.');
    }
    return add(original.favoriteId, original.type, [...original.tags]);
  }
  async function move(original: Favorite, destination: string, destinationType: FavoriteType = original.type): Promise<Favorite> {
    if (!destination) throw new ApiError('Выберите коллекцию назначения.');
    if (original.type === destinationType && sameTags(original.tags, [destination])) return original;
    try { await remove(original.id); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 0) throw error;
      let current: Favorite | undefined;
      try { current = (await familyFavorites(original.type)).find((f) => f.favoriteId === original.favoriteId); }
      catch { throw new FavoriteMoveError('Не удалось подтвердить удаление перед переносом. Обновите список; исходные категории сохранены для восстановления.', original, false, true); }
      if (current) throw new FavoriteMoveError(`Удаление не подтверждено: ${detail(error)} Запись всё ещё существует; повторный запрос не отправлен.`, original, sameTags(current.tags, original.tags), false);
      // The read-back proves that the DELETE committed; complete the originally requested move.
    }
    try {
      return await add(original.favoriteId, destinationType, [destination]);
    } catch (error) {
      // A timed-out POST may already have committed. Read the server before compensating.
      let current: Favorite | undefined;
      try { current = (await familyFavorites(original.type)).find((f) => f.favoriteId === original.favoriteId); }
      catch {
        throw new FavoriteMoveError(`Перемещение не подтверждено: ${detail(error)} Не удалось проверить запись. Обновите список; исходные категории сохранены для восстановления.`, original, false, true);
      }
      if (current && current.type === destinationType && sameTags(current.tags, [destination])) return current;
      if (current) {
        throw new FavoriteMoveError(current.type === original.type && sameTags(current.tags, original.tags)
          ? `Мир/пользователь/аватар остался в исходных категориях: ${detail(error)}`
          : 'Запись уже находится в других категориях. Не изменяем её повторно; обновите список.', original, current.type === original.type && sameTags(current.tags, original.tags), false);
      }
      try { await add(original.favoriteId, original.type, [...original.tags]); }
      catch (restoreError) {
        throw new FavoriteMoveError(`Перемещение не выполнено: ${detail(error)} Восстановление исходных категорий тоже не подтверждено: ${detail(restoreError)}. Обновите список или используйте «Восстановить».`, original, false, true);
      }
      throw new FavoriteMoveError(`Перемещение не выполнено: ${detail(error)} Исходные категории восстановлены.`, original, true, false);
    }
  }
  async function updateGroup(ownerId: string, group: FavoriteGroup, displayName: string, visibility: FavoriteVisibility) {
    if (!displayName.trim()) throw new ApiError('Введите название коллекции.');
    return request('/favorite/group/' + [group.type, group.name, ownerId].map(enc).join('/'), 'PUT', { displayName: displayName.trim(), visibility });
  }
  return { groups, favorites, familyFavorites, metadata, add, remove, move, recover, updateGroup };
}

export const favoriteApi = createFavoritesClient();
export async function loadFavoriteGroups(ownerId: string, type: FavoriteType): Promise<FavoriteGroup[]> {
  if (type !== 'world') return favoriteApi.groups(ownerId, type);
  return (await Promise.all([favoriteApi.groups(ownerId, 'world'), optionalVrcPlus(() => favoriteApi.groups(ownerId, 'vrcPlusWorld'))])).flat();
}

export type FavoriteWorldRecord = World & { favoriteGroupNames: string[] };
export type FavoriteAvatarRecord = Avatar & { favoriteGroupNames: string[] };
const snapshots = new Map<string, { time: number; promise: Promise<(FavoriteWorldRecord | FavoriteAvatarRecord)[]> }>();
async function loadMetadata(ownerId: string, type: 'world' | 'avatar', force: boolean, knownGroups?: FavoriteGroup[]) {
  const key = `${ownerId}:${type}`;
  const previous = snapshots.get(key);
  if (!force && previous && Date.now() - previous.time < 120000) return previous.promise;
  const promise = (async () => {
    const groups = knownGroups || await loadFavoriteGroups(ownerId, type);
    // An untagged query can be limited to the first/default collection on API versions.
    const data = await Promise.all(groups.map(async (group) => ({ name: group.name, values: await favoriteApi.metadata(type, group.name) })));
    const merged = new Map<string, FavoriteWorldRecord | FavoriteAvatarRecord>();
    for (const {name, values} of data) for (const value of values) {
      const existing = merged.get(value.id);
      if (existing) { if (!existing.favoriteGroupNames.includes(name)) existing.favoriteGroupNames.push(name); }
      else merged.set(value.id, { ...value, favoriteGroupNames: [name] });
    }
    return [...merged.values()];
  })();
  const entry = {time:Date.now(),promise}; snapshots.set(key, entry);
  if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value!);
  promise.catch(() => { if (snapshots.get(key) === entry) snapshots.delete(key); });
  return promise;
}
export const loadFavoriteWorlds = (ownerId: string, force = false, knownGroups?: FavoriteGroup[]) => loadMetadata(ownerId, 'world', force, knownGroups) as Promise<FavoriteWorldRecord[]>;
export const loadFavoriteAvatars = (ownerId: string, force = false, knownGroups?: FavoriteGroup[]) => loadMetadata(ownerId, 'avatar', force, knownGroups) as Promise<FavoriteAvatarRecord[]>;

// Metadata is resolved only for visible cards; errors are never cached as empty data.
const entities = new Map<string, { time: number; promise: Promise<FavoriteEntity> }>();
export function cacheFavoriteEntities(ownerId: string, type: FavoriteType, values: FavoriteEntity[]) {
  for (const value of values) entities.set(`${ownerId}:${type}:${value.id}`, { time: Date.now(), promise: Promise.resolve(value) });
  while (entities.size > 600) entities.delete(entities.keys().next().value!);
}
export function loadFavoriteEntity(record: Favorite, ownerId: string): Promise<FavoriteEntity> {
  const key = `${ownerId}:${record.type}:${record.favoriteId}`;
  const hit = entities.get(key);
  if (hit && Date.now() - hit.time < 120000) return hit.promise;
  const promise: Promise<FavoriteEntity> = record.type === 'friend' ? api.user(record.favoriteId) : record.type === 'world' || record.type === 'vrcPlusWorld' ? api.world(record.favoriteId) : api.avatar(record.favoriteId);
  const entry = { time: Date.now(), promise };
  entities.set(key, entry);
  if (entities.size > 300) entities.delete(entities.keys().next().value!);
  promise.catch(() => { if (entities.get(key) === entry) entities.delete(key); });
  return promise;
}
export function clearFavoriteEntityCache() { entities.clear(); snapshots.clear(); }
