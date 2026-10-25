import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe2,
  RefreshCw,
  Search,
  Send,
  Users,
} from 'lucide-react';
import { api, native, isNative } from '../api';
import type { Avatar, Group, User, World } from '../api';
import {
  asRecord,
  asString,
  normalizeProfileGroups,
  profileData,
  profileDate,
  profileFriendAccess,
  safeProfileJson,
} from '../api/profile-data';
import type { JsonRecord, ProfileFavoriteGroup } from '../api/profile-data';
import { useApp, useLoad } from '../state';
import { usePaged } from '../hooks/usePaged';
import { disclosedUserLocation, instanceType } from '../data/locations';
import { friendsInInstance, instanceCount, instanceCreator, instanceGroup } from '../data/instance-location';
import { demoAvatars, demoFriends, demoGroups, demoWorlds } from '../demo';
import { AvatarDetail } from '../pages/Explore';
import { HistoryRows } from '../pages/Feed';
import {
  AvatarImage,
  Badge,
  Empty,
  ErrorState,
  imageOf,
  Loading,
  SearchField,
  Segmented,
} from './ui';
import SecureImage from './SecureImage';
import './UserProfileTabs.css';

export const userProfileTabs = [
  { id: 'profile', label: 'Информация' },
  { id: 'mutual', label: 'Mutual Friends' },
  { id: 'groups', label: 'Группы' },
  { id: 'worlds', label: 'Миры' },
  { id: 'favorites', label: 'Избранные миры' },
  { id: 'avatars', label: 'Аватары' },
  { id: 'activity', label: 'Activity' },
  { id: 'json', label: 'JSON' },
];

async function copyText(text: string) {
  if (isNative) await native.copyText({ text });
  else await navigator.clipboard.writeText(text);
}

