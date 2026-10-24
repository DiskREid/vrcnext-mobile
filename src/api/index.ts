import { native, isNative } from './native';
import type { NativeBridge, NativeResponse } from './native';
import type {
  Avatar,
  CalendarEvent,
  CreateInstanceOptions,
  Favorite,
  FavoriteGroup,
  FavoriteType,
  Group,
  GroupPost,
  Instance,
  InventoryItem,
  MessageTemplate,
  MessageType,
  Moderation,
  Notification,
  ProfileUpdate,
  TwoFactorChallenge,
  TwoFactorType,
  UploadTag,
  User,
  VrcFile,
  World,
} from './types';
export * from './types';
export { native, isNative } from './native';
export type { PipelineEvent, NativeBridge } from './native';

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
const segment = (s: string) => encodeURIComponent(s);
const escapeCredential = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
export const basicAuthorization = (username: string, password: string) =>
  'Basic ' + btoa(escapeCredential(username) + ':' + escapeCredential(password));
const query = (values: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined) q.set(key, String(value));
  });
  return '?' + q.toString();
};
const record = (data: unknown): Record<string, unknown> | undefined =>
  typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : undefined;
export function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const object = record(data);
  for (const key of [
    'results',
    'events',
    'data',
    'items',
    'posts',
    'instances',
    'prints',
    'avatars',
  ]) {
    if (Array.isArray(object?.[key])) return object[key] as T[];
  }
  throw new ApiError('VRChat вернул неожиданный формат списка. Обновите приложение.');
}
export function checked<T>(response: NativeResponse): T {
  if (response.status >= 200 && response.status < 300) return response.data as T;
  const object = record(response.data),
    error = record(object?.error);
  const detail =
    typeof error?.message === 'string'
      ? error.message
      : typeof object?.message === 'string'
        ? object.message
        : '';
  if (response.status === 401)
    throw new ApiError('Сессия истекла или данные входа неверны. Войдите снова.', 401);
  if (response.status === 403)
    throw new ApiError(detail || 'VRChat запретил это действие. Проверьте права аккаунта.', 403);
  if (response.status === 429)
    throw new ApiError(
      `Лимит VRChat. Повторите через ${response.retryAfter || 60} сек.`,
      429,
      response.retryAfter || 60,
    );
  throw new ApiError(
    detail || `Ошибка VRChat (${response.status}). Попробуйте позже.`,
    response.status,
  );
}
const jsonRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value === 'string') {
    try {
      return record(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return record(value);
};
/** The desktop client merges both notification protocols and parses embedded JSON. */
export function normalizeNotification(value: unknown, v2 = false): Notification {
  const raw = record(value);
  if (!raw || typeof raw.id !== 'string' || typeof raw.type !== 'string')
    throw new ApiError('VRChat вернул некорректное уведомление.');
  const details = { ...jsonRecord(raw.details), ...jsonRecord(raw.data), ...jsonRecord(raw._data) };
  const string = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return {
    id: raw.id,
    type: raw.type,
    senderUserId: string(raw.senderUserId) || string(raw.senderId),
    senderUsername: string(raw.senderDisplayName) || string(raw.senderUsername),
    message:
      string(raw.message) ||
      string(details.responseMessage) ||
      string(details.inviteMessage) ||
      string(details.requestMessage),
    created_at: string(raw.created_at) || string(raw.createdAt),
    seen: raw.seen === true,
    details,
    _v2: v2 || raw._v2 === true,
    _data: jsonRecord(raw.data) || jsonRecord(raw._data),
    _link: string(raw.link) || string(raw._link),
    title: string(raw.title),
    imageUrl: string(raw.imageUrl),
  };
}
export function normalizePublicAvatar(value: unknown): Avatar | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const string = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const id = string(raw.vrc_id) || string(raw.id);
  if (!id?.startsWith('avtr_')) return undefined;
  const author = record(raw.author);
  const compatibility = Array.isArray(raw.compatibility)
    ? raw.compatibility.filter((v): v is string => typeof v === 'string')
    : [];
  const packages = Array.isArray(raw.unityPackages)
    ? (raw.unityPackages as Avatar['unityPackages'])
    : compatibility.map((platform) => ({
        platform:
          platform.toLowerCase() === 'quest'
            ? 'android'
            : platform.toLowerCase() === 'pc'
              ? 'standalonewindows'
              : platform.toLowerCase(),
      }));
  const authorTags = record(raw.tags)?.author_tags;
  return {
    id,
    name: string(raw.name) || 'Без названия',
    description: string(raw.description),
    imageUrl: string(raw.image_url) || string(raw.imageUrl),
    thumbnailImageUrl:
      string(raw.image_url) || string(raw.thumbnailImageUrl) || string(raw.imageUrl),
    authorId: string(author?.vrc_id) || string(raw.authorId),
    authorName: string(author?.name) || string(raw.authorName),
    releaseStatus: 'public',
    unityPackages: packages,
    compatibility,
    source: 'avtrdb',
    tags: Array.isArray(authorTags)
      ? authorTags.filter((v): v is string => typeof v === 'string').map((t) => 'author_tag_' + t)
      : Array.isArray(raw.tags)
        ? raw.tags.filter((v): v is string => typeof v === 'string')
        : [],
  };
}
export function isTwoFactorChallenge(data: User | TwoFactorChallenge): data is TwoFactorChallenge {
  return 'requiresTwoFactorAuth' in data && Array.isArray(data.requiresTwoFactorAuth);
}
function requireLocation(location: string) {
  if (!/^wrld_[a-zA-Z0-9-]+:[a-zA-Z0-9~_().+\-]+$/.test(location))
    throw new ApiError('Нет доступного инстанса. Откройте мир и выберите инстанс.');
  return location;
}

/** All network I/O uses the native transport; browser preview never accepts account credentials. */
export function createApi(transport: NativeBridge, available: () => boolean = () => true) {
  let v2Supported = true;
  let authenticatedUserId: string | undefined;
  function ensureNative() {
    if (!available())
      throw new ApiError(
        'Вход и функции VRChat доступны в Android APK. В браузере используйте деморежим.',
      );
  }
  async function request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    authorization?: string,
  ): Promise<T> {
    ensureNative();
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('://'))
      throw new ApiError('Недопустимый путь API.');
    try {
      return checked<T>(
        await transport.request({
          path,
          method,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          ...(authorization ? { authorization } : {}),
        }),
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Native errors deliberately omit response bodies and credential-bearing URLs.
      throw new ApiError('Не удалось подключиться к VRChat. Проверьте подключение к интернету.');
    }
  }
  async function list<T>(path: string): Promise<T[]> {
    return unwrapList<T>(await request<unknown>(path));
  }
  async function allPages<T extends { id?: string }>(
    fetchPage: (offset: number) => Promise<T[]>,
    pageSize = 100,
  ): Promise<T[]> {
    const output: T[] = [],
      seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const data = await fetchPage(page * pageSize);
      let additions = 0;
      for (const item of data) {
        if (item.id && seen.has(item.id)) continue;
        if (item.id) seen.add(item.id);
        output.push(item);
        additions++;
      }
      if (data.length < pageSize) return output;
      if (additions === 0)
        throw new ApiError('VRChat повторил страницу списка. Список загружен не полностью.');
    }
    throw new ApiError('Достигнут предел загрузки списка. Используйте поиск.');
  }
  async function resolveNotificationGroup(n: Notification): Promise<string | undefined> {
    const details = n.details || {};
    if (typeof details.groupId === 'string') return details.groupId;
    if (typeof details.ownerId === 'string' && details.ownerId.startsWith('grp_'))
      return details.ownerId;
    const fromLink = n._link?.match(/grp_[a-zA-Z0-9-]+/)?.[0];
    if (fromLink) return fromLink;
    if (typeof details.groupName === 'string') {
      const userId = authenticatedUserId || (await client.resume()).id;
      const groups = await client.groups(userId);
      return groups.find(
        (g) => g.shortCode?.toLowerCase() === String(details.groupName).toLowerCase(),
      )?.id;
    }
    return undefined;
  }
  const client = {
    request,
    async resume(): Promise<User> {
      const result = await request<User | TwoFactorChallenge>('/auth/user');
      if (isTwoFactorChallenge(result))
        throw new ApiError(
          'Для продолжения войдите и подтвердите двухфакторную аутентификацию.',
          401,
        );
      if (!result.id) throw new ApiError('VRChat не вернул профиль пользователя.');
      authenticatedUserId = result.id;
      return result;
    },
    async login(username: string, password: string): Promise<User | TwoFactorChallenge> {
      ensureNative();
      if (!username.trim() || !password) throw new ApiError('Введите имя пользователя и пароль.');
      // Isolate new-account login from any expired or partial previous session.
      await transport.clearSession();
      v2Supported = true;
      authenticatedUserId = undefined;
      // Do not retain either credential beyond this request.
      const result = await request<User | TwoFactorChallenge>(
        '/auth/user',
        'GET',
        undefined,
        basicAuthorization(username.trim(), password),
      );
      if (!isTwoFactorChallenge(result)) authenticatedUserId = result.id;
      return result;
    },
    async verify2fa(code: string, type: TwoFactorType | string): Promise<User> {
      const method = type.toLowerCase();
      if (!['totp', 'emailotp', 'otp'].includes(method))
        throw new ApiError('Этот способ подтверждения не поддерживается.');
      if (!code.trim()) throw new ApiError('Введите код подтверждения.');
      const result = await request<{ verified: boolean }>(
        `/auth/twofactorauth/${method}/verify`,
        'POST',
        { code: code.trim() },
      );
      if (!result.verified) throw new ApiError('Неверный или просроченный код.');
      return client.resume();
    },
    async logout(): Promise<{ serverLoggedOut: boolean }> {
      let serverLoggedOut = false;
      try {
        if (available()) {
          await request('/logout', 'PUT', {});
          serverLoggedOut = true;
        }
      } catch {
        /* Local logout remains available when the server cannot be reached. */
      }
      try {
        await transport.disconnectPipeline();
      } catch {
        /* clearSession also closes the native socket. */
      }
      await transport.clearSession(); // Propagate storage failures; never claim cleanup succeeded.
      authenticatedUserId = undefined;
      return { serverLoggedOut };
    },
    friends: (offline = false, offset = 0) =>
      list<User>('/auth/user/friends' + query({ offline, n: 100, offset })),
    allOnlineFriends: () => allPages<User>((offset) => client.friends(false, offset)),
    async allFriends(): Promise<User[]> {
      const online = await allPages<User>((offset) => client.friends(false, offset));
      const offline = await allPages<User>((offset) => client.friends(true, offset));
      return Array.from(new Map([...online, ...offline].map((user) => [user.id, user])).values());
    },
    user: (id: string) => request<User>('/users/' + segment(id)),
    searchUsers: (search: string, offset = 0) =>
      list<User>('/users' + query({ search, n: 50, offset })),
    friendRequest: (id: string) => request('/user/' + segment(id) + '/friendRequest', 'POST', {}),
    unfriend: (id: string) => request('/auth/user/friends/' + segment(id), 'DELETE'),
    note: (id: string, note: string) => request('/userNotes', 'POST', { targetUserId: id, note }),
    userGroups: (id: string) => list<Group>('/users/' + segment(id) + '/groups'),
    mutualFriends: (id: string, offset = 0) =>
      list<User>('/users/' + segment(id) + '/mutuals/friends' + query({ n: 100, offset })),
    moderations: (type: 'block' | 'mute') =>
      list<Moderation>('/auth/user/playermoderations' + query({ type })),
    moderate: (id: string, type: 'block' | 'mute') =>
      request('/auth/user/playermoderations', 'POST', { moderated: id, type }),
    unmoderate: (id: string, type: 'block' | 'mute') =>
      request('/auth/user/unplayermoderate', 'PUT', { moderated: id, type }),
    async updateProfile(id: string, update: ProfileUpdate): Promise<User> {
      const { bio, bioLinks, languages, userIcon, ...userFields } = update;
      if (Object.keys(userFields).length) await request('/users/' + segment(id), 'PUT', userFields);
      const profileFields = {
        ...(bio !== undefined ? { bio } : {}),
        ...(bioLinks !== undefined ? { bioLinks } : {}),
        ...(languages !== undefined ? { languages } : {}),
        ...(userIcon !== undefined ? { userIcon } : {}),
      };
      if (Object.keys(profileFields).length)
        await request('/profile/' + segment(id), 'PUT', profileFields);
      return client.resume();
    },
    profileAppearance: (id: string) => request<Record<string, unknown>>('/profile/' + segment(id)),
    updateAppearance: (id: string, fields: Record<string, unknown>) =>
      request('/profile/' + segment(id), 'PUT', fields),
    worlds: (
      search = '',
      offset = 0,
      mode: 'popular' | 'active' | 'mine' | 'favorites' = 'popular',
      tag?: string,
    ) =>
      list<World>(
        (mode === 'favorites' ? '/worlds/favorites' : '/worlds') +
          query({
            ...(search ? { search } : {}),
            n: 50,
            offset,
            sort: search
              ? 'relevance'
              : mode === 'active'
                ? 'heat'
                : mode === 'mine'
                  ? 'updated'
                  : 'popularity',
            order: 'descending',
            ...(mode === 'mine'
              ? { user: 'me', releaseStatus: 'all' }
              : mode === 'favorites'
                ? { tag }
                : { releaseStatus: 'public' }),
          }),
      ),
    world: (id: string) => request<World>('/worlds/' + segment(id)),
    recentWorlds: () => list<World>('/instances/recent'),
    instance: (location: string) =>
      request<Instance>('/instances/' + segment(requireLocation(location))),
    createInstance: (options: CreateInstanceOptions) =>
      request<Instance>('/instances', 'POST', options),
    inviteSelf: (location: string) =>
      request('/instances/' + segment(requireLocation(location)) + '/invite', 'POST', {}),
    invite: (id: string, location: string, messageSlot?: number) =>
      request('/invite/' + segment(id), 'POST', {
        instanceId: requireLocation(location),
        worldId: location.split(':')[0],
        ...(messageSlot === undefined ? {} : { messageSlot }),
      }),
    requestInvite: (id: string, messageSlot?: number) =>
      request('/requestInvite/' + segment(id), 'POST', {
        ...(messageSlot === undefined ? { instanceId: '' } : { messageSlot }),
      }),
    async groups(userId: string): Promise<Group[]> {
      return (await list<Group>('/users/' + segment(userId) + '/groups')).map((group) => ({
        ...group,
        id: group.groupId || group.id,
        membershipStatus: group.membershipStatus || 'member',
      }));
    },
    searchGroups: (search: string, offset = 0) =>
      list<Group>('/groups' + query({ query: search, n: 50, offset })),
    group: (id: string) => request<Group>('/groups/' + segment(id) + '?includeRoles=true'),
    joinGroup: (id: string) => request('/groups/' + segment(id) + '/join', 'POST', {}),
    leaveGroup: (id: string) => request('/groups/' + segment(id) + '/leave', 'POST', {}),
    declineGroupInvite: (id: string) => request('/groups/' + segment(id) + '/invites', 'PUT', {}),
    respondGroupJoinRequest: (groupId: string, userId: string, action: 'accept' | 'reject') =>
      request('/groups/' + segment(groupId) + '/requests/' + segment(userId), 'PUT', { action }),
    groupPosts: (id: string, offset = 0) =>
      list<GroupPost>('/groups/' + segment(id) + '/posts' + query({ n: 50, offset })),
    createGroupPost: (
      id: string,
      post: {
        title: string;
        text: string;
        visibility?: string;
        sendNotification?: boolean;
        imageId?: string;
      },
    ) =>
      request<GroupPost>('/groups/' + segment(id) + '/posts', 'POST', {
        visibility: 'public',
        sendNotification: false,
        ...post,
      }),
    deleteGroupPost: (groupId: string, postId: string) =>
      request('/groups/' + segment(groupId) + '/posts/' + segment(postId), 'DELETE'),
    groupInstances: (id: string, userId: string) =>
      list<Instance>('/users/' + segment(userId) + '/instances/groups/' + segment(id)),
    groupGallery: (id: string, galleryId: string, offset = 0) =>
      list<VrcFile>(
        '/groups/' + segment(id) + '/galleries/' + segment(galleryId) + query({ n: 50, offset }),
      ),
    avatars: (mode: 'mine' | 'favorites' = 'mine', offset = 0, tag?: string) =>
      list<Avatar>(
        (mode === 'favorites' ? '/avatars/favorites' : '/avatars') +
          query({
            n: 50,
            offset,
            ...(mode === 'mine'
              ? { user: 'me', releaseStatus: 'all', sort: 'updated', order: 'descending' }
              : { tag }),
          }),
      ),
    async searchPublicAvatars(search: string, page = 0): Promise<Avatar[]> {
      ensureNative();
      const query = search.trim();
      if (!query || query.length > 100) throw new ApiError('Введите запрос от 1 до 100 символов.');
      if (!Number.isInteger(page) || page < 0 || page > 10000)
        throw new ApiError('Некорректная страница поиска.');
      let response: NativeResponse;
      try {
        response = await transport.searchPublicAvatars({ query, page });
      } catch {
        throw new ApiError('Не удалось подключиться к базе avtrdb.com. Попробуйте позже.');
      }
      if (response.status < 200 || response.status >= 300)
        throw new ApiError(
          response.status === 429
            ? 'Лимит поиска avtrdb.com. Повторите позже.'
            : 'База avtrdb.com временно недоступна.',
          response.status,
          response.retryAfter,
        );
      return unwrapList<unknown>(response.data)
        .map(normalizePublicAvatar)
        .filter((a): a is Avatar => a !== undefined);
    },
    avatar: (id: string) => request<Avatar>('/avatars/' + segment(id)),
    selectAvatar: (id: string) => request('/avatars/' + segment(id) + '/select', 'PUT', {}),
    favoriteGroups: () => list<FavoriteGroup>('/favorite/groups?n=100'),
    favorites: (type: FavoriteType, offset = 0) =>
      list<Favorite>('/favorites' + query({ type, n: 100, offset })),
    addFavorite: (id: string, type: FavoriteType, tag: string) =>
      request<Favorite>('/favorites', 'POST', { type, favoriteId: id, tags: [tag] }),
    removeFavorite: (id: string) => request('/favorites/' + segment(id), 'DELETE'),
    renameFavoriteGroup: (type: FavoriteType, name: string, userId: string, displayName: string) =>
      request('/favorite/group/' + [type, name, userId].map(segment).join('/'), 'PUT', {
        displayName,
      }),
    async notifications(offset = 0): Promise<Notification[]> {
      const v1 = (
        await list<unknown>('/auth/user/notifications' + query({ n: 100, offset, hidden: false }))
      ).map((n) => normalizeNotification(n));
      const v2 = await client.notificationsV2(offset);
      // The same event can be returned by both endpoints; retain the v1 action identity.
      const merged = new Map(v1.map((n) => [n.id, n]));
      for (const n of v2) if (!merged.has(n.id)) merged.set(n.id, n);
      return [...merged.values()].sort((a, b) =>
        (b.created_at || '').localeCompare(a.created_at || ''),
      );
    },
    async notificationsV2(offset = 0): Promise<Notification[]> {
      if (!v2Supported) return [];
      try {
        return (await list<unknown>('/auth/user/notificationsV2' + query({ n: 100, offset }))).map(
          (n) => normalizeNotification(n, true),
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          v2Supported = false;
          return [];
        }
        throw error;
      }
    },
    async acceptNotification(
      notification: string | Notification,
      currentLocation?: string,
    ): Promise<unknown> {
      if (typeof notification === 'string')
        return request('/auth/user/notifications/' + segment(notification) + '/accept', 'PUT', {});
      const n = notification,
        details = n.details || {};
      const groupId =
        n.type === 'group.invite' || n.type === 'group.joinRequest'
          ? await resolveNotificationGroup(n)
          : undefined;
      if (n.type === 'group.invite') {
        if (!groupId)
          throw new ApiError(
            'Уведомление не содержит идентификатор группы. Откройте группу вручную.',
          );
        await client.joinGroup(groupId);
        return client.hideNotification(n.id);
      }
      if (n.type === 'group.joinRequest') {
        const userId =
          typeof details.requestUserId === 'string'
            ? details.requestUserId
            : typeof details.userId === 'string'
              ? details.userId
              : n.senderUserId;
        if (!groupId || !userId)
          throw new ApiError(
            'Уведомление не содержит группу или пользователя. Откройте запрос в VRChat.',
          );
        await client.respondGroupJoinRequest(groupId, userId, 'accept');
        return client.hideNotification(n.id);
      }
      if (n.type === 'invite') {
        const location =
          typeof details.worldId === 'string'
            ? details.worldId
            : typeof details.location === 'string'
              ? details.location
              : '';
        await client.inviteSelf(location);
        return client.hideNotification(n.id);
      }
      if (n.type === 'requestInvite') {
        if (!n.senderUserId) throw new ApiError('Уведомление не содержит отправителя.');
        await client.invite(n.senderUserId, currentLocation || '');
        return client.hideNotification(n.id);
      }
      return request('/auth/user/notifications/' + segment(n.id) + '/accept', 'PUT', {});
    },
    hideNotification: (id: string) =>
      request('/auth/user/notifications/' + segment(id) + '/hide', 'PUT', {}),
    async dismissNotification(n: Notification): Promise<unknown> {
      const details = n.details || {};
      const groupId =
        n.type === 'group.invite' || n.type === 'group.joinRequest'
          ? await resolveNotificationGroup(n)
          : undefined;
      if (n.type === 'group.invite' && groupId) await client.declineGroupInvite(groupId);
      if (n.type === 'group.joinRequest' && groupId) {
        const userId =
          typeof details.requestUserId === 'string'
            ? details.requestUserId
            : typeof details.userId === 'string'
              ? details.userId
              : n.senderUserId;
        if (!userId) throw new ApiError('Не удалось определить отправителя запроса.');
        await client.respondGroupJoinRequest(groupId, userId, 'reject');
      }
      return client.hideNotification(n.id);
    },
    readNotification: (id: string) =>
      request('/auth/user/notifications/' + segment(id) + '/see', 'PUT', {}),
    calendar: (date: Date, filter: 'all' | 'following' = 'all', offset = 0) =>
      list<CalendarEvent>(
        '/calendar' +
          (filter === 'following' ? '/following' : '') +
          query({
            date: new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1)).toISOString(),
            n: 100,
            offset,
          }),
      ),
    calendarEvent: (groupId: string, id: string) =>
      request<CalendarEvent>('/calendar/' + segment(groupId) + '/' + segment(id)),
    followEvent: (groupId: string, id: string, isFollowing: boolean) =>
      request('/calendar/' + segment(groupId) + '/' + segment(id) + '/follow', 'POST', {
        isFollowing,
      }),
    files: (tag: UploadTag | 'emojianimated', offset = 0) =>
      list<VrcFile>('/files' + query({ tag, n: 100, offset })),
    file: (id: string) => request<VrcFile>('/file/' + segment(id)),
    deleteFile: (id: string) => request('/file/' + segment(id), 'DELETE'),
    inventory: (offset = 0) => list<InventoryItem>('/inventory' + query({ n: 100, offset })),
    prints: (userId: string, offset = 0) =>
      list<VrcFile>('/prints/user/' + segment(userId) + query({ n: 100, offset })),
    deletePrint: (id: string) => request('/prints/' + segment(id), 'DELETE'),
    async uploadImage(file: File, tag: UploadTag): Promise<VrcFile> {
      ensureNative();
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type))
        throw new ApiError('Выберите PNG, JPEG, GIF или WebP.');
      if (file.size > 10 * 1024 * 1024) throw new ApiError('Изображение должно быть меньше 10 МБ.');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new ApiError('Не удалось прочитать изображение.'));
        reader.readAsDataURL(file);
      });
      return checked<VrcFile>(
        await transport.uploadImage({ tag, data, mimeType: file.type, fileName: file.name }),
      );
    },
    messageTemplates: (userId: string, type: MessageType = 'message') =>
      list<MessageTemplate>('/message/' + segment(userId) + '/' + segment(type)),
    async sendMessage(userId: string, targetId: string, text: string): Promise<void> {
      const message = 'msg ' + text.trim();
      if (!text.trim() || message.length > 64)
        throw new ApiError('Сообщение должно содержать от 1 до 60 символов.');
      const templates = await client.messageTemplates(userId);
      // Reuse matching text even during edit cooldown; otherwise use only a server-reported editable slot.
      const existing = templates.find((s) => s.message === message);
      const slot =
        existing ??
        templates.find((s) => s.canBeUpdated === true && (s.remainingCooldownMinutes || 0) <= 0);
      if (!slot)
        throw new ApiError(
          'Все шаблоны сообщений находятся на паузе VRChat. Повторите позже.',
          429,
          60,
        );
      if (!existing)
        await request('/message/' + segment(userId) + '/message/' + slot.slot, 'PUT', { message });
      await client.invite(
        targetId,
        'wrld_4432ea9b-729c-46e3-8eaf-846aa0a37fdd:0~region(eu)',
        slot.slot,
      );
    },
    async respondToInvite(
      userId: string,
      notificationId: string,
      type: 'invite' | 'requestInvite',
      text: string,
    ): Promise<void> {
      if (!text.trim() || text.length > 64)
        throw new ApiError('Ответ должен содержать от 1 до 64 символов.');
      const pool = type === 'requestInvite' ? 'requestResponse' : 'response';
      const templates = await client.messageTemplates(userId, pool);
      const existing = templates.find((s) => s.message === text);
      const slot =
        existing ??
        templates.find((s) => s.canBeUpdated === true && (s.remainingCooldownMinutes || 0) <= 0);
      if (!slot) throw new ApiError('Все шаблоны ответов находятся на паузе VRChat.', 429, 60);
      if (!existing)
        await request('/message/' + segment(userId) + '/' + pool + '/' + slot.slot, 'PUT', {
          message: text,
        });
      await request('/invite/' + segment(notificationId) + '/response', 'POST', {
        responseSlot: slot.slot,
      });
    },
  };
  return client;
}
export const api = createApi(native, () => isNative);
export type VrcApi = ReturnType<typeof createApi>;
