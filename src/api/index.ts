import { native, isNative } from './native';
import type { Print } from './prints';
import { normalizeCalendarEvent, normalizeCalendarPage } from './calendar';
import { instanceCreationOptions } from './instances';
import { normalizeFriendPresence } from './friends';
import { normalizeGroups } from './groups';
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
/** Authentication errors identify the failed phase without exposing request data. */
export class AuthError extends ApiError {
  constructor(
    message: string,
    public stage: 'credentials' | 'restore' | 'twoFactor' | 'profile',
    status = 0,
    retryAfter?: number,
  ) {
    super(message, status, retryAfter);
    this.name = 'AuthError';
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
export function normalizeNotification(
  value: unknown,
  v2 = false,
  protocol?: Notification['_protocol'],
): Notification {
  const raw = record(value);
  if (!raw || typeof raw.id !== 'string' || typeof raw.type !== 'string')
    throw new ApiError('VRChat вернул некорректное уведомление.');
  const details = { ...jsonRecord(raw.details), ...jsonRecord(raw.data), ...jsonRecord(raw._data) };
  const string = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return {
    id: raw.id,
    type: raw.type,
    senderUserId: string(raw.senderUserId) || string(raw.senderId),
    senderUsername:
      string(raw.senderDisplayName) ||
      string(raw.senderUsername) ||
      (raw.type === 'boop' ? string(details.boopingUserDisplayName) : undefined),
    message:
      string(raw.message) ||
      string(details.responseMessage) ||
      string(details.inviteMessage) ||
      string(details.requestMessage),
    created_at: string(raw.created_at) || string(raw.createdAt),
    seen: raw.seen === true,
    details,
    _v2: v2 || raw._v2 === true,
    _protocol: protocol || (v2 || raw._v2 === true ? 'modern-v2' : 'v1'),
    canDelete: typeof raw.canDelete === 'boolean' ? raw.canDelete : undefined,
    _data: jsonRecord(raw.data) || jsonRecord(raw._data),
    _link: string(raw.link) || string(raw._link),
    link: string(raw.link) || string(raw._link),
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
export function isTwoFactorChallenge(data: unknown): data is TwoFactorChallenge {
  const response = record(data);
  return Array.isArray(response?.requiresTwoFactorAuth);
}
function authResponse(data: unknown, stage: AuthError['stage']): User | TwoFactorChallenge {
  const response = record(data);
  if (!response) throw new AuthError('VRChat вернул некорректный ответ входа.', stage);
  if ('requiresTwoFactorAuth' in response) {
    if (!Array.isArray(response.requiresTwoFactorAuth))
      throw new AuthError('VRChat вернул некорректный способ подтверждения.', stage);
    const methods = [
      ...new Set(
        response.requiresTwoFactorAuth
          .filter((method): method is string => typeof method === 'string')
          .map((method) => method.toLowerCase())
          .filter((method) => ['totp', 'emailotp', 'otp'].includes(method)),
      ),
    ];
    if (!methods.length)
      throw new AuthError(
        'VRChat запросил способ подтверждения, который пока не поддерживается.',
        stage,
      );
    return { requiresTwoFactorAuth: methods };
  }
  if (
    typeof response.id !== 'string' ||
    !response.id ||
    typeof response.displayName !== 'string' ||
    !response.displayName
  )
    throw new AuthError('VRChat не вернул полный профиль пользователя.', stage);
  return response as unknown as User;
}
function phasedAuthError(
  error: unknown,
  stage: AuthError['stage'],
  unauthorized: string,
): AuthError {
  if (error instanceof AuthError && error.stage === stage) return error;
  if (error instanceof ApiError)
    return new AuthError(
      error.status === 401 ? unauthorized : error.message,
      stage,
      error.status,
      error.retryAfter,
    );
  return new AuthError(
    'Не удалось завершить вход. Проверьте подключение и повторите попытку.',
    stage,
  );
}
function requireLocation(location: string) {
  if (!/^wrld_[a-zA-Z0-9-]+:[a-zA-Z0-9~_().+\-]+$/.test(location)
      || ['private', 'offline', 'traveling'].includes(location.slice(location.indexOf(':') + 1).split('~')[0]))
    throw new ApiError('Нет доступного инстанса. Откройте мир и выберите инстанс.');
  return location;
}
/** VRChat routes parse the literal worldId:instanceId delimiter before decoding segments. */
function instancePathSegment(location: string) {
  const full = requireLocation(location);
  const delimiter = full.indexOf(':');
  return segment(full.slice(0, delimiter)) + ':' + segment(full.slice(delimiter + 1));
}

/** All network I/O uses the native transport; browser preview never accepts account credentials. */
export function createApi(transport: NativeBridge, available: () => boolean = () => true) {
  let v2Protocol: 'unknown' | 'modern-v2' | 'legacy-v2' | 'unsupported' = 'unknown';
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
    async resumeOnLaunch(): Promise<User | TwoFactorChallenge | null> {
      ensureNative();
      let state: { hasAuth: boolean };
      try {
        state = await transport.sessionState();
      } catch {
        throw new AuthError(
          'Не удалось проверить локальную сессию. Начните новый вход.',
          'restore',
        );
      }
      // A fresh install must show the login form immediately, even without internet.
      if (!state.hasAuth) return null;
      return client.authState();
    },
    async authState(): Promise<User | TwoFactorChallenge> {
      try {
        const result = authResponse(await request<unknown>('/auth/user'), 'restore');
        authenticatedUserId = isTwoFactorChallenge(result) ? undefined : result.id;
        return result;
      } catch (error) {
        throw phasedAuthError(
          error,
          'restore',
          'Сохранённая сессия недействительна. Введите данные для нового входа.',
        );
      }
    },
    async resume(): Promise<User> {
      const result = await client.authState();
      if (isTwoFactorChallenge(result))
        throw new AuthError('Для продолжения подтвердите вход кодом VRChat.', 'restore', 401);
      return result;
    },
    async login(username: string, password: string): Promise<User | TwoFactorChallenge> {
      ensureNative();
      if (!username.trim() || !password)
        throw new AuthError('Введите имя пользователя и пароль.', 'credentials');
      // A new credentials submission starts one isolated login. Code retries never clear it.
      try {
        await transport.clearSession();
      } catch {
        throw new AuthError(
          'Не удалось подготовить локальную сессию. Повторите вход.',
          'credentials',
        );
      }
      v2Protocol = 'unknown';
      authenticatedUserId = undefined;
      try {
        // Do not retain either credential beyond this request.
        const result = authResponse(
          await request<unknown>(
            '/auth/user',
            'GET',
            undefined,
            basicAuthorization(username.trim(), password),
          ),
          'credentials',
        );
        if (!isTwoFactorChallenge(result)) authenticatedUserId = result.id;
        return result;
      } catch (error) {
        throw phasedAuthError(
          error,
          'credentials',
          'VRChat не принял имя пользователя или пароль. Используйте данные аккаунта VRChat, а не отображаемое имя.',
        );
      }
    },
    async cancelLogin(): Promise<void> {
      ensureNative();
      try {
        await transport.clearSession();
      } catch {
        throw new AuthError('Не удалось очистить временную сессию. Повторите попытку.', 'restore');
      }
      authenticatedUserId = undefined;
    },
    async verify2fa(code: string, type: TwoFactorType | string): Promise<User> {
      const method = type.trim().toLowerCase();
      if (!['totp', 'emailotp', 'otp'].includes(method))
        throw new AuthError('Этот способ подтверждения не поддерживается.', 'twoFactor');
      // Email/TOTP codes are six digits. Pasted whitespace is not part of the code.
      // Recovery codes retain punctuation/case; their exact format is owned by VRChat.
      const entered = method === 'otp' ? code.trim() : code.replace(/\s+/g, '');
      if (!entered) throw new AuthError('Введите код подтверждения.', 'twoFactor');
      if (method !== 'otp' && !/^\d{6}$/.test(entered))
        throw new AuthError('Введите 6 цифр кода подтверждения.', 'twoFactor');
      try {
        const result = await request<unknown>(`/auth/twofactorauth/${method}/verify`, 'POST', {
          code: entered,
        });
        const verified = record(result)?.verified;
        if (verified === false)
          throw new AuthError(
            'Неверный или просроченный код. Проверьте новый код и повторите попытку.',
            'twoFactor',
            400,
          );
        if (verified !== true)
          throw new AuthError(
            'VRChat вернул некорректный ответ подтверждения. Повторите попытку.',
            'twoFactor',
          );
      } catch (error) {
        throw phasedAuthError(
          error,
          'twoFactor',
          'VRChat не принял код или временная сессия входа закончилась. Проверьте свежий код; при повторной ошибке начните вход заново.',
        );
      }
      try {
        const user = await client.authState();
        if (isTwoFactorChallenge(user))
          throw new AuthError(
            'Код принят, но VRChat всё ещё требует подтверждение входа. Начните вход заново.',
            'profile',
            401,
          );
        return user;
      } catch (error) {
        throw phasedAuthError(
          error,
          'profile',
          'Код принят, но VRChat не восстановил сессию для загрузки профиля. Начните вход заново.',
        );
      }
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
    friends: async (offline = false, offset = 0) =>
      (await list<User>('/auth/user/friends' + query({ offline, n: 100, offset })))
        .map((user) => normalizeFriendPresence(user, offline)),
    allOnlineFriends: () => allPages<User>((offset) => client.friends(false, offset)),
    async allFriends(): Promise<User[]> {
      const online = await allPages<User>((offset) => client.friends(false, offset));
      const offline = await allPages<User>((offset) => client.friends(true, offset));
      // The two paginated snapshots may overlap when someone changes presence.
      // Keep the online/website row instead of replacing it with an offline duplicate.
      const unique = new Map<string, User>();
      for (const user of [...online, ...offline]) if (!unique.has(user.id)) unique.set(user.id, user);
      return [...unique.values()];
    },
    user: (id: string) => request<User>('/users/' + segment(id)),
    userProfile: (id: string) => request<Record<string, unknown>>('/profile/' + segment(id)),
    async boop(id: string): Promise<void> {
      const response = await request<unknown>('/users/' + segment(id) + '/boop', 'POST', {});
      const success = record(record(response)?.success);
      if (!success || (typeof success.status_code === 'number' && (success.status_code < 200 || success.status_code >= 300)))
        throw new ApiError('VRChat не подтвердил отправку Boop. Обновите профиль перед повторной попыткой.');
    },
    searchUsers: (search: string, offset = 0) =>
      list<User>('/users' + query({ search, n: 50, offset })),
    friendRequest: (id: string) => request('/user/' + segment(id) + '/friendRequest', 'POST', {}),
    unfriend: (id: string) => request('/auth/user/friends/' + segment(id), 'DELETE'),
    note: (id: string, note: string) => request('/userNotes', 'POST', { targetUserId: id, note }),
    userGroups: async (id: string) => normalizeGroups(await list<Group>('/users/' + segment(id) + '/groups')),
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
      request<Instance>('/instances/' + instancePathSegment(location)),
    createInstance: (options: CreateInstanceOptions) =>
      request<Instance>('/instances', 'POST', instanceCreationOptions(options)),
    inviteSelf: (location: string) =>
      request('/instances/' + instancePathSegment(location) + '/invite', 'POST', {}),
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
      return normalizeGroups(await list<Group>('/users/' + segment(userId) + '/groups')).map((group) => ({
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
      return (await client.notificationPage(offset)).items;
    },
    async notificationPage(offset = 0, isCurrent: () => boolean = () => true): Promise<{ items: Notification[]; hasMore: boolean }> {
      if (!isCurrent()) return { items: [], hasMore: false };
      const v1 = (
        await list<unknown>('/auth/user/notifications' + query({ n: 100, offset, hidden: false }))
      ).map((n) => normalizeNotification(n));
      if (!isCurrent()) return { items: [], hasMore: false };
      const v2 = await client.notificationsV2(offset);
      // The same event can be returned by both endpoints; retain the v1 action identity.
      const merged = new Map(v1.map((n) => [n.id, n]));
      for (const n of v2) if (!merged.has(n.id)) merged.set(n.id, n);
      return { items: [...merged.values()].sort((a, b) =>
        (b.created_at || '').localeCompare(a.created_at || ''),
      ), hasMore: v1.length >= 100 || (v2Protocol === 'legacy-v2' && v2.length >= 100) };
    },
    async notificationsV2(offset = 0): Promise<Notification[]> {
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new ApiError('Некорректная страница уведомлений.');
      if (v2Protocol === 'unsupported') return [];
      // Modern V2 offers only a recent snapshot, not offset pagination. Do not repeatedly
      // download it when the caller is loading older V1 notifications.
      if (offset > 0 && v2Protocol !== 'legacy-v2') return [];
      if (v2Protocol !== 'legacy-v2') {
        try {
          const result = await list<unknown>('/notifications' + query({ limit: 100 }));
          v2Protocol = 'modern-v2';
          return result.map((n) => normalizeNotification(n, true, 'modern-v2'));
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
          v2Protocol = 'legacy-v2';
        }
      }
      try {
        const result = await list<unknown>('/auth/user/notificationsV2' + query({ n: 100, offset }));
        return result.map((n) => normalizeNotification(n, true, 'legacy-v2'));
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        v2Protocol = 'unsupported';
        return [];
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
        return n.canDelete === false ? client.readNotification(n) : client.hideNotification(n);
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
        return n.canDelete === false ? client.readNotification(n) : client.hideNotification(n);
      }
      if (n.type === 'invite') {
        const location =
          typeof details.worldId === 'string'
            ? details.worldId
            : typeof details.location === 'string'
              ? details.location
              : '';
        await client.inviteSelf(location);
        return n.canDelete === false ? client.readNotification(n) : client.hideNotification(n);
      }
      if (n.type === 'requestInvite') {
        if (!n.senderUserId) throw new ApiError('Уведомление не содержит отправителя.');
        await client.invite(n.senderUserId, currentLocation || '');
        return n.canDelete === false ? client.readNotification(n) : client.hideNotification(n);
      }
      return request('/auth/user/notifications/' + segment(n.id) + '/accept', 'PUT', {});
    },
    hideNotification: (notification: string | Notification) => {
      const n = typeof notification === 'string' ? undefined : notification;
      const id = typeof notification === 'string' ? notification : notification.id;
      if (n?.canDelete === false)
        throw new ApiError('VRChat не разрешает удалить это уведомление. Его можно отметить прочитанным.', 403);
      return (n?._protocol || (n?._v2 ? 'modern-v2' : 'v1')) === 'modern-v2'
        ? request('/notifications/' + segment(id), 'DELETE')
        : request('/auth/user/notifications/' + segment(id) + '/hide', 'PUT', {});
    },
    async dismissNotification(n: Notification): Promise<unknown> {
      // Check before declining a group invitation: a blocked delete must not perform
      // an unrelated remote mutation and then report the whole action as failed.
      if (n.canDelete === false)
        throw new ApiError('VRChat не разрешает удалить это уведомление. Его можно отметить прочитанным.', 403);
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
      return client.hideNotification(n);
    },
    readNotification: (notification: string | Notification) => {
      const n = typeof notification === 'string' ? undefined : notification;
      const id = typeof notification === 'string' ? notification : notification.id;
      return (n?._protocol || (n?._v2 ? 'modern-v2' : 'v1')) === 'modern-v2'
        ? request('/notifications/' + segment(id) + '/see', 'POST', {})
        : request('/auth/user/notifications/' + segment(id) + '/see', 'PUT', {});
    },
    async calendar(date: Date, filter: 'all' | 'following' = 'all', offset = 0) {
      return (await client.calendarPage(date, filter, offset)).events;
    },
    calendarPage: async (date: Date, filter: 'all' | 'following' = 'all', offset = 0) =>
      normalizeCalendarPage(await request<unknown>(
        '/calendar' + (filter === 'following' ? '/following' : '') +
          query({ date: new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1)).toISOString(), n: 100, offset }),
      ), offset, filter === 'following'),
    calendarEvent: async (groupId: string, id: string) =>
      normalizeCalendarEvent(await request<unknown>('/calendar/' + segment(groupId) + '/' + segment(id))),
    followEvent: async (groupId: string, id: string, isFollowing: boolean) =>
      normalizeCalendarEvent(await request<unknown>('/calendar/' + segment(groupId) + '/' + segment(id) + '/follow', 'POST', {
        isFollowing,
      })),
    files: (tag: UploadTag | 'emojianimated', offset = 0) =>
      list<VrcFile>('/files' + query({ tag, n: 100, offset })),
    file: (id: string) => request<VrcFile>('/file/' + segment(id)),
    deleteFile: (id: string) => request('/file/' + segment(id), 'DELETE'),
    inventory: (offset = 0) => list<InventoryItem>('/inventory' + query({ n: 100, offset })),
    prints: (userId: string, offset = 0) =>
      list<Print>('/prints/user/' + segment(userId) + query({ n: 100, offset })),
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
