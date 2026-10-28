import { t, dateLocale, useI18n } from '../i18n';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  Globe2,
  MapPin,
  RefreshCw,
  Users,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { api } from '../api';
import type { World } from '../api';
import type { GameVisit } from '../data/game-history';
import { analytics, colorFor, dayBounds, localDayKey, timelineVisits } from '../data/chart-data';
import type { TimelineVisit } from '../data/chart-data';
import { instanceType } from '../data/locations';
import { FriendNetwork } from '../components/FriendNetwork';
import {
  Badge,
  Empty,
  ErrorState,
  Modal,
  PageHeader,
  SearchField,
  Segmented,
} from '../components/ui';
import { useApp } from '../state';
import './Charts.css';

export function chartDuration(ms: number) {
  if (ms <= 0) return t('0 мин');
  if (ms < 60_000) return t('менее 1 мин');
  const minutes = Math.floor(ms / 60_000);
  return minutes >= 60
    ? t('{hours} ч {minutes} мин', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
    : t('{minutes} мин', { minutes });
}
function clock(time: string | number) {
  return new Date(time).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
}
function dateTime(time: string | number) {
  return new Date(time).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}
function moveDay(day: string, delta: number) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + delta);
  return localDayKey(date);
}

type WorldRequest = {
  time: number;
  promise: Promise<World>;
  live: (() => boolean)[];
  started: boolean;
};
const worldLabels = new Map<string, WorldRequest>();
let worldQueue: Promise<unknown> = Promise.resolve();
function loadWorld(account: string, id: string, live: () => boolean, force = false) {
  const key = `${account}:${id}`;
  const cached = worldLabels.get(key);
  if (!force && cached && Date.now() - cached.time < 30 * 60_000) {
    if (!cached.started) cached.live.push(live);
    return cached.promise;
  }
  const entry = { time: Date.now(), live: [live], started: false } as WorldRequest;
  entry.promise = worldQueue
    .catch(() => undefined)
    .then(async () => {
      if (!entry.live.some((watcher) => watcher())) throw new Error(t('Загрузка отменена'));
      entry.started = true;
      entry.live = [];
      return api.world(id);
    });
  worldQueue = entry.promise;
  worldLabels.set(key, entry);
  if (worldLabels.size > 80) worldLabels.delete(worldLabels.keys().next().value!);
  entry.promise.catch(() => {
    if (worldLabels.get(key) === entry) worldLabels.delete(key);
  });
  return entry.promise;
}

