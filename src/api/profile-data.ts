import { api, unwrapList, ApiError } from './index';
import type { Avatar, Group, User, World } from './types';

export type JsonRecord = Record<string, unknown>;
export const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
export const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

export interface ProfileFavoriteGroup {
  id: string;
  name: string;
  displayName: string;
  visibility: string;
  type: 'world' | 'vrcPlusWorld';
  numFavorites?: number;
}

const query = (parameters: Record<string, string | number>) =>
  '?' + new URLSearchParams(Object.entries(parameters).map(([key, value]) => [key, String(value)]));
const segment = encodeURIComponent;

/** Kept separate from the account's private favorite collections. */
export function createProfileData(request: typeof api.request) {
  return {
    authoredWorlds: (id: string, own: boolean, offset: number) =>
      request<unknown>(
        '/worlds' +
          query({
            userId: id,
            ...(own ? { user: 'me' } : {}),
            releaseStatus: own ? 'all' : 'public',
            n: 50,
            offset,
            sort: 'updated',
            order: 'descending',
          }),
      ).then((value) => unwrapList<World>(value)),
    ownAvatars: (offset: number) =>
      request<unknown>(
        '/avatars' +
          query({
            user: 'me',
            releaseStatus: 'all',
            n: 50,
            offset,
            sort: 'updated',
            order: 'descending',
          }),
      ).then((value) => unwrapList<Avatar>(value)),
    mutualFriends: (id: string, offset: number) =>
      request<unknown>(
        '/users/' + segment(id) + '/mutuals/friends' + query({ n: 100, offset }),
      ).then((value) => unwrapList<User>(value)),
    mutualGroups: (id: string, offset: number) =>
      request<unknown>('/users/' + segment(id) + '/mutuals/groups' + query({ n: 100, offset }))
        .then((value) => unwrapList<Group>(value))
        .then(normalizeProfileGroups),
    async favoriteGroups(id: string, own: boolean): Promise<ProfileFavoriteGroup[]> {
      async function loadType(type: ProfileFavoriteGroup['type']): Promise<ProfileFavoriteGroup[]> {
        const value = await request<unknown>('/favorites/groups/' + type + query({ ownerId: id }));
        const container = asRecord(value);
        const groups = Array.isArray(value) ? value : container.favoriteGroups;
        if (!Array.isArray(groups))
          throw new ApiError('VRChat не передал список категорий избранного.');
        return groups.flatMap((value) => {
          const group = asRecord(value);
          if (
            typeof group.name !== 'string' ||
            !group.name ||
            (!own && group.visibility !== 'public')
          )
            return [];
          return [
            {
              id: asString(group.id) || group.name,
              name: group.name,
              displayName: asString(group.displayName) || group.name,
              visibility: asString(group.visibility),
              type,
              ...(typeof group.numFavorites === 'number'
                ? { numFavorites: group.numFavorites }
                : {}),
            },
          ];
        });
      }
      const standard = await loadType('world');
      // VRC+ adds categories under a distinct API type; never invent their names or counts.
      try {
        return [...standard, ...(await loadType('vrcPlusWorld'))];
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 403))
          return standard;
        throw error;
      }
    },
    async favoriteWorlds(id: string, group: ProfileFavoriteGroup, own: boolean): Promise<World[]> {
      // Never probe another user's private groups or construct category names by index.
      if (!own && group.visibility !== 'public')
        throw new ApiError('Эта категория не опубликована пользователем.', 403);
      const value = asRecord(
        await request<unknown>(
          '/favorites/groups/' + group.type + '/' + segment(group.name) + query({ ownerId: id }),
        ),
      );
      if (!Array.isArray(value.favorites))
        throw new ApiError('VRChat не передал содержимое категории избранного.');
      if (value.favorites.length > 500)
        throw new ApiError('VRChat вернул слишком большую категорию. Повторите загрузку позже.');
      const worlds = new Map<string, World>();
      // VRCPlusWorld entries carry only the favorite record, without an embedded world.
      // Resolve only IDs actually returned by this permitted group, in a bounded serial queue.
      for (const item of value.favorites) {
        const entry = asRecord(item),
          world = asRecord(entry.world);
        if (world.unavailable === true)
          throw new ApiError(
            'Один из миров этой категории удалён или недоступен этому аккаунту.',
            404,
          );
        if (
          typeof world.id === 'string' &&
          world.id.startsWith('wrld_') &&
          typeof world.name === 'string'
        ) {
          worlds.set(world.id, world as unknown as World);
          continue;
        }
        const worldId = asString(entry.favoriteId);
        if (!/^wrld_[a-zA-Z0-9-]+$/.test(worldId))
          throw new ApiError('VRChat вернул запись избранного без доступных данных мира.');
        if (worlds.has(worldId)) continue;
        const resolved = asRecord(await request<unknown>('/worlds/' + segment(worldId)));
        if (
          resolved.id !== worldId ||
          typeof resolved.name !== 'string' ||
          resolved.unavailable === true
        )
          throw new ApiError('VRChat не вернул доступные данные избранного мира.');
        worlds.set(worldId, resolved as unknown as World);
      }
      return [...worlds.values()];
    },
  };
}
export const profileData = createProfileData(api.request);

