import { uiMessage } from '../i18n';
import { t, useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Globe2, MapPin, RefreshCw, Send, Users } from 'lucide-react';
import { api } from '../api';
import type { World } from '../api';
import { demoWorlds } from '../demo';
import { groupFriendLocations, instanceType } from '../data/locations';
import type { FriendLocation } from '../data/locations';
import { useApp } from '../state';
import SecureImage from '../components/SecureImage';
import {
  AvatarImage,
  Badge,
  Empty,
  ErrorState,
  imageOf,
  Loading,
  PageHeader,
  SearchField,
  Segmented,
} from '../components/ui';
import './Social.css';

const worlds = new Map<string, { data: World; expires: number }>();
let worldQueue: Promise<unknown> = Promise.resolve();
function loadWorld(account: string, worldId: string, force: boolean, live: () => boolean) {
  const key = `${account}:${worldId}`;
  const cached = worlds.get(key);
  if (!force && cached && cached.expires > Date.now()) return Promise.resolve(cached.data);
  const next = worldQueue
    .catch(() => undefined)
    .then(async () => {
      if (!live()) return undefined;
      const cached = worlds.get(key);
      if (!force && cached && cached.expires > Date.now()) return cached.data;
      const result = await api.world(worldId);
      worlds.set(key, { data: result, expires: Date.now() + 5 * 60_000 });
      if (worlds.size > 64) worlds.delete(worlds.keys().next().value!);
      return result;
    });
  worldQueue = next;
  return next;
}

function LocationCard({ group }: { group: FriendLocation }) {
  const ctx = useApp();
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [world, setWorld] = useState<World>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const lastRefresh = useRef(ctx.refresh);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!group.worldId || !visible || ctx.pageActive === false) return;
    let live = true;
    const force = lastRefresh.current !== ctx.refresh || retry > 0;
    lastRefresh.current = ctx.refresh;
    setBusy(true);
    setError('');
    const request = ctx.demo
      ? Promise.resolve(demoWorlds.find((w) => w.id === group.worldId))
      : loadWorld(ctx.user.id, group.worldId, force, () => live);
    request
      .then((data) => {
        if (live) setWorld(data);
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [group.worldId, ctx.user.id, ctx.demo, ctx.refresh, retry, visible, ctx.pageActive]);
  return (
    <article ref={ref} className="card location-card">
      <button
        className="location-world"
        disabled={!group.worldId}
        onClick={() => group.worldId && ctx.openWorld(world || group.worldId)}
      >
        <div className="location-cover">
          {world && <SecureImage src={imageOf(world)} alt="" />}
          <Globe2 size={25} />
        </div>
        <div>
          <h2>
            {world?.name ||
              (group.private
                ? t('Местоположение скрыто')
                : busy
                  ? t('Загружаем мир…')
                  : t('Мир друга'))}
          </h2>
          <span className="muted small">
            {group.worldId || t('Доступен только запрос приглашения')}
          </span>
        </div>
        {group.worldId && <ArrowUpRight size={18} />}
      </button>
      <div className="location-meta">
        <Badge>{instanceType(group.location)}</Badge>
        <span>
          <Users size={14} />
          {group.friends.length} {group.friends.length === 1 ? t('друг') : t('друзей')}
        </span>
      </div>
      {group.location && (
        <p className="location-id muted small">
          {group.location.slice(group.location.indexOf(':') + 1)}
        </p>
      )}
      {error && (
        <div className="location-error" role="alert">
          <span>{error}</span>
          <button className="text-button" onClick={() => setRetry((v) => v + 1)}>
            {t('Повторить загрузку мира')}
          </button>
        </div>
      )}
      <div className="location-friends">
        {group.friends.map((friend) => (
          <div className="location-friend" key={friend.id}>
            <button onClick={() => ctx.openUser(friend)}>
              <AvatarImage
                src={imageOf(friend)}
                name={friend.displayName}
                user={friend}
                fallbackSrc={friend.currentAvatarThumbnailImageUrl || friend.currentAvatarImageUrl}
                size={38}
              />
              <span>{friend.displayName}</span>
            </button>
            <button
              className="icon-button"
              aria-label={t('Запросить приглашение у {value0}', {
                value0: String(friend.displayName),
              })}
              title={t('Запросить приглашение')}
              onClick={() =>
                void ctx.act(() => api.requestInvite(friend.id), uiMessage('Запрос приглашения отправлен'))
              }
            >
              <Send size={17} />
            </button>
          </div>
        ))}
      </div>
      {group.location && (
        <button
          className="button secondary compact"
          onClick={() =>
            void ctx.act(
              () => api.inviteSelf(group.location!),
              uiMessage('Приглашение отправлено вашему клиенту VRChat'),
            )
          }
        >
          <MapPin size={16} />
          {t('Присоединиться')}
        </button>
      )}
    </article>
  );
}

export default function LocationsPage() {
  useI18n();
  const ctx = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const order = useRef<string[]>([]);
  const grouped = groupFriendLocations(ctx.friends.data);
  const map = new Map(grouped.map((g) => [g.key, g]));
  order.current = [
    ...order.current.filter((key) => map.has(key)),
    ...grouped.filter((g) => !order.current.includes(g.key)).map((g) => g.key),
  ];
  const groups = order.current
    .map((key) => map.get(key)!)
    .filter(
      (g) =>
        (filter === 'all' || (filter === 'visible' ? !g.private : g.private)) &&
        (!query ||
          `${g.worldId || ''} ${g.location || ''} ${g.friends.map((f) => f.displayName).join(' ')}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    );
  return (
    <>
      <PageHeader
        eyebrow={t('ДРУЗЬЯ НА КАРТЕ')}
        title="Friends Locations"
        subtitle={t('Только доступные местоположения и точные совпадения инстансов')}
        actions={
          <button
            className="icon-button"
            aria-label={t('Обновить местоположения')}
            onClick={ctx.friends.reload}
          >
            <RefreshCw size={19} className={ctx.friends.refreshing ? 'spin' : ''} />
          </button>
        }
      />
      <SearchField value={query} onChange={setQuery} placeholder={t('Имя друга или ID мира')} />
      <Segmented
        value={filter}
        onChange={setFilter}
        items={[
          { id: 'all', label: t('Все') },
          { id: 'visible', label: t('Доступные инстансы') },
          { id: 'private', label: t('Скрытые') },
        ]}
      />
      <p className="muted small">
        {t(
          '«Присоединиться» отправляет приглашение вашему официальному клиенту VRChat. Закрытый инстанс может потребовать приглашение хозяина.',
        )}
      </p>
      {ctx.friends.error && <ErrorState error={ctx.friends.error} retry={ctx.friends.reload} />}
      {ctx.friends.loading ? (
        <Loading />
      ) : groups.length ? (
        <div className="location-grid">
          {groups.map((group) => (
            <LocationCard key={group.key} group={group} />
          ))}
        </div>
      ) : (
        <Empty
          title={t('Доступных местоположений нет')}
          text={
            query
              ? t('Попробуйте другой запрос.')
              : t('Здесь появятся друзья в VRChat, когда API предоставит их местоположение.')
          }
        />
      )}
    </>
  );
}