function useWorldName(id: string, active: boolean) {
  const ctx = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [world, setWorld] = useState<World>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
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
  }, [active]);
  useEffect(() => {
    if (!active || !visible || ctx.demo || ctx.pageActive === false) return;
    let live = true;
    setLoading(true);
    setError('');
    loadWorld(ctx.user.id, id, () => live, revision > 0)
      .then((data) => {
        if (live) setWorld(data);
      })
      .catch((failure) => {
        if (live)
          setError(
            failure instanceof Error ? failure.message : t('Не удалось загрузить название мира'),
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [ctx.user.id, ctx.demo, active, visible, id, revision, ctx.pageActive]);
  return {
    ref,
    name: world?.id === id ? world.name : id,
    loading,
    error,
    retry: () => setRevision((v) => v + 1),
  };
}

function DateControls({ day, onChange }: { day: string; onChange: (day: string) => void }) {
  return (
    <div className="chart-date-controls">
      <button
        className="icon-button"
        aria-label={t('Предыдущий день диаграммы')}
        onClick={() => onChange(moveDay(day, -1))}
      >
        <ArrowLeft size={18} />
      </button>
      <label className="field">
        {t('Дата диаграммы')}
        <input
          aria-label={t('Дата диаграммы')}
          type="date"
          value={day}
          onChange={(e) => {
            if (dayBounds(e.target.value)) onChange(e.target.value);
          }}
        />
      </label>
      <button
        className="icon-button"
        aria-label={t('Следующий день диаграммы')}
        onClick={() => onChange(moveDay(day, 1))}
      >
        <ArrowRight size={18} />
      </button>
      <button className="button secondary compact" onClick={() => onChange(localDayKey())}>
        {t('Сегодня')}
      </button>
    </div>
  );
}

/** A two-finger zoom and one-finger pan never change the source time intervals. */
function useTimelineTouch(
  ref: RefObject<HTMLDivElement | null>,
  zoom: number,
  setZoom: (zoom: number) => void,
) {
  const points = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | {
        distance?: number;
        zoom: number;
        x: number;
        y: number;
        scroll: number;
        pageScroll: number;
        axis?: 'x' | 'y';
      }
    | undefined
  >(undefined);
  const moved = useRef(false);
  const anchor = useRef<{ fraction: number; x: number } | undefined>(undefined);
  const changeZoom = (next: number, x?: number) => {
    const element = ref.current;
    if (element) {
      const middle = x ?? element.clientWidth / 2;
      anchor.current = { fraction: (element.scrollLeft + middle) / element.scrollWidth, x: middle };
    }
    setZoom(Math.max(1, Math.min(12, next)));
  };
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && anchor.current) {
      element.scrollLeft = anchor.current.fraction * element.scrollWidth - anchor.current.x;
      anchor.current = undefined;
    }
  }, [zoom, ref]);
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') {
      moved.current = false;
      return;
    }
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const values = [...points.current.values()];
    moved.current = false;
    const page =
      event.currentTarget.closest<HTMLElement>('.main-content') || document.scrollingElement;
    gesture.current = {
      zoom,
      x: event.clientX,
      y: event.clientY,
      scroll: event.currentTarget.scrollLeft,
      pageScroll: page?.scrollTop || 0,
    };
    if (values.length === 2) {
      gesture.current.distance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
      for (const id of points.current.keys()) event.currentTarget.setPointerCapture(id);
    }
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!points.current.has(event.pointerId) || !gesture.current) return;
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const values = [...points.current.values()];
    if (values.length === 2 && gesture.current.distance) {
      const distance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
      moved.current = true;
      const x = (values[0].x + values[1].x) / 2 - event.currentTarget.getBoundingClientRect().left;
      changeZoom((gesture.current.zoom * distance) / gesture.current.distance, x);
    } else if (values.length === 1) {
      const dx = event.clientX - gesture.current.x,
        dy = event.clientY - gesture.current.y;
      if (!gesture.current.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 6)
        gesture.current.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (gesture.current.axis) {
        moved.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        if (gesture.current.axis === 'x')
          event.currentTarget.scrollLeft = gesture.current.scroll - dx;
        else {
          const page =
            event.currentTarget.closest<HTMLElement>('.main-content') || document.scrollingElement;
          if (page) page.scrollTo({ top: gesture.current.pageScroll - dy, behavior: 'instant' });
        }
      }
    }
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    points.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    const remaining = [...points.current.values()];
    const page =
      event.currentTarget.closest<HTMLElement>('.main-content') || document.scrollingElement;
    gesture.current = remaining.length
      ? {
          zoom,
          x: remaining[0].x,
          y: remaining[0].y,
          scroll: event.currentTarget.scrollLeft,
          pageScroll: page?.scrollTop || 0,
        }
      : undefined;
  };
  return {
    changeZoom,
    moved,
    events: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up },
  };
}

function TimelineRow({
  row,
  day,
  active,
  onSelect,
  canOpen,
}: {
  row: TimelineVisit;
  day: string;
  active: boolean;
  onSelect: (visit: GameVisit) => void;
  canOpen: () => boolean;
}) {
  const ctx = useApp();
  const name = useWorldName(row.visit.worldId, active);
  const bounds = dayBounds(day)!;
  const x = ((row.start - bounds.start) / (bounds.end - bounds.start)) * 1000;
  const width = ((row.end - row.start) / (bounds.end - bounds.start)) * 1000;
  const color = colorFor(row.visit.worldId);
  const description = `${name.name}, ${clock(row.start)}–${clock(row.end)}, ${chartDuration(row.ms)}`;
  return (
    <div className="instance-chart-row">
      <div className="instance-chart-label" ref={name.ref}>
        <button
          className="text-button"
          onClick={() => ctx.openWorld(row.visit.worldId)}
          title={name.name}
        >
          {name.name}
        </button>
        <small>
          {instanceType(row.visit.location)} · {row.participants.length} {t('наблюдений друзей')}
        </small>
        {name.loading && <small>{t('Загрузка названия…')}</small>}
        {name.error && (
          <div className="chart-world-error" role="alert">
            <span>{name.error}</span>
            <button className="text-button" onClick={name.retry}>
              {t('Повторить')}
            </button>
          </div>
        )}
      </div>
      <button
        className="timeline-bar"
        aria-label={t('Подробности посещения {value0}', { value0: String(description) })}
        onClick={(event) => {
          if (event.detail === 0 || canOpen()) onSelect(row.visit);
        }}
      >
        <svg
          viewBox="0 0 1000 42"
          preserveAspectRatio="none"
          className="instance-chart-track"
          aria-hidden="true"
        >
          {[0, 250, 500, 750, 1000].map((tick) => (
            <line key={tick} x1={tick} x2={tick} y1={0} y2={42} className="instance-grid-line" />
          ))}
          <g>
            <title>{description}</title>
            {width > 0 && <rect x={x} y={11} width={width} height={20} rx={4} fill={color} />}
            <line
              x1={x}
              x2={x}
              y1={11}
              y2={31}
              stroke={color}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </svg>
      </button>
    </div>
  );
}