function Metadata({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="user-meta-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function ProfileInformation({ user, profile }: { user: User; profile?: JsonRecord }) {
  const ctx = useApp(),
    raw = asRecord(user),
    publicData = profile || {};
  const badges = Array.isArray(publicData.badges)
    ? publicData.badges.map(asRecord).filter((badge) => badge.hidden !== true)
    : [];
  const avatarName = asString(publicData.currentAvatarName);
  return (
    <>
      <dl className="user-metadata">
        <Metadata label="ID">
          <button
            className="text-button copy-id"
            onClick={() => {
              void copyText(user.id)
                .then(() => ctx.notify('ID скопирован'))
                .catch(() => ctx.notify('Не удалось скопировать ID'));
            }}
          >
            <span>{user.id}</span>
            <Copy size={14} />
          </button>
        </Metadata>
        <Metadata label="Регистрация">{profileDate(user.date_joined)}</Metadata>
        <Metadata label="Последний вход">{profileDate(user.last_login)}</Metadata>
        <Metadata label="Последняя активность">{profileDate(user.last_activity)}</Metadata>
        {asString(raw.last_platform) && (
          <Metadata label="Последняя платформа">{asString(raw.last_platform)}</Metadata>
        )}
        {asString(raw.platform) && (
          <Metadata label="Текущая платформа">{asString(raw.platform)}</Metadata>
        )}
        {typeof raw.allowAvatarCopying === 'boolean' && (
          <Metadata label="Копирование аватара">
            {raw.allowAvatarCopying ? 'Разрешено' : 'Запрещено'}
          </Metadata>
        )}
        {asString(raw.developerType) && (
          <Metadata label="Тип разработчика">{asString(raw.developerType)}</Metadata>
        )}
      </dl>
      {badges.length > 0 && (
        <section className="user-badges" aria-label="Бейджи пользователя">
          {badges.map((badge, index) => (
            <div className="user-badge" key={asString(badge.badgeId) || index}>
              <SecureImage src={asString(badge.badgeImageUrl)} alt="" />
              <div>
                <strong>{asString(badge.badgeName) || 'Бейдж'}</strong>
                <p className="muted small">{asString(badge.badgeDescription)}</p>
              </div>
            </div>
          ))}
        </section>
      )}
      {(avatarName || user.currentAvatarImageUrl || user.currentAvatarThumbnailImageUrl) && (
        <section className="user-current-avatar inset-panel">
          <SecureImage
            src={user.currentAvatarImageUrl || user.currentAvatarThumbnailImageUrl}
            alt={avatarName || 'Текущий аватар'}
          />
          <div>
            <h3>{avatarName || 'Текущий аватар'}</h3>
            {asString(publicData.currentAvatarAuthorName) && (
              <p className="muted small">Автор: {asString(publicData.currentAvatarAuthorName)}</p>
            )}
            {user.currentAvatar && <p className="muted small id-text">{user.currentAvatar}</p>}
          </div>
        </section>
      )}
      <ProfileLocation key={user.location || 'unknown'} user={user} />
    </>
  );
}

/** The instance card keeps disclosed owner/friend evidence visible even if metadata fails. */
export function ProfileLocation({ user }: { user: User }) {
  const location = disclosedUserLocation(user);
  return <ProfileLocationContent key={`${user.id}:${location || user.location || 'unknown'}`} user={user} />;
}

function ProfileLocationContent({ user }: { user: User }) {
  const ctx = useApp();
  const location = disclosedUserLocation(user);
  const worldId = location?.split(':')[0];
  const load = useLoad(async () => {
    if (!location) return undefined;
    if (ctx.demo) return { type: 'public', n_users: 18 };
    const value = await api.instance(location);
    if (!value || typeof value !== 'object') throw new Error('VRChat не передал сведения об этом инстансе.');
    return value;
  }, [location, ctx.demo, ctx.refresh]);
  const worldLoad = useLoad(async () => {
    if (!worldId) return undefined;
    if (ctx.demo) return demoWorlds.find((world) => world.id === worldId);
    return api.world(worldId);
  }, [worldId, ctx.demo]);
  const instance = asRecord(load.data);
  const instanceWorld = asRecord(instance.world);
  const world = instanceWorld.id === worldId && typeof instanceWorld.name === 'string'
    ? instanceWorld as unknown as World : worldLoad.data;
  const creatorId = location ? instanceCreator(location, instance) : undefined;
  const groupId = location ? instanceGroup(location, instance) : undefined;
  const knownCreator = creatorId === user.id ? user : creatorId === ctx.user.id ? ctx.user
    : ctx.friends.data.find((friend) => friend.id === creatorId);
  const creatorLoad = useLoad(async () => {
    if (!creatorId || knownCreator) return knownCreator;
    if (ctx.demo) return demoFriends.find((friend) => friend.id === creatorId);
    return api.user(creatorId);
  }, [creatorId, knownCreator, ctx.demo]);
  const creator = creatorLoad.data?.id === creatorId ? creatorLoad.data : knownCreator;
  if (!location) return user.location === 'private' || user.instanceId === 'private' ? (
    <p className="muted small">Пользователь скрыл местоположение. Данные инстанса недоступны.</p>
  ) : null;
  const friends = friendsInInstance(location, ctx.friends.data, user, instance);
  const count = instanceCount(instance.n_users) ?? instanceCount(instance.userCount);
  const capacity = instanceCount(instance.capacity) ?? instanceCount(instance.recommendedCapacity) ?? instanceCount(world?.capacity);
  const platformCounts = Object.entries(asRecord(instance.platforms)).filter(
    ([key, value]) => ['standalonewindows', 'android', 'ios'].includes(key) && instanceCount(value) !== undefined,
  );
  return <section className="inset-panel user-location" aria-label="Текущий инстанс">
    <h3><Globe2 size={17} /> Текущий инстанс</h3>
    <button className="user-location-world" aria-label={`Открыть мир ${world?.name || worldId}`} onClick={() => ctx.openWorld(world || worldId!)}>
      {world && <SecureImage src={imageOf(world)} alt="" />}
      <span><strong>{world?.name || worldId}</strong><small>{instanceType(location, asString(instance.type), asString(instance.groupAccessType))}
        {count !== undefined ? ` · ${count}${capacity !== undefined ? `/${capacity}` : ''} участников` : ''}
      </small></span><ExternalLink size={16} />
    </button>
    {load.loading && !load.data && <p className="muted small" role="status">Загружаем сведения инстанса…</p>}
    {load.error && <ErrorState error={load.error} retry={load.reload} />}
    {!world && worldLoad.error && <ErrorState error={worldLoad.error} retry={worldLoad.reload} />}
    <dl className="user-metadata">
      {asString(instance.displayName) && <Metadata label="Название">{asString(instance.displayName)}</Metadata>}
      <Metadata label="Инстанс"><span className="id-text">{location.slice(location.indexOf(':') + 1)}</span></Metadata>
      {(asString(instance.region) || asString(instance.photonRegion)) && <Metadata label="Регион">{asString(instance.region) || asString(instance.photonRegion)}</Metadata>}
      {groupId && <Metadata label="Группа-владелец"><button className="text-button id-text" onClick={() => ctx.openGroup({ id: groupId, name: groupId })}>{groupId}</button></Metadata>}
      {platformCounts.length > 0 && <Metadata label="Платформы">{platformCounts.map(([key, value]) => <Badge key={key}>{{ standalonewindows: 'PC', android: 'Android', ios: 'iOS' }[key]}: {String(value)}</Badge>)}</Metadata>}
    </dl>
    <section className="instance-creator" aria-label="Создатель инстанса">
      <h4>Создатель инстанса</h4>
      {creatorId ? <button className="list-row instance-person" aria-label={`Открыть профиль ${creator?.displayName || creatorId}`} onClick={() => ctx.openUser(creator || creatorId)}>
        <AvatarImage name={creator?.displayName || creatorId} src={creator ? imageOf(creator) : undefined} size={38} />
        <span><strong>{creator?.displayName || creatorId}</strong><small>Создатель инстанса</small></span><ExternalLink size={14} />
      </button> : <p className="muted small">VRChat не передал создателя этого инстанса.</p>}
      {creatorLoad.error && <p className="muted small">Не удалось загрузить профиль создателя. <button className="text-button" onClick={creatorLoad.reload}>Повторить</button></p>}
    </section>
    <section className="instance-friends" aria-label="Друзья в инстансе">
      <h4>Друзья в инстансе · {friends.length}</h4>
      {friends.length ? <div className="user-presence-list">{friends.map((friend) => <button className="list-row instance-person" key={friend.id} aria-label={`Открыть профиль ${friend.displayName}`} onClick={() => ctx.openUser(friend)}>
        <AvatarImage name={friend.displayName} src={imageOf(friend)} size={36} user={friend} fallbackSrc={friend.currentAvatarThumbnailImageUrl || friend.currentAvatarImageUrl} />
        <span><strong>{friend.displayName}</strong>{friend.id === creatorId && <small>Создатель инстанса</small>}</span>
      </button>)}</div> : <p className="muted small">В доступных данных нет друзей с подтверждённым присутствием в этом инстансе.</p>}
    </section>
    <div className="detail-actions">
      <button className="button secondary compact" onClick={() => void ctx.act(() => api.inviteSelf(location), 'Приглашение себе отправлено')}><Send size={15} />Пригласить себя</button>
      {user.id !== ctx.user.id && <button className="button secondary compact" onClick={() => void ctx.act(() => api.requestInvite(user.id), 'Запрос приглашения отправлен')}>Попросить инвайт</button>}
    </div>
  </section>;
}

function LoadMore({
  loading,
  hasMore,
  onClick,
}: {
  loading: boolean;
  hasMore: boolean;
  onClick: () => void;
}) {
  return hasMore ? (
    <button className="button secondary profile-load-more" disabled={loading} onClick={onClick}>
      {loading ? <RefreshCw size={15} className="spin" /> : null}
      {loading ? 'Загрузка…' : 'Загрузить ещё'}
    </button>
  ) : null;
}

function MutualTab({ user }: { user: User }) {
  const ctx = useApp(),
    [search, setSearch] = useState('');
  const load = usePaged<User>(
    (offset) =>
      ctx.demo
        ? Promise.resolve(offset ? [] : demoFriends.slice(0, 2))
        : profileData.mutualFriends(user.id, offset),
    [user.id, ctx.demo],
    100,
  );
  const users = load.items.filter((friend) =>
    friend.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="form-stack">
      <SearchField value={search} onChange={setSearch} placeholder="Поиск по общим друзьям" />
      {load.error && <ErrorState error={load.error} retry={load.reload} />}
      {load.loading && !load.items.length ? (
        <Loading />
      ) : (
        <>
          {!users.length && (
            <Empty
              title="Нет доступных общих друзей"
              text="Общие связи отображаются, если это разрешено настройками VRChat обоих аккаунтов."
            />
          )}
          {users.map((friend) => (
            <button className="list-row" key={friend.id} onClick={() => ctx.openUser(friend)}>
              <AvatarImage name={friend.displayName} src={imageOf(friend)} user={friend} fallbackSrc={friend.currentAvatarThumbnailImageUrl || friend.currentAvatarImageUrl} />
              <span>
                <strong>{friend.displayName}</strong>
                {friend.statusDescription && <small>{friend.statusDescription}</small>}
              </span>
            </button>
          ))}
          <LoadMore loading={load.moreLoading} hasMore={load.hasMore} onClick={load.loadMore} />
        </>
      )}
    </div>
  );
}

function GroupsTab({ user }: { user: User }) {
  const ctx = useApp(),
    [mode, setMode] = useState('all'),
    [search, setSearch] = useState('');
  const all = useLoad(
    () =>
      ctx.demo ? Promise.resolve(demoGroups) : api.userGroups(user.id).then(normalizeProfileGroups),
    [user.id, ctx.demo],
  );
  const mutual = usePaged<Group>(
    (offset) =>
      ctx.demo
        ? Promise.resolve(offset ? [] : demoGroups)
        : profileData.mutualGroups(user.id, offset),
    [user.id, ctx.demo],
    100,
  );
  const common = new Set(mutual.items.map((group) => group.id));
  const groups = (mode === 'all' ? all.data || [] : mutual.items).filter((group) =>
    group.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const error = mode === 'all' ? all.error : mutual.error,
    loading = mode === 'all' ? all.loading : mutual.loading;
  return (
    <div className="form-stack">
      <Segmented
        value={mode}
        onChange={setMode}
        items={[
          { id: 'all', label: 'Все доступные' },
          { id: 'mutual', label: 'Общие группы' },
        ]}
      />
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder="Поиск по группам пользователя"
      />
      {error && <ErrorState error={error} retry={mode === 'all' ? all.reload : mutual.reload} />}
      {loading && !groups.length ? (
        <Loading />
      ) : (
        <>
          {groups.map((group) => (
            <button className="list-row" key={group.id} onClick={() => ctx.openGroup(group)}>
              <AvatarImage name={group.name} src={group.iconUrl} />
              <span>
                <strong>{group.name}</strong>
                <small>
                  {group.memberCount !== undefined
                    ? `${group.memberCount.toLocaleString('ru-RU')} участников`
                    : ''}
                </small>
              </span>
              {common.has(group.id) && (
                <Badge>
                  <Check size={12} /> Общая
                </Badge>
              )}
            </button>
          ))}
          {!groups.length && !error && <Empty title="Нет доступных групп" />}
        </>
      )}
      {mode === 'mutual' && (
        <LoadMore loading={mutual.moreLoading} hasMore={mutual.hasMore} onClick={mutual.loadMore} />
      )}
    </div>
  );
}

function WorldCards({ worlds }: { worlds: World[] }) {
  const ctx = useApp();
  return (
    <div className="user-content-grid">
      {worlds.map((world) => (
        <button className="user-content-card" key={world.id} onClick={() => ctx.openWorld(world)}>
          <SecureImage src={imageOf(world)} alt="" />
          <div>
            <strong>{world.name}</strong>
            <small>{world.authorName || 'Автор не передан'}</small>
            {world.description && <p>{world.description}</p>}
          </div>
        </button>
      ))}
    </div>
  );
}

function WorldsTab({ user }: { user: User }) {
  const ctx = useApp(),
    [search, setSearch] = useState('');
  const load = usePaged<World>(
    (offset) =>
      ctx.demo
        ? Promise.resolve(offset ? [] : demoWorlds.filter((world) => world.authorId === user.id))
        : profileData.authoredWorlds(user.id, user.id === ctx.user.id, offset),
    [user.id, ctx.demo],
    50,
  );
  const worlds = load.items.filter(
    (world) =>
      world.authorId === user.id &&
      `${world.name} ${world.description || ''}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="form-stack">
      <SearchField value={search} onChange={setSearch} placeholder="Поиск по мирам автора" />
      {load.error && <ErrorState error={load.error} retry={load.reload} />}
      {load.loading && !load.items.length ? (
        <Loading />
      ) : (
        <>
          {worlds.length ? (
            <WorldCards worlds={worlds} />
          ) : (
            <Empty
              title="Нет доступных миров"
              text="Показываются только миры, которые API разрешает просматривать этому аккаунту."
            />
          )}
          <LoadMore loading={load.moreLoading} hasMore={load.hasMore} onClick={load.loadMore} />
        </>
      )}
    </div>
  );
}

function FavoriteWorldContents({
  user,
  group,
  viewerIsFriend,
}: {
  user: User;
  group: ProfileFavoriteGroup;
  viewerIsFriend: boolean;
}) {
  const ctx = useApp(),
    [search, setSearch] = useState('');
  const load = useLoad(
    () =>
      ctx.demo
        ? Promise.resolve(demoWorlds)
        : profileData.favoriteWorlds(user.id, group, user.id === ctx.user.id, viewerIsFriend),
    [user.id, ctx.user.id, group.type, group.name, group.visibility, viewerIsFriend, ctx.demo],
  );
  const worlds = (load.data || []).filter((world) =>
    world.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <>
      <SearchField value={search} onChange={setSearch} placeholder="Поиск по избранным мирам" />
      {load.error && <ErrorState error={load.error} retry={load.reload} />}
      {load.loading && !load.data ? (
        <Loading />
      ) : worlds.length ? (
        <WorldCards worlds={worlds} />
      ) : (
        !load.error && (
          <Empty
            title="Нет доступных миров в категории"
            text="Удалённые или недоступные миры не отображаются."
          />
        )
      )}
    </>
  );
}

function FavoritesTab({ user }: { user: User }) {
  const ctx = useApp(),
    [selected, setSelected] = useState('');
  const own = user.id === ctx.user.id;
  const viewerIsFriend = profileFriendAccess(user);
  const load = useLoad<ProfileFavoriteGroup[]>(
    () =>
      ctx.demo
        ? Promise.resolve([
            {
              id: 'demo',
              name: 'worlds1',
              displayName: 'Избранное',
              visibility: 'public',
              type: 'world',
            },
          ])
        : profileData.favoriteGroups(user.id, own, viewerIsFriend),
    [user.id, own, viewerIsFriend, ctx.demo],
  );
  const groups = (load.data || []).filter(
      (group) =>
        own || group.visibility === 'public' || (viewerIsFriend && group.visibility === 'friends'),
    ),
    group = groups.find((item) => `${item.type}:${item.name}` === selected) || groups[0];
  return (
    <div className="form-stack">
      <p className="muted small">
        {own
          ? 'Доступные категории вашего аккаунта.'
          : viewerIsFriend
            ? 'Публичные категории и коллекции для подтверждённых друзей. Приватные коллекции не запрашиваются.'
            : 'Только публичные категории, опубликованные пользователем. Приватные коллекции не запрашиваются.'}
      </p>
      {load.error && <ErrorState error={load.error} retry={load.reload} />}
      {load.loading && !load.data ? (
        <Loading />
      ) : groups.length ? (
        <>
          <label className="field">
            Категория
            <select
              value={`${group.type}:${group.name}`}
              onChange={(event) => setSelected(event.target.value)}
            >
              {groups.map((item) => (
                <option key={`${item.type}:${item.name}`} value={`${item.type}:${item.name}`}>
                  {item.displayName}
                  {item.numFavorites !== undefined ? ` (${item.numFavorites})` : ''}
                </option>
              ))}
            </select>
          </label>
          <FavoriteWorldContents
            key={`${group.type}:${group.name}`}
            user={user}
            group={group}
            viewerIsFriend={viewerIsFriend}
          />
        </>
      ) : (
        !load.error && <Empty title="Нет доступных категорий избранного" />
      )}
    </div>
  );
}

function AvatarsTab({ user }: { user: User }) {
  const ctx = useApp(),
    own = user.id === ctx.user.id;
  const [allowed, setAllowed] = useState(own),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState<Avatar>();
  const load = usePaged<Avatar>(
    (offset) =>
      !allowed
        ? Promise.resolve([])
        : ctx.demo
          ? Promise.resolve(
              offset
                ? []
                : demoAvatars.filter((avatar) => !avatar.authorId || avatar.authorId === user.id),
            )
          : own
            ? profileData.ownAvatars(offset)
            : api.searchPublicAvatars(user.id, Math.floor(offset / 50)),
    [user.id, ctx.demo, allowed, own],
    50,
  );
  const avatars = load.items.filter(
    (avatar) =>
      (own || ctx.demo || avatar.authorId === user.id) &&
      `${avatar.name} ${avatar.authorName || ''}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="form-stack">
      {!own && (
        <div className="inset-panel">
          <p className="muted small">
            VRChat API не предоставляет поиск всех аватаров другого автора. Можно найти его
            публичные работы в avtrdb.com; ID пользователя будет передан оператору этой базы.
            Результат может быть неполным.
          </p>
          {!allowed && (
            <button className="button secondary" onClick={() => setAllowed(true)}>
              <Search size={15} />
              Найти в avtrdb.com
            </button>
          )}
        </div>
      )}
      {allowed && (
        <>
          <SearchField value={search} onChange={setSearch} placeholder="Поиск по аватарам автора" />
          {load.error && <ErrorState error={load.error} retry={load.reload} />}
          {load.loading && !load.items.length ? (
            <Loading />
          ) : (
            <>
              {avatars.length ? (
                <div className="user-content-grid">
                  {avatars.map((avatar) => (
                    <button
                      className="user-content-card"
                      key={avatar.id}
                      onClick={() => setSelected(avatar)}
                    >
                      <SecureImage src={imageOf(avatar)} alt="" />
                      <div>
                        <strong>{avatar.name}</strong>
                        <small>{avatar.authorName || 'Автор не передан'}</small>
                        {avatar.releaseStatus && <Badge>{avatar.releaseStatus}</Badge>}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty title="Доступные аватары не найдены" />
              )}
              <LoadMore loading={load.moreLoading} hasMore={load.hasMore} onClick={load.loadMore} />
            </>
          )}
        </>
      )}
      {selected && <AvatarDetail initial={selected} onClose={() => setSelected(undefined)} />}
    </div>
  );
}

function ActivityTab({ user }: { user: User }) {
  const ctx = useApp(),
    [search, setSearch] = useState('');
  const events = ctx.history.events.filter(
    (event) =>
      event.userId === user.id &&
      `${event.kind} ${event.detail} ${event.before || ''} ${event.after || ''}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="form-stack">
      <p className="muted small">
        Только события, действительно наблюдавшиеся и сохранённые этим приложением. Пропущенная
        история не восстанавливается.
      </p>
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder="Поиск в активности пользователя"
      />
      {ctx.history.error && (
        <p className="error-inline" role="alert">
          {ctx.history.error}
        </p>
      )}
      {ctx.history.loading ? (
        <Loading />
      ) : !events.length ? (
        <Empty title="Сохранённых событий пока нет" />
      ) : (
        <HistoryRows key={search} events={events} />
      )}
    </div>
  );
}

function JsonNode({ label, value, depth = 0 }: { label?: string; value: unknown; depth?: number }) {
  const object = value !== null && typeof value === 'object';
  if (object) {
    const entries = Object.entries(value),
      array = Array.isArray(value);
    return (
      <details className="json-node" open={depth < 1}>
        <summary>
          {label && <span className="json-key">{JSON.stringify(label)}: </span>}
          <span className="json-punctuation">
            {array ? '[' : '{'} {entries.length} {array ? ']' : '}'}
          </span>
        </summary>
        <div className="json-children">
          {entries.map(([key, item]) => (
            <JsonNode key={key} label={key} value={item} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }
  return (
    <div className="json-leaf">
      {label && <span className="json-key">{JSON.stringify(label)}: </span>}
      <span className={`json-${value === null ? 'null' : typeof value}`}>
        {JSON.stringify(value)}
      </span>
    </div>
  );
}

function JsonTab({ user, profile }: { user: User; profile?: JsonRecord }) {
  const ctx = useApp(),
    [busy, setBusy] = useState(false),
    data = safeProfileJson(user, profile),
    json = JSON.stringify(data, null, 2);
  const perform = async (exporting: boolean) => {
    setBusy(true);
    try {
      if (!exporting) {
        await copyText(json);
        ctx.notify('JSON скопирован');
      } else if (isNative) {
        const result = await native.exportJson({ fileName: `VRCNext-${user.id}.json`, json });
        if (result.saved) ctx.notify('JSON сохранён');
      } else {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })),
          anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `VRCNext-${user.id}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      ctx.notify(
        'Не удалось ' + (exporting ? 'сохранить' : 'скопировать') + ' JSON. Повторите попытку.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="form-stack">
      <p className="muted small">
        Реальные полученные данные пользователя и публичного профиля. Поля авторизации и секреты
        исключены из просмотра, копирования и экспорта.
      </p>
      <div className="detail-actions">
        <button
          className="button secondary compact"
          disabled={busy}
          onClick={() => void perform(false)}
        >
          <Copy size={15} />
          Копировать JSON
        </button>
        <button
          className="button secondary compact"
          disabled={busy}
          onClick={() => void perform(true)}
        >
          <Download size={15} />
          Экспорт JSON
        </button>
      </div>
      <div className="profile-json" aria-label="JSON пользователя">
        <JsonNode value={data} />
      </div>
    </div>
  );
}

/** Visited panels stay mounted, preserving searches and loaded pages when switching tabs. */
export function UserProfileTabs({
  tab,
  user,
  profile,
}: {
  tab: string;
  user: User;
  profile?: JsonRecord;
}) {
  const [visited, setVisited] = useState<string[]>(() => (tab === 'profile' ? [] : [tab]));
  useEffect(() => {
    if (tab !== 'profile')
      setVisited((current) => (current.includes(tab) ? current : [...current, tab]));
  }, [tab]);
  const content: Record<string, () => ReactNode> = {
    mutual: () => <MutualTab user={user} />,
    groups: () => <GroupsTab user={user} />,
    worlds: () => <WorldsTab user={user} />,
    favorites: () => <FavoritesTab user={user} />,
    avatars: () => <AvatarsTab user={user} />,
    activity: () => <ActivityTab user={user} />,
    json: () => <JsonTab user={user} profile={profile} />,
  };
  return (
    <>
      {visited.map((name) => (
        <section className="user-profile-panel" hidden={tab !== name} key={name}>
          {content[name]?.()}
        </section>
      ))}
    </>
  );
}