export function normalizeProfileGroups(groups: Group[]): Group[] {
  return groups.map((group) => ({ ...group, id: group.groupId || group.id }));
}

export function profileDate(value: unknown): string {
  if (typeof value !== 'string' || !value || value === 'none') return 'Не передано';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('ru-RU', {
        dateStyle: 'medium',
        ...(value.length > 10 ? { timeStyle: 'short' } : {}),
      })
    : value;
}

const privateKey =
  /(?:password|passwd|^auth$|auth(?:token|entication|orization)|cookie|token|secret|credential|csrf|bearer|twofactor|recovery|verification(?:code|token)|session|friendkey|api.?key)/i;
/** Recursive defense for the explicit, documented public-data export below. */
export function redactProfileSecrets(value: unknown, depth = 0): unknown {
  if (depth > 30) return '[Глубина данных ограничена]';
  if (Array.isArray(value)) return value.map((item) => redactProfileSecrets(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !privateKey.test(key))
        .map(([key, item]) => [key, redactProfileSecrets(item, depth + 1)]),
    );
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      for (const key of [...url.searchParams.keys()])
        if (privateKey.test(key)) url.searchParams.delete(key);
      url.username = '';
      url.password = '';
      return url.href;
    } catch {
      return value;
    }
  }
  return value;
}

const userFields = [
  'id',
  'displayName',
  'status',
  'statusDescription',
  'pronouns',
  'tags',
  'state',
  'location',
  'worldId',
  'instanceId',
  'date_joined',
  'last_login',
  'last_activity',
  'last_mobile',
  'last_platform',
  'platform',
  'note',
  'isFriend',
  'friendRequestStatus',
  'ageVerified',
  'ageVerificationStatus',
  'allowAvatarCopying',
  'developerType',
  'isEconomyCreator',
  'discordId',
  'bio',
  'bioLinks',
  'languages',
  'currentAvatar',
  'currentAvatarImageUrl',
  'currentAvatarThumbnailImageUrl',
  'profilePicOverride',
  'profileBannerUrl',
  'iconUrl',
  'userIcon',
  'bannerUrl',
  'bannerType',
  'bannerColor',
  'iconFrame',
  'nameplateEffect',
  'profileEffect',
  'travelingToLocation',
  'travelingToWorld',
  'travelingToInstance',
];
const publicFields = [
  'id',
  'displayName',
  'bio',
  'bioLinks',
  'languages',
  'pronouns',
  'status',
  'statusDescription',
  'currentAvatar',
  'currentAvatarAuthorName',
  'currentAvatarImageUrl',
  'currentAvatarName',
  'currentAvatarTags',
  'currentAvatarThumbnailImageUrl',
  'userIcon',
  'iconUrl',
  'iconType',
  'iconFrame',
  'nameplateEffect',
  'profileEffect',
  'ageVerificationStatus',
  'ageVerified',
  'isEconomyCreator',
  'trustTags',
  'badges',
  'hasVrcPlus',
  'bannerUrl',
  'bannerCustomUrl',
  'bannerType',
  'bannerColor',
  'backgroundType',
  'backgroundTemplateId',
  'backgroundTextureId',
  'backgroundGradientTop',
  'backgroundGradientBottom',
  'themeId',
  'themeButtonColor',
  'themeIconColor',
  'themeSubtextColor',
  'themes',
  'groups',
  'representedGroup',
  'publicWorlds',
  'totalPublicWorldsCount',
  'worldFavoriteLists',
];
export function safeProfileJson(user: User, profile?: JsonRecord): JsonRecord {
  const pick = (source: JsonRecord, fields: string[]) =>
    Object.fromEntries(fields.filter((key) => key in source).map((key) => [key, source[key]]));
  return redactProfileSecrets({
    user: pick(user as unknown as JsonRecord, userFields),
    publicProfile: profile ? pick(profile, publicFields) : null,
  }) as JsonRecord;
}
