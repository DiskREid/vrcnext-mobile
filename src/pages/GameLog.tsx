import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Clock3, Globe2, Image, RefreshCw, Users, Video } from 'lucide-react';
import { api } from '../api';
import type { World } from '../api';
import { intervalMs } from '../data/game-history';
import type { GameParticipant, GameSession, GameVisit } from '../data/game-history';
import { instanceType } from '../data/locations';
import { useApp } from '../state';
import SecureImage from '../components/SecureImage';
import {
  Badge,
  Empty,
  ErrorState,
  imageOf,
  Loading,
  PageHeader,
  SearchField,
  Segmented,
} from '../components/ui';
import './GameLog.css';

function duration(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (ms === 0) return '0 мин';
  if (minutes < 1) return 'менее 1 мин';
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} ч ` : ''}${minutes % 60} мин`;
}
function dateTime(time: string) {
  return Number.isFinite(Date.parse(time))
    ? new Date(time).toLocaleString('ru', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Время неизвестно';
}
function matchesDay(start: string, last: string, day: string) {
  if (!day) return true;
  const midnight = new Date(`${day}T00:00:00`);
  const next = new Date(midnight);
  next.setDate(next.getDate() + 1);
  return Date.parse(start) < next.getTime() && Date.parse(last) >= midnight.getTime();
}
const reasons: Record<GameVisit['reason'], string> = {
  'location-change': 'Обнаружена смена местоположения',
  offline: 'Обнаружен выход из игры',
  'observation-gap': 'Наблюдение прервано',
};

type WorldCacheEntry = {
  time: number;
  promise: Promise<World>;
  watchers: (() => boolean)[];
  started: boolean;
};
const worldCache = new Map<string, WorldCacheEntry>();
let metadataQueue: Promise<unknown> = Promise.resolve();
function worldMetadata(
  account: string,
  id: string,
  force: boolean,
  isLive: () => boolean,
): Promise<World | undefined> {
  const key = `${account}:${id}`;
  const hit = worldCache.get(key);
  if (!force && hit && Date.now() - hit.time < 30 * 60_000) {
    if (!hit.started) hit.watchers = [...hit.watchers.filter((watcher) => watcher()), isLive];
    return hit.promise;
  }
  const watchers = [isLive];
  const promise: Promise<World | undefined> = metadataQueue
    .catch(() => undefined)
    .then(async () => {
      if (!entry.watchers.some((watcher) => watcher())) return undefined;
      entry.started = true;
      entry.watchers = [];
      return api.world(id);
    });
  metadataQueue = promise;
  // Do not retain an aborted, not-yet-started request as an empty successful world.
  const resolved: Promise<World> = promise.then((world) => {
    if (!world) {
      if (worldCache.get(key)?.promise === resolved) worldCache.delete(key);
      return Promise.reject(new Error('Загрузка отменена'));
    }
    return world;
  });
  const entry: WorldCacheEntry = { time: Date.now(), promise: resolved, watchers, started: false };
  worldCache.set(key, entry);
  if (worldCache.size > 80) worldCache.delete(worldCache.keys().next().value!);
  resolved.catch(() => {
    if (worldCache.get(key) === entry) worldCache.delete(key);
  });
  return resolved;
}

function WorldHeader({ visit }: { visit: GameVisit }) {
  const ctx = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [world, setWorld] = useState<World>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
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
      { rootMargin: '100px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || ctx.demo || ctx.pageActive === false) return;
    let live = true;
    setBusy(true);
    setError('');
    worldMetadata(ctx.user.id, visit.worldId, retry > 0, () => live)
      .then((value) => {
        if (live) setWorld(value);
      })
      .catch((error) => {
        if (live) setError(error instanceof Error ? error.message : 'Не удалось загрузить мир.');
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [visible, ctx.user.id, ctx.demo, visit.worldId, retry, ctx.pageActive]);
  return (
    <div ref={ref} className="game-world-header">
      <button className="game-world-button" onClick={() => ctx.openWorld(world || visit.worldId)}>
        <span className="game-world-image">
          {world && <SecureImage src={imageOf(world)} alt="" />}
          <Globe2 size={24} />
        </span>
        <span>
          <strong>{world?.name || visit.worldId}</strong>
          <small>
            {world?.authorName
              ? `by ${world.authorName}`
              : busy
                ? 'Загружаем название мира…'
                : visit.worldId}
          </small>
        </span>
        <ArrowUpRight size={18} />
      </button>
      {error && (
        <div className="game-world-error" role="alert">
          <span>{error}</span>
          <button className="text-button" onClick={() => setRetry((v) => v + 1)}>
            <RefreshCw size={13} />
            Повторить загрузку мира
          </button>
        </div>
      )}
    </div>
  );
}

function CompanionList({ participants }: { participants: GameParticipant[] }) {
  const ctx = useApp();
  const users = new Map<
    string,
    { name: string; total: number; first: string; last: string; intervals: number }
  >();
  for (const participant of participants) {
    const current = users.get(participant.userId);
    const ms = intervalMs(participant);
    if (current) {
      current.total += ms;
      current.intervals++;
      if (participant.lastObserved > current.last) current.last = participant.lastObserved;
    } else
      users.set(participant.userId, {
        name: participant.displayName,
        total: ms,
        first: participant.start,
        last: participant.lastObserved,
        intervals: 1,
      });
  }
  return users.size ? (
    <details className="game-companions">
      <summary>
        <Users size={14} />
        {users.size} {users.size === 1 ? 'друг в инстансе' : 'друзей в инстансе'}
      </summary>
      <div>
        {[...users].map(([id, user]) => (
          <button className="game-companion" key={id} onClick={() => ctx.openUser(id)}>
            <span>
              <strong>{user.name}</strong>
              <small>
                {user.intervals > 1 ? `${user.intervals} интервала · ` : ''}
                {dateTime(user.first)} — {dateTime(user.last)}
              </small>
            </span>
            <Badge>{duration(user.total)}</Badge>
          </button>
        ))}
      </div>
    </details>
  ) : (
    <p className="muted small game-no-companions">Совместное присутствие друзей не наблюдалось.</p>
  );
}

function VisitCard({ visit }: { visit: GameVisit }) {
  const ms = intervalMs(visit);
  return (
    <article className="card game-visit-card">
      <WorldHeader visit={visit} />
      <div className="game-visit-meta">
        <Badge>{instanceType(visit.location)}</Badge>
        <span>
          <Clock3 size={14} />
          {duration(ms)} наблюдений
        </span>
        {!visit.end && <Badge>Продолжается наблюдение</Badge>}
      </div>
      <p className="muted small game-location-id">{visit.location}</p>
      <dl className="game-interval">
        <div>
          <dt>Первое наблюдение</dt>
          <dd>
            <time dateTime={visit.start}>{dateTime(visit.start)}</time>
          </dd>
        </div>
        <div>
          <dt>{visit.end ? 'Конец интервала' : 'Последнее подтверждение'}</dt>
          <dd>
            <time dateTime={visit.end || visit.lastObserved}>
              {dateTime(visit.end || visit.lastObserved)}
            </time>
          </dd>
        </div>
      </dl>
      {visit.end && <p className="muted small">{reasons[visit.reason]}</p>}
      <CompanionList participants={visit.participants} />
    </article>
  );
}

function SessionCard({ session, visits }: { session: GameSession; visits: GameVisit[] }) {
  const [limit, setLimit] = useState(10);
  const friends = new Set(
    visits.flatMap((visit) => visit.participants.map((participant) => participant.userId)),
  );
  return (
    <details className="card game-session-card">
      <summary>
        <span className="game-session-title">
          <Clock3 size={19} />
          <strong>{dateTime(session.start)}</strong>
        </span>
        <span className="game-session-meta">
          {duration(intervalMs(session))} наблюдений · {visits.length} посещений · {friends.size}{' '}
          друзей
          {!session.end ? ' · наблюдение продолжается' : ''}
        </span>
      </summary>
      <div className="game-session-body">
        <dl className="game-interval">
          <div>
            <dt>Начало наблюдения сессии</dt>
            <dd>{dateTime(session.start)}</dd>
          </div>
          <div>
            <dt>{session.end ? 'Конец наблюдения сессии' : 'Последнее подтверждение'}</dt>
            <dd>{dateTime(session.end || session.lastObserved)}</dd>
          </div>
        </dl>
        {visits.length ? (
          visits.slice(0, limit).map((visit) => <VisitCard key={visit.id} visit={visit} />)
        ) : (
          <p className="muted small">
            Во время этой сессии точное местоположение не было доступно.
          </p>
        )}
        {visits.length > limit && (
          <button className="button secondary compact" onClick={() => setLimit((n) => n + 10)}>
            Показать ещё посещения
          </button>
        )}
      </div>
    </details>
  );
}

export default function GameLogPage() {
  const ctx = useApp();
  const [tab, setTab] = useState('visits');
  const [query, setQuery] = useState('');
  const [day, setDay] = useState('');
  const [limit, setLimit] = useState(20);
  const search = query.trim().toLocaleLowerCase();
  const visits = useMemo(
    () =>
      ctx.history.visits
        .filter(
          (visit) =>
            matchesDay(visit.start, visit.lastObserved, day) &&
            (!search ||
              `${visit.worldId} ${visit.location} ${visit.participants.map((p) => p.displayName).join(' ')}`
                .toLocaleLowerCase()
                .includes(search)),
        )
        .sort((a, b) => b.start.localeCompare(a.start)),
    [ctx.history.visits, day, search],
  );
  const sessions = useMemo(
    () =>
      ctx.history.sessions
        .filter(
          (session) =>
            matchesDay(session.start, session.lastObserved, day) &&
            (!search || visits.some((visit) => visit.sessionId === session.id)),
        )
        .sort((a, b) => b.start.localeCompare(a.start)),
    [ctx.history.sessions, visits, day, search],
  );
  const avatars = ctx.history.events.filter(
    (event) =>
      event.kind === 'avatar' &&
      event.userId === ctx.user.id &&
      matchesDay(event.time, event.time, day) &&
      (!search ||
        `${event.before || ''} ${event.after || ''}`.toLocaleLowerCase().includes(search)),
  );
  useEffect(() => setLimit(20), [tab, query, day]);
  const totalMs = visits.reduce((total, visit) => total + intervalMs(visit), 0);
  return (
    <>
      <PageHeader
        eyebrow="ВАШИ НАБЛЮДЕНИЯ"
        title="Журнал игры"
        subtitle="История доступных игровых сессий, миров и встреч"
        actions={
          <button
            className="button secondary compact"
            aria-label="Синхронизировать журнал"
            disabled={ctx.observation.status === 'syncing' || ctx.observation.status === 'demo'}
            onClick={ctx.observation.refresh}
          >
            <RefreshCw
              size={16}
              className={ctx.observation.status === 'syncing' ? 'spin' : undefined}
            />
            Синхронизировать
          </button>
        }
      />
      <p className="game-observation-state muted small" role="status">
        {{
          paused: 'Наблюдение приостановлено',
          syncing: 'Получаем состояние аккаунта…',
          observing: 'Наблюдение активно',
          error: 'Синхронизация не завершена',
          demo: 'Деморежим: игровая статистика не создаётся',
        }[ctx.observation.status] || 'Наблюдение приостановлено'}
        {ctx.observation.lastSync
          ? ` · Последняя синхронизация: ${dateTime(ctx.observation.lastSync)}`
          : ''}
      </p>
      {ctx.observation.error && (
        <ErrorState error={ctx.observation.error} retry={ctx.observation.refresh} />
      )}
      <div className="game-history-note">
        <Clock3 size={17} />
        <p>
          Время и встречи оцениваются по наблюдениям API, пока приложение активно. Промежутки без
          наблюдений не заполняются. Точное время входа и выхода может отличаться.
        </p>
      </div>
      <Segmented
        value={tab}
        onChange={setTab}
        items={[
          { id: 'visits', label: 'Посещения' },
          { id: 'sessions', label: 'Сессии' },
          { id: 'avatars', label: 'Аватары' },
          { id: 'video', label: 'Видео' },
        ]}
      />
      {tab !== 'video' && (
        <div className="game-log-filters">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={
              tab === 'avatars' ? 'Поиск по ID аватара' : 'ID мира, инстанс или имя друга'
            }
          />
          <label className="field">
            Дата журнала
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          {day && (
            <button className="text-button" onClick={() => setDay('')}>
              Все даты
            </button>
          )}
        </div>
      )}
      {ctx.history.error && <ErrorState error={ctx.history.error} retry={ctx.history.retry} />}
      {ctx.history.loading ? (
        <Loading />
      ) : tab === 'video' ? (
        <Empty
          icon={<Video size={30} />}
          title="Источник видео недоступен"
          text="VRChat API не сообщает, какие видео воспроизводятся в инстансе. Android-приложение не имеет доступа к игровым логам ПК; события видео не создаются."
        />
      ) : tab === 'visits' ? (
        visits.length ? (
          <>
            <div className="game-log-totals">
              <span>
                <Globe2 size={16} />
                {visits.length} посещений
              </span>
              <span>
                <Clock3 size={16} />
                {duration(totalMs)} в доступных инстансах
              </span>
            </div>
            <div className="game-log-visits">
              {visits.slice(0, limit).map((visit) => (
                <VisitCard visit={visit} key={visit.id} />
              ))}
            </div>
            {visits.length > limit && (
              <button
                className="button secondary load-more"
                onClick={() => setLimit((n) => n + 20)}
              >
                Показать ещё посещения
              </button>
            )}
          </>
        ) : (
          <Empty
            icon={<Globe2 size={30} />}
            title="Посещения ещё не наблюдались"
            text={
              query || day
                ? 'За выбранный период или по этому запросу наблюдений нет.'
                : 'Откройте VRChat под своим аккаунтом и оставьте VRCNext Mobile активным. Доступные через API местоположения будут сохранены здесь.'
            }
          />
        )
      ) : tab === 'sessions' ? (
        sessions.length ? (
          <>
            <div className="game-log-sessions">
              {sessions.slice(0, limit).map((session) => (
                <SessionCard
                  session={session}
                  visits={visits.filter((visit) => visit.sessionId === session.id)}
                  key={session.id}
                />
              ))}
            </div>
            {sessions.length > limit && (
              <button
                className="button secondary load-more"
                onClick={() => setLimit((n) => n + 20)}
              >
                Показать ещё сессии
              </button>
            )}
          </>
        ) : (
          <Empty
            icon={<Clock3 size={30} />}
            title="Игровых сессий пока нет"
            text="Сессии сохраняются только после реального наблюдения состояния аккаунта. Время вне наблюдения неизвестно."
          />
        )
      ) : avatars.length ? (
        <div className="game-avatar-events">
          {avatars.slice(0, limit).map((event) => (
            <article className="card game-avatar-event" key={event.id}>
              <Image size={20} />
              <div>
                <h3>Смена аватара</h3>
                <p className="muted small">
                  {event.before} → {event.after}
                </p>
                <time dateTime={event.time}>{dateTime(event.time)}</time>
              </div>
            </article>
          ))}
          {avatars.length > limit && (
            <button className="button secondary load-more" onClick={() => setLimit((n) => n + 20)}>
              Показать ещё
            </button>
          )}
        </div>
      ) : (
        <Empty
          icon={<Image size={30} />}
          title="Смены аватара не наблюдались"
          text="Изменение фиксируется, только когда API сообщает разные ID вашего текущего аватара. Смена изображения сама по себе не считается сменой аватара."
        />
      )}
    </>
  );
}