function VisitDetails({
  visit,
  day,
  onClose,
}: {
  visit: GameVisit;
  day: string;
  onClose: () => void;
}) {
  const ctx = useApp();
  const name = useWorldName(visit.worldId, true);
  const row = timelineVisits([visit], day)[0];
  return (
    <Modal title={t('Подробности посещения')} onClose={onClose}>
      <div className="form-stack" ref={name.ref}>
        <h3>{name.name}</h3>
        {name.error && <ErrorState error={name.error} retry={name.retry} />}
        <Badge>{instanceType(visit.location)}</Badge>
        <p className="muted small chart-location-id">{visit.location}</p>
        <dl className="chart-details">
          <div>
            <dt>{t('Начало наблюдения')}</dt>
            <dd>{dateTime(visit.start)}</dd>
          </div>
          <div>
            <dt>{visit.end ? t('Конец наблюдения') : t('Последнее наблюдение')}</dt>
            <dd>{dateTime(visit.end || visit.lastObserved)}</dd>
          </div>
          <div>
            <dt>{t('На выбранную дату')}</dt>
            <dd>{chartDuration(row?.ms || 0)}</dd>
          </div>
          <div>
            <dt>{t('Источник')}</dt>
            <dd>{visit.source === 'api' ? t('Снимки API') : 'WebSocket'}</dd>
          </div>
        </dl>
        <button
          className="button secondary"
          onClick={() => {
            onClose();
            ctx.openWorld(visit.worldId);
          }}
        >
          <Globe2 size={16} />
          {t('Открыть мир')}
        </button>
        <h3>{t('Наблюдаемые встречи в этот день')}</h3>
        {row?.participants.length ? (
          <div className="chart-companions">
            {row.participants.map(({ participant, start, end, ms }, index) => (
              <button
                className="chart-person"
                key={`${participant.userId}:${participant.start}:${index}`}
                onClick={() => {
                  onClose();
                  ctx.openUser(participant.userId);
                }}
              >
                <span>
                  <strong>{participant.displayName}</strong>
                  <small>
                    {clock(start)}–{clock(end)}
                  </small>
                </span>
                <span>{chartDuration(ms)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">{t('Совместные встречи не наблюдались.')}</p>
        )}
        <p className="muted small">
          {t(
            'Интервалы ограничены полученными наблюдениями. Данные обо всех участниках инстанса и точное время перехода API не гарантирует.',
          )}
        </p>
      </div>
    </Modal>
  );
}

function InstanceActivity({ day, active }: { day: string; active: boolean }) {
  const ctx = useApp();
  const [zoom, setZoom] = useState(1);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(24);
  const [selected, setSelected] = useState<GameVisit>();
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useTimelineTouch(ref, zoom, setZoom);
  const allRows = useMemo(() => timelineVisits(ctx.history.visits, day), [ctx.history.visits, day]);
  const data = useMemo(() => analytics(ctx.history.visits, day), [ctx.history.visits, day]);
  const rows = allRows.filter(({ visit }) =>
    `${visit.worldId} ${visit.location} ${visit.participants.map((p) => p.displayName).join(' ')}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const bounds = dayBounds(day)!;
  useEffect(() => {
    setLimit(24);
    setSelected(undefined);
  }, [day]);
  return (
    <>
      <div className="chart-metrics">
        <span>
          <Clock3 size={17} />
          <strong>{chartDuration(data.activeMs)}</strong> {t('наблюдаемой активности')}
        </span>
        <span>
          <Globe2 size={17} />
          <strong>{data.worldCount}</strong> {t('миров')}
        </span>
        <span>
          <MapPin size={17} />
          <strong>{data.visitCount}</strong> {t('посещений')}
        </span>
      </div>
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={t('ID мира, инстанс или имя друга')}
      />
      <div className="chart-zoom-controls">
        <button
          className="icon-button"
          aria-label={t('Уменьшить масштаб времени')}
          disabled={zoom <= 1}
          onClick={() => gesture.changeZoom(zoom / 1.5)}
        >
          <ZoomOut size={18} />
        </button>
        <label>
          {t('Масштаб времени')}
          <input
            aria-label={t('Масштаб времени')}
            type="range"
            min={1}
            max={12}
            step={0.1}
            value={zoom}
            onChange={(e) => gesture.changeZoom(Number(e.target.value))}
          />
        </label>
        <button
          className="icon-button"
          aria-label={t('Увеличить масштаб времени')}
          disabled={zoom >= 12}
          onClick={() => gesture.changeZoom(zoom * 1.5)}
        >
          <ZoomIn size={18} />
        </button>
        <button className="text-button" onClick={() => gesture.changeZoom(1)}>
          {t('Весь день')}
        </button>
      </div>
      {!rows.length ? (
        <Empty
          icon={<Clock3 size={32} />}
          title={query ? t('Посещения не найдены') : t('За этот день нет наблюдений')}
          text={
            query
              ? t('Измените поиск или дату.')
              : t(
                  'Новые посещения сохраняются, только если VRChat передаёт ваше точное местоположение, пока приложение открыто. История с ПК не импортируется.',
                )
          }
        />
      ) : (
        <>
          <p className="muted small chart-gesture-note">
            {t(
              'Масштабируйте двумя пальцами, перемещайте шкалу одним. Нажмите на цветную полосу для подробностей.',
            )}
          </p>
          <div
            ref={ref}
            role="region"
            aria-label={t('Временная диаграмма посещений')}
            className="instance-chart-scroll"
            {...gesture.events}
          >
            <div className="instance-chart-canvas" style={{ width: `${zoom * 100}%` }}>
              <div className="instance-chart-axis">
                <span>{t('Мир и инстанс')}</span>
                <div>
                  {[0, 0.25, 0.5, 0.75, 1].map((part) => (
                    <time key={part} style={{ left: `${part * 100}%` }}>
                      {clock(bounds.start + part * (bounds.end - bounds.start))}
                    </time>
                  ))}
                </div>
              </div>
              {rows.slice(0, limit).map((row) => (
                <TimelineRow
                  key={row.visit.id}
                  row={row}
                  day={day}
                  active={active}
                  onSelect={setSelected}
                  canOpen={() => !gesture.moved.current}
                />
              ))}
            </div>
          </div>
          {rows.length > limit && (
            <button
              className="button secondary load-more"
              onClick={() => setLimit((value) => value + 24)}
            >
              {t('Ещё посещения (')}
              {rows.length - limit})
            </button>
          )}
        </>
      )}
      {active && selected && (
        <VisitDetails visit={selected} day={day} onClose={() => setSelected(undefined)} />
      )}
    </>
  );
}

function AnalyticsWorld({
  id,
  visits,
  totalMs,
  max,
  active,
}: {
  id: string;
  visits: number;
  totalMs: number;
  max: number;
  active: boolean;
}) {
  const ctx = useApp();
  const name = useWorldName(id, active);
  return (
    <article className="chart-ranking-card" ref={name.ref}>
      <button className="text-button" onClick={() => ctx.openWorld(id)}>
        {name.name}
      </button>
      <span className="muted small">
        {visits} {t('посещений ·')} {chartDuration(totalMs)}
      </span>
      <div className="chart-ranking-track">
        <i style={{ width: `${max ? (totalMs / max) * 100 : 0}%`, background: colorFor(id) }} />
      </div>
      {name.error && (
        <div className="chart-world-error" role="alert">
          {name.error}
          <button className="text-button" onClick={name.retry}>
            {t('Повторить')}
          </button>
        </div>
      )}
    </article>
  );
}

function Analytics({ day, active }: { day: string; active: boolean }) {
  const ctx = useApp();
  const [period, setPeriod] = useState('day');
  const [sort, setSort] = useState('encounters');
  const [limit, setLimit] = useState(15);
  const data = useMemo(
    () => analytics(ctx.history.visits, period === 'day' ? day : undefined),
    [ctx.history.visits, period, day],
  );
  const friends = [...data.friends].sort((a, b) =>
    sort === 'time'
      ? b.totalMs - a.totalMs || b.encounters - a.encounters
      : b.encounters - a.encounters || b.totalMs - a.totalMs,
  );
  useEffect(() => setLimit(15), [day, period]);
  return (
    <>
      <Segmented
        value={period}
        onChange={setPeriod}
        items={[
          { id: 'day', label: t('Выбранный день') },
          { id: 'all', label: t('Вся история') },
        ]}
      />
      <div className="chart-metrics">
        <span>
          <Clock3 size={17} />
          <strong>{chartDuration(data.activeMs)}</strong> {t('активности')}
        </span>
        <span>
          <Globe2 size={17} />
          <strong>{data.worldCount}</strong> {t('миров')}
        </span>
        <span>
          <MapPin size={17} />
          <strong>{data.instanceCount}</strong> {t('инстансов')}
        </span>
        <span>
          <Users size={17} />
          <strong>{data.friends.length}</strong> {t('встреченных друзей')}
        </span>
      </div>
      {!data.visitCount ? (
        <Empty
          icon={<Globe2 size={32} />}
          title={t('Статистика пока не накоплена')}
          text={t(
            'Диаграммы используют сохранённые наблюдения журнала игры. Неизвестные посещения и встречи не добавляются.',
          )}
        />
      ) : (
        <div className="chart-analytics-grid">
          <section className="card chart-ranking">
            <h2>{t('Посещённые миры')}</h2>
            {data.worlds.slice(0, limit).map((world) => (
              <AnalyticsWorld
                key={world.id}
                {...world}
                max={data.worlds[0]?.totalMs || 0}
                active={active}
              />
            ))}
          </section>
          <section className="card chart-ranking">
            <h2>{t('Совместные встречи')}</h2>
            <Segmented
              value={sort}
              onChange={setSort}
              items={[
                { id: 'encounters', label: t('Частота встреч') },
                { id: 'time', label: t('Время вместе') },
              ]}
            />
            {friends.length ? (
              friends.slice(0, limit).map((friend) => (
                <button
                  className="chart-person chart-ranking-person"
                  key={friend.id}
                  onClick={() => ctx.openUser(friend.id)}
                >
                  <span>
                    <strong>{friend.displayName}</strong>
                    <small>
                      {friend.encounters} {t('встреч')}
                      {friend.lastMeeting ? ` · ${dateTime(friend.lastMeeting)}` : ''}
                    </small>
                  </span>
                  <span>{chartDuration(friend.totalMs)}</span>
                </button>
              ))
            ) : (
              <p className="muted">{t('Совместные встречи пока не наблюдались.')}</p>
            )}
          </section>
        </div>
      )}
      {Math.max(data.worlds.length, friends.length) > limit && (
        <button
          className="button secondary load-more"
          onClick={() => setLimit((value) => value + 15)}
        >
          {t('Показать ещё')}
        </button>
      )}
    </>
  );
}

export default function ChartsPage() {
  useI18n();
  const ctx = useApp();
  const [tab, setTab] = useState('instance');
  const [day, setDay] = useState(localDayKey);
  const [visited, setVisited] = useState(['instance']);
  const chooseTab = (value: string) => {
    setTab(value);
    setVisited((current) => (current.includes(value) ? current : [...current, value]));
  };
  return (
    <>
      <PageHeader
        eyebrow={t('ВАШИ НАБЛЮДЕНИЯ')}
        title={t('Диаграммы')}
        subtitle={t('Посещения, время вместе и известные социальные связи')}
      />
      <Segmented
        value={tab}
        onChange={chooseTab}
        items={[
          { id: 'instance', label: 'Instance Activity' },
          { id: 'network', label: 'Mutual Friend Network' },
          { id: 'analytics', label: t('Аналитика') },
        ]}
      />
      {tab !== 'network' && (
        <>
          <DateControls day={day} onChange={setDay} />
          <p className="muted small chart-observation-note">
            {t(
              'Время — оценка по полученным наблюдениям, ограниченная последней известной отметкой. Пропуски при остановке приложения не заполняются. Встречи отражают только друзей с доступным точным местоположением.',
            )}
          </p>
          {ctx.history.error && <ErrorState error={ctx.history.error} retry={ctx.history.retry} />}
        </>
      )}
      {visited.includes('instance') && (
        <section className="charts-panel" hidden={tab !== 'instance'}>
          <InstanceActivity day={day} active={tab === 'instance'} />
        </section>
      )}
      {visited.includes('network') && (
        <section className="charts-panel" hidden={tab !== 'network'}>
          <FriendNetwork />
        </section>
      )}
      {visited.includes('analytics') && (
        <section className="charts-panel" hidden={tab !== 'analytics'}>
          <Analytics day={day} active={tab === 'analytics'} />
        </section>
      )}
    </>
  );
}
