import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellOff,
  CalendarDays,
  Check,
  Clock3,
  ExternalLink,
  ImageIcon,
  Info,
  Mail,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { api, native } from '../api';
import type {
  CalendarEvent,
  InventoryItem,
  MessageTemplate,
  Notification,
  UploadTag,
  User,
  VrcFile,
} from '../api';
import { useApp, useLoad } from '../state';
import { demoEvents, demoFriends, demoWorlds } from '../demo';
import {
  AvatarImage,
  Badge,
  Empty,
  ErrorState,
  imageOf,
  Loading,
  Modal,
  PageHeader,
  SearchField,
  Segmented,
  Section,
} from '../components/ui';
import SecureImage from '../components/SecureImage';
import { printDate, printMedia } from '../api/prints';
import type { Print } from '../api/prints';
import './Collections.css';

const dateLabel = (
  value?: string,
  options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  },
) => {
  if (!value) return 'Дата не указана';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Дата не указана' : date.toLocaleString('ru-RU', options);
};
const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const eventStart = (event: CalendarEvent) =>
  event.startsAt || ('startDate' in event ? String(event.startDate || '') : '');
const eventEnd = (event: CalendarEvent) =>
  event.endsAt || ('endDate' in event ? String(event.endDate || '') : '');
function occursOn(event: CalendarEvent, day: Date) {
  const start = new Date(eventStart(event));
  if (Number.isNaN(start.getTime())) return false;
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const end = new Date(eventEnd(event));
  return (
    start < next &&
    (Number.isNaN(end.getTime()) || end <= start ? localDay(start) === localDay(day) : end > day)
  );
}

export function CalendarPage() {
  const { demo, act, refresh, openWorld, notify } = useApp();
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'following'>('all');
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [pending, setPending] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [moreLoading, setMoreLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(100);
  const key = `${month.getFullYear()}:${month.getMonth()}:${filter}:${refresh}`;
  const latestKey = useRef(key);
  latestKey.current = key;
  const load = useLoad<CalendarEvent[]>(
    async () =>
      demo
        ? filter === 'following'
          ? demoEvents.filter((event) => event.isFollowing)
          : demoEvents
        : api.calendar(month, filter),
    [key, demo],
  );
  useEffect(() => {
    if (load.data) {
      setEvents(load.data);
      setHasMore(!demo && load.data.length === 100);
      setNextOffset(100);
    }
  }, [load.data, demo]);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const preceding = (month.getDay() + 6) % 7;
  const days = Array.from(
    { length: daysInMonth },
    (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1),
  );
  const visible = events
    .filter((event) => {
      const start = new Date(eventStart(event));
      return selectedDay
        ? days.some((day) => localDay(day) === selectedDay && occursOn(event, day))
        : !Number.isNaN(start.getTime()) && days.some((day) => occursOn(event, day));
    })
    .sort((a, b) => new Date(eventStart(a)).getTime() - new Date(eventStart(b)).getTime());
  function moveMonth(direction: number) {
    setSelectedDay(null);
    setMonth(new Date(month.getFullYear(), month.getMonth() + direction, 1));
  }
  async function loadMore() {
    const captured = key;
    setMoreLoading(true);
    try {
      const next = await api.calendar(month, filter, nextOffset);
      if (latestKey.current === captured) {
        setEvents((previous) => [
          ...previous,
          ...next.filter((item) => !previous.some((old) => old.id === item.id)),
        ]);
        setHasMore(next.length === 100);
        setNextOffset((offset) => offset + 100);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось загрузить события');
    } finally {
      setMoreLoading(false);
    }
  }
  async function follow(event: CalendarEvent) {
    const groupId =
      event.groupId || event.group?.id || ('ownerId' in event ? String(event.ownerId || '') : '');
    if (!groupId) {
      notify('VRChat не вернул группу этого события. Откройте событие на сайте VRChat.');
      return;
    }
    setPending(true);
    const success = await act(
      async () => {
        await api.followEvent(groupId, event.id, !event.isFollowing);
        return true;
      },
      event.isFollowing ? 'Подписка на событие отменена' : 'Вы подписались на событие',
    );
    if (success) {
      setEvents((previous) =>
        previous.map((item) =>
          item.id === event.id ? { ...item, isFollowing: !event.isFollowing } : item,
        ),
      );
      setSelected((previous) =>
        previous?.id === event.id ? { ...previous, isFollowing: !event.isFollowing } : previous,
      );
    }
    setPending(false);
  }
  return (
    <>
      <PageHeader
        eyebrow="ВСТРЕЧАЕМСЯ В VRCHAT"
        title="Календарь"
        subtitle="События ваших групп и новые встречи."
        actions={
          <button
            className="icon-button"
            aria-label="Обновить календарь"
            onClick={load.reload}
            disabled={load.loading}
          >
            <RefreshCw size={19} />
          </button>
        }
      />
      <div className="toolbar">
        <Segmented
          items={[
            { id: 'all', label: 'Все события' },
            { id: 'following', label: 'Подписки' },
          ]}
          value={filter}
          onChange={(value) => {
            setFilter(value as 'all' | 'following');
            setSelectedDay(null);
          }}
        />
      </div>
      <div className="calendar-layout">
        <section className="card calendar-card" aria-label="Календарь месяца">
          <div className="calendar-month-row">
            <button
              className="icon-button"
              aria-label="Предыдущий месяц"
              onClick={() => moveMonth(-1)}
            >
              <ArrowLeft size={19} />
            </button>
            <h2>{month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</h2>
            <button
              className="icon-button"
              aria-label="Следующий месяц"
              onClick={() => moveMonth(1)}
            >
              <ArrowRight size={19} />
            </button>
          </div>
          <div className="calendar-weekdays" aria-hidden="true">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {Array.from({ length: preceding }, (_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {days.map((day) => {
              const key = localDay(day),
                count = events.filter((event) => occursOn(event, day)).length,
                today = key === localDay(new Date());
              return (
                <button
                  key={key}
                  onClick={() => setSelectedDay(selectedDay === key ? null : key)}
                  className={`calendar-day ${selectedDay === key ? 'selected' : ''} ${today ? 'today' : ''}`}
                  aria-pressed={selectedDay === key}
                  aria-label={`${day.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, событий: ${count}${today ? ', сегодня' : ''}`}
                >
                  <span>{day.getDate()}</span>
                  {count > 0 && <i aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <div className="calendar-footer">
            <button
              className="text-button"
              onClick={() => {
                setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
                setSelectedDay(localDay(new Date()));
              }}
            >
              Сегодня
            </button>
            {selectedDay && (
              <button className="text-button" onClick={() => setSelectedDay(null)}>
                Весь месяц
              </button>
            )}
          </div>
          <p className="calendar-timezone muted">
            <Clock3 size={13} /> Время: {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
        </section>
        <Section
          title={
            selectedDay
              ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString('ru-RU', {
                  day: 'numeric',
                  month: 'long',
                })
              : 'События месяца'
          }
        >
          {load.loading ? (
            <Loading />
          ) : load.error ? (
            <ErrorState error={load.error} retry={load.reload} />
          ) : visible.length === 0 ? (
            <Empty
              title="Свободный день"
              text={
                demo
                  ? 'Демособытие появится в календаре завтрашнего дня.'
                  : 'Событий не найдено. Попробуйте другой день или фильтр.'
              }
              icon={<CalendarDays size={32} />}
            />
          ) : (
            <div className="event-list">
              {visible.map((event) => (
                <button
                  key={event.id}
                  className="card event-card"
                  onClick={() => setSelected(event)}
                >
                  <div className="event-date">
                    <span>
                      {new Date(eventStart(event)).toLocaleDateString('ru-RU', { month: 'short' })}
                    </span>
                    <strong>{new Date(eventStart(event)).getDate()}</strong>
                  </div>
                  <div className="event-content">
                    <div className="row">
                      <h3>{event.title || event.name || 'Событие VRChat'}</h3>
                      {event.isFollowing && <Bell size={15} aria-label="Вы подписаны" />}
                    </div>
                    <p className="muted">
                      {dateLabel(eventStart(event), { hour: '2-digit', minute: '2-digit' })}
                      {event.group?.name && ` · ${event.group.name}`}
                    </p>
                    {event.description && <p className="event-excerpt">{event.description}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
          {!load.loading && hasMore && (
            <button
              className="button secondary load-more"
              disabled={moreLoading}
              onClick={loadMore}
            >
              {moreLoading ? 'Загрузка…' : 'Ещё события'}
            </button>
          )}
        </Section>
      </div>
      {selected && (
        <Modal
          title={selected.title || selected.name || 'Событие VRChat'}
          onClose={() => setSelected(null)}
        >
          {selected.imageUrl && (
            <SecureImage className="collection-detail-image" src={selected.imageUrl} alt="" />
          )}
          <div className="form-stack">
            <p className="row">
              <CalendarDays size={18} />
              {dateLabel(eventStart(selected))}
            </p>
            {eventEnd(selected) && <p className="muted">До {dateLabel(eventEnd(selected))}</p>}
            {selected.group?.name && <Badge>{selected.group.name}</Badge>}
            <p className="collection-description">
              {selected.description || 'Организатор не добавил описание.'}
            </p>
            <div className="detail-actions">
              <button className="button" disabled={pending} onClick={() => follow(selected)}>
                {selected.isFollowing ? <BellOff size={17} /> : <Bell size={17} />}{' '}
                {pending ? 'Сохранение…' : selected.isFollowing ? 'Отписаться' : 'Подписаться'}
              </button>
              {selected.worldId && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setSelected(null);
                    openWorld(selected.worldId!);
                  }}
                >
                  Открыть мир
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

type InventoryTab = UploadTag | 'prints' | 'inventory';
type CollectionItem = {
  id: string;
  name: string;
  image: string;
  sourceUrl?: string;
  createdAt?: string;
  tags: string[];
  size?: number;
  kind: InventoryTab;
  worldId?: string;
  worldName?: string;
  authorName?: string;
};
const inventoryTabs: { id: InventoryTab; label: string }[] = [
  { id: 'gallery', label: 'Фото' },
  { id: 'icon', label: 'Иконки' },
  { id: 'emoji', label: 'Эмодзи' },
  { id: 'sticker', label: 'Стикеры' },
  { id: 'prints', label: 'Принты' },
  { id: 'inventory', label: 'Предметы' },
];
function fileItem(file: VrcFile, kind: InventoryTab): CollectionItem {
  const versions = [...(file.versions || [])].reverse();
  const version =
    versions.find(
      (item) => item.file?.url && (!('status' in item) || item.status === 'complete'),
    ) ||
    versions.find((item) => item.file?.url) ||
    versions[0];
  const sourceUrl = version?.file?.url || file.fileUrl || '';
  return {
    id: file.id,
    sourceUrl,
    name: file.note || file.name || (kind === 'prints' ? 'Принт VRChat' : 'Без названия'),
    image:
      file.fileUrl ||
      file.imageUrl ||
      file.thumbnailImageUrl ||
      file.image?.url ||
      version?.file?.url ||
      version?.image?.url ||
      '',
    createdAt: file.created_at || file.createdAt || version?.created_at,
    tags: file.tags || [],
    size: version?.file?.sizeInBytes,
    kind,
    worldId: 'worldId' in file ? String(file.worldId || '') : undefined,
    worldName: 'worldName' in file ? String(file.worldName || '') : undefined,
  };
}
function inventoryItem(item: InventoryItem): CollectionItem {
  return {
    id: item.id,
    name: item.name || item.template?.name || 'Предмет VRChat',
    image: item.imageUrl || item.template?.imageUrl || '',
    tags: [item.itemType || item.template?.itemType || ''].filter(Boolean),
    kind: 'inventory',
  };
}
function printItem(print: Print): CollectionItem {
  const media = printMedia(print);
  return {
    id: print.id,
    name: print.note || 'Принт VRChat',
    image: media.thumbnail,
    sourceUrl: media.original,
    createdAt: printDate(print),
    tags: [],
    kind: 'prints',
    worldId: print.worldId,
    worldName: print.worldName,
    authorName: print.authorName,
  };
}

function CollectionPreview({
  src,
  alt,
  refreshKey,
  interactive = false,
}: {
  src: string;
  alt: string;
  refreshKey: string;
  interactive?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setFailed(false), [src, refreshKey]);
  if (!src) return <span className="collection-media-status">Изображение недоступно</span>;
  return (
    <>
      <SecureImage
        src={src}
        alt={alt}
        refreshKey={`${refreshKey}:${attempt}`}
        loading={interactive ? 'eager' : 'lazy'}
        onLoadError={() => setFailed(true)}
        onLoad={() => setFailed(false)}
        style={failed ? { visibility: 'hidden' } : undefined}
      />
      {failed && (
        <span className="collection-media-status" role="status">
          Не удалось загрузить изображение.
          {interactive ? (
            <button
              className="button secondary"
              onClick={() => {
                setFailed(false);
                setAttempt((value) => value + 1);
              }}
            >
              <RefreshCw size={16} /> Повторить
            </button>
          ) : (
            <span>Откройте карточку, чтобы повторить.</span>
          )}
        </span>
      )}
    </>
  );
}
function validProfileImage(item: CollectionItem) {
  if (!item.sourceUrl || !item.id.startsWith('file_')) return false;
  try {
    const url = new URL(item.sourceUrl);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      [
        'api.vrchat.cloud',
        'api.vrchat.com',
        'vrchat.com',
        'cloud.vrchat.cloud',
        'cloud.vrchat.com',
      ].includes(url.hostname) &&
      /\/file\/file_[a-zA-Z0-9-]+\/\d+\/file$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}
function fileSize(size?: number) {
  return size === undefined
    ? ''
    : size < 1024 * 1024
      ? `${Math.round(size / 1024)} КБ`
      : `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

export function InventoryPage() {
  const { user, demo, act, notify, refresh, openWorld, onUserUpdated } = useApp();
  const [tab, setTab] = useState<InventoryTab>('gallery');
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [selected, setSelected] = useState<CollectionItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [appearanceAction, setAppearanceAction] = useState<'icon' | 'banner' | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(100);
  const [upload, setUpload] = useState(false);
  const pageKey = `${user.id}:${tab}:${refresh}`;
  const latestKey = useRef(pageKey);
  latestKey.current = pageKey;
  const hasPlus = user.tags?.includes('system_supporter') || false;
  const canUpload = tab !== 'prints' && tab !== 'inventory';
  const plusRequired = tab === 'icon' || tab === 'emoji' || tab === 'sticker';
  async function fetchItems(offset: number): Promise<CollectionItem[]> {
    if (demo)
      return tab === 'gallery'
        ? demoWorlds.map((world, index) => ({
            id: `demo_photo_${index}`,
            name: world.name,
            image: world.imageUrl || '',
            createdAt: new Date(Date.now() - index * 86400000).toISOString(),
            tags: [],
            kind: 'gallery' as const,
          }))
        : [];
    if (tab === 'inventory') return (await api.inventory(offset)).map(inventoryItem);
    if (tab === 'prints') return (await api.prints(user.id, offset)).map(printItem);
    if (tab === 'emoji') {
      const [staticEmoji, animatedEmoji] = await Promise.all([
        api.files('emoji', offset),
        api.files('emojianimated', offset),
      ]);
      return Array.from(
        new Map(
          [...staticEmoji, ...animatedEmoji].map((item) => [item.id, fileItem(item, tab)]),
        ).values(),
      );
    }
    return (await api.files(tab, offset)).map((item) => fileItem(item, tab));
  }
  const load = useLoad<CollectionItem[]>(() => fetchItems(0), [pageKey, demo]);
  const [mediaRevision, setMediaRevision] = useState(0);
  function reload() {
    setMediaRevision((value) => value + 1);
    load.reload();
  }
  useEffect(() => {
    if (load.data) {
      setItems(load.data);
      setHasMore(!demo && load.data.length >= 100);
      setNextOffset(100);
    }
  }, [load.data, demo]);
  async function more() {
    const key = pageKey;
    setBusy(true);
    try {
      const next = await fetchItems(nextOffset);
      if (key === latestKey.current) {
        setItems((previous) => [
          ...previous,
          ...next.filter((item) => !previous.some((old) => old.id === item.id)),
        ]);
        setHasMore(next.length >= 100);
        setNextOffset((offset) => offset + 100);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось загрузить следующую страницу');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!selected) return;
    setBusy(true);
    const success = await act(async () => {
      if (selected.kind === 'prints') await api.deletePrint(selected.id);
      else await api.deleteFile(selected.id);
      return true;
    }, 'Файл удалён');
    if (success) {
      setItems((previous) => previous.filter((item) => item.id !== selected.id));
      setSelected(null);
      setDeleteConfirm(false);
    }
    setBusy(false);
  }
  async function original() {
    const url = selected?.sourceUrl || selected?.image;
    if (!url) return;
    try {
      await native.openLink({ url });
    } catch {
      notify(
        'Не удалось открыть оригинал. В Android он открывается во внешнем браузере; для закрытых файлов может потребоваться вход в VRChat.',
      );
    }
  }
  async function applyAppearance() {
    if (!selected || !appearanceAction || !validProfileImage(selected)) return;
    const action = appearanceAction,
      fileUrl = selected.sourceUrl!;
    setBusy(true);
    try {
      const success = await act(
        async () => {
          await api.updateAppearance(
            user.id,
            action === 'icon'
              ? { userIcon: fileUrl }
              : { bannerType: 'customImage', bannerCustomUrl: fileUrl },
          );
          return true;
        },
        action === 'icon' ? 'Иконка профиля обновлена' : 'Баннер профиля обновлён',
      );
      if (success) {
        setAppearanceAction(null);
        try {
          onUserUpdated(await api.resume());
        } catch {
          notify('Оформление сохранено в VRChat. Обновить локальный профиль пока не удалось.');
        }
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="ВАШИ КОЛЛЕКЦИИ"
        title="Инвентарь"
        subtitle="Фото, иконки и небольшие вещи с большой историей."
        actions={
          <button
            className="icon-button"
            aria-label="Обновить инвентарь"
            onClick={reload}
            disabled={load.loading}
          >
            <RefreshCw size={19} />
          </button>
        }
      />
      <div className="toolbar inventory-toolbar">
        <Segmented
          items={inventoryTabs}
          value={tab}
          onChange={(value) => setTab(value as InventoryTab)}
        />
        {canUpload && (
          <button
            className="button"
            onClick={() => setUpload(true)}
            disabled={!demo && plusRequired && !hasPlus}
          >
            <Upload size={17} /> Загрузить
          </button>
        )}
      </div>
      {plusRequired && (
        <p className="collection-note">
          <Info size={16} />
          {tab === 'icon' ? 'Иконки профиля' : 'Эмодзи и стикеры'} загружаются с подпиской VRC+.
          {(tab === 'emoji' || tab === 'sticker') && ' Не больше 18 в коллекции.'}
        </p>
      )}
      {tab === 'prints' && (
        <p className="collection-note">
          <Info size={16} />
          Принты, созданные и собранные в VRChat. Фото с телефона можно загрузить во вкладке «Фото».
        </p>
      )}
      {load.loading ? (
        <Loading />
      ) : load.error ? (
        <ErrorState error={load.error} retry={reload} />
      ) : items.length === 0 ? (
        <Empty
          title="Здесь пока пусто"
          text={
            demo
              ? 'В деморежиме примеры находятся во вкладке «Фото».'
              : tab === 'inventory'
                ? 'Предметы, полученные в VRChat, появятся здесь.'
                : 'Загрузите изображение или добавьте его в VRChat.'
          }
          icon={<ImageIcon size={32} />}
        />
      ) : (
        <div className="grid inventory-grid">
          {items.map((item) => (
            <button
              key={item.id}
              className="card media-card"
              onClick={() => {
                setSelected(item);
                setDeleteConfirm(false);
                setAppearanceAction(null);
              }}
            >
              <div
                className={`media-cover inventory-cover ${tab === 'icon' || tab === 'emoji' || tab === 'sticker' ? 'contain' : ''}`}
              >
                <ImageIcon className="inventory-image-placeholder" size={38} />
                <CollectionPreview
                  src={item.image}
                  alt=""
                  refreshKey={`${pageKey}:${mediaRevision}`}
                />
                <div className="inventory-image-badges">
                  {item.tags.includes('emojianimated') && <Badge>АНИМ.</Badge>}
                  {tab === 'inventory' && item.tags[0] && <Badge>{item.tags[0]}</Badge>}
                </div>
              </div>
              <div className="card-body">
                <h3>{item.name}</h3>
                <p className="muted">
                  {item.createdAt
                    ? dateLabel(item.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })
                    : item.kind === 'inventory'
                      ? 'Предмет VRChat'
                      : 'Изображение'}
                  {item.size ? ` · ${fileSize(item.size)}` : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
      {!load.loading && hasMore && (
        <button className="button secondary load-more" onClick={more} disabled={busy}>
          {busy ? 'Загрузка…' : 'Загрузить ещё'}
        </button>
      )}
      {selected && (
        <Modal
          title={
            deleteConfirm
              ? 'Удалить файл?'
              : appearanceAction === 'icon'
                ? 'Изменить иконку профиля?'
                : appearanceAction === 'banner'
                  ? 'Изменить баннер профиля?'
                  : selected.name
          }
          onClose={() => {
            if (!busy) {
              setSelected(null);
              setDeleteConfirm(false);
              setAppearanceAction(null);
            }
          }}
        >
          {deleteConfirm ? (
            <div className="form-stack">
              <p>«{selected.name}» будет удалён из VRChat. Это действие нельзя отменить.</p>
              <div className="detail-actions">
                <button className="button danger" onClick={remove} disabled={busy}>
                  <Trash2 size={17} />
                  {busy ? 'Удаление…' : 'Удалить навсегда'}
                </button>
                <button
                  className="button secondary"
                  onClick={() => setDeleteConfirm(false)}
                  disabled={busy}
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : appearanceAction ? (
            <div className="form-stack">
              <div className={`appearance-preview ${appearanceAction}`}>
                <SecureImage src={selected.image} alt={selected.name} />
              </div>
              <p>
                Использовать «{selected.name}» как{' '}
                {appearanceAction === 'icon' ? 'иконку' : 'баннер'} вашего профиля VRChat?
              </p>
              <p className="muted">Изменение увидят другие пользователи. Функция требует VRC+.</p>
              <div className="detail-actions">
                <button
                  className="button"
                  disabled={busy || (!demo && !hasPlus)}
                  onClick={applyAppearance}
                >
                  {busy ? 'Сохранение…' : 'Применить'}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setAppearanceAction(null)}
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="collection-image-view">
                {selected.image ? (
                  <CollectionPreview
                    src={selected.sourceUrl || selected.image}
                    alt={selected.name}
                    refreshKey={`${pageKey}:${mediaRevision}`}
                    interactive
                  />
                ) : (
                  <Empty title="Нет изображения" />
                )}
              </div>
              <div className="form-stack">
                {selected.createdAt && <p className="muted">{dateLabel(selected.createdAt)}</p>}
                {selected.authorName && <p className="muted">Автор: {selected.authorName}</p>}
                {selected.worldName && <p>{selected.worldName}</p>}
                {(selected.kind === 'icon' || selected.kind === 'gallery') &&
                  validProfileImage(selected) && (
                    <div className="appearance-actions">
                      <p className="muted">Оформление профиля · VRC+</p>
                      <div className="detail-actions">
                        {selected.kind === 'icon' && (
                          <button
                            className="button"
                            disabled={!demo && !hasPlus}
                            onClick={() => setAppearanceAction('icon')}
                          >
                            Сделать иконкой профиля
                          </button>
                        )}
                        {selected.kind === 'gallery' && (
                          <button
                            className="button"
                            disabled={!demo && !hasPlus}
                            onClick={() => setAppearanceAction('banner')}
                          >
                            Сделать баннером профиля
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                <div className="detail-actions">
                  {selected.image && (
                    <button className="button secondary" onClick={original}>
                      <ExternalLink size={16} />
                      Открыть оригинал
                    </button>
                  )}
                  {selected.worldId && (
                    <button
                      className="button secondary"
                      onClick={() => {
                        setSelected(null);
                        openWorld(selected.worldId!);
                      }}
                    >
                      Мир на фото
                    </button>
                  )}
                  {selected.kind !== 'inventory' && (
                    <button className="button danger" onClick={() => setDeleteConfirm(true)}>
                      <Trash2 size={16} />
                      Удалить
                    </button>
                  )}
                </div>
                {selected.image && (
                  <p className="muted original-link-note">
                    Оригинал откроется во внешнем браузере. Для закрытых файлов может потребоваться
                    вход в VRChat.
                  </p>
                )}
              </div>
            </>
          )}
        </Modal>
      )}
      {upload && canUpload && (
        <UploadDialog
          tag={tab as UploadTag}
          onClose={() => setUpload(false)}
          onUpload={async (file) => {
            const kind = tab as UploadTag;
            const uploaded = await act(() => api.uploadImage(file, kind), 'Изображение загружено');
            if (uploaded) {
              setUpload(false);
              load.reload();
              setDeleteConfirm(false);
              setAppearanceAction(null);
              const item = fileItem(uploaded, kind);
              if (item.sourceUrl) setSelected(item);
              else if (uploaded.id) {
                try {
                  setSelected(fileItem(await api.file(uploaded.id), kind));
                } catch {
                  notify('Изображение загружено. Обновите список, чтобы открыть его свойства.');
                }
              }
            }
          }}
        />
      )}
    </>
  );
}

async function normalizeImage(file: File, tag: UploadTag): Promise<File> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('Выберите PNG, JPEG или WebP.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Исходный файл должен быть меньше 10 МБ.');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
      img.src = url;
    });
    if (image.naturalWidth < 64 || image.naturalHeight < 64)
      throw new Error('Изображение должно быть не меньше 64 × 64 пикселей.');
    const square = tag !== 'gallery',
      target = tag === 'emoji' || tag === 'sticker' ? 1024 : 2048;
    const sourceWidth = square
      ? Math.min(image.naturalWidth, image.naturalHeight)
      : image.naturalWidth;
    const sourceHeight = square ? sourceWidth : image.naturalHeight;
    const scale = Math.min(1, target / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);
    if (tag === 'emoji') {
      canvas.width = 1024;
      canvas.height = 1024;
    }
    if (canvas.width < 64 || canvas.height < 64)
      throw new Error(
        'Изображение слишком вытянутое. После уменьшения каждая сторона должна быть не меньше 64 пикселей.',
      );
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить изображение.');
    context.drawImage(
      image,
      (image.naturalWidth - sourceWidth) / 2,
      (image.naturalHeight - sourceHeight) / 2,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Не удалось сохранить PNG.'))),
        'image/png',
      ),
    );
    if (blob.size > 8 * 1024 * 1024)
      throw new Error('PNG после обработки превышает 8 МБ. Выберите изображение меньшего размера.');
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
function UploadDialog({
  tag,
  onClose,
  onUpload,
}: {
  tag: UploadTag;
  onClose: () => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setBusy(true);
    setError('');
    setFile(null);
    setPreview('');
    try {
      const result = await normalizeImage(selected, tag);
      setFile(result);
      setPreview(URL.createObjectURL(result));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось обработать изображение');
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    try {
      await onUpload(file);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Загрузить изображение"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="form-stack" onSubmit={submit}>
        <p className="muted">
          {tag === 'gallery'
            ? 'До 2048 × 2048, в формате PNG.'
            : tag === 'emoji'
              ? 'Изображение будет обрезано по центру до квадрата 1024 × 1024.'
              : 'Изображение будет обрезано по центру до квадрата.'}{' '}
          Подготовленный файл можно проверить перед загрузкой.
        </p>
        <label className="upload-picker">
          <Upload size={24} />
          <span>{busy ? 'Подготовка…' : 'Выбрать изображение'}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={choose}
            disabled={busy}
          />
        </label>
        {preview && (
          <>
            <SecureImage
              className="upload-preview"
              src={preview}
              alt="Предпросмотр подготовленного изображения"
            />
            <p className="muted">PNG · {fileSize(file?.size)}</p>
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="detail-actions">
          <button className="button" type="submit" disabled={!file || busy}>
            <Upload size={17} />
            {busy ? 'Обработка…' : 'Загрузить в VRChat'}
          </button>
          <button className="button secondary" type="button" onClick={onClose} disabled={busy}>
            Отмена
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function MessengerPage() {
  const { user, demo, act, notify, refresh, openUser } = useApp();
  const [search, setSearch] = useState(''),
    [recipient, setRecipient] = useState<User | null>(null),
    [message, setMessage] = useState(''),
    [sending, setSending] = useState(false),
    [receipt, setReceipt] = useState('');
  const friendsLoad = useLoad<User[]>(
    async () => (demo ? demoFriends : api.allFriends()),
    [user.id, demo, refresh],
  );
  const incomingLoad = useLoad<Notification[]>(
    async () => (demo ? [] : api.notifications()),
    [user.id, demo, refresh],
  );
  const incoming = (incomingLoad.data || [])
    .map((item) => ({
      notification: item,
      text:
        typeof item.details?.inviteMessage === 'string'
          ? item.details.inviteMessage
          : item.message || '',
    }))
    .filter((item) => item.text.startsWith('msg '));
  const slotsLoad = useLoad<MessageTemplate[]>(
    async () =>
      demo
        ? Array.from({ length: 12 }, (_, slot) => ({
            slot,
            message: '',
            canBeUpdated: true,
            remainingCooldownMinutes: 0,
          }))
        : api.messageTemplates(user.id),
    [user.id, demo, refresh],
  );
  const friends = (friendsLoad.data || []).filter((friend) =>
    friend.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const freeSlots = (slotsLoad.data || []).filter(
    (slot) => slot.canBeUpdated && (slot.remainingCooldownMinutes || 0) <= 0,
  ).length;
  const reusedSlot = (slotsLoad.data || []).some(
    (slot) => slot.message === `msg ${message.trim()}`,
  );
  const noSlots = !slotsLoad.loading && !slotsLoad.error && freeSlots === 0 && !reusedSlot;
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!recipient || sending || !message.trim()) return;
    setSending(true);
    setReceipt('');
    try {
      const name = recipient.displayName;
      const success = await act(async () => {
        await api.sendMessage(user.id, recipient.id, message.trim());
        return true;
      }, `Сообщение для ${name} отправлено`);
      if (success) {
        setReceipt(`VRChat принял сообщение для ${name}. Оно придёт как приглашение с текстом.`);
        setMessage('');
        slotsLoad.reload();
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось отправить сообщение');
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="ОСТАВАЙТЕСЬ НА СВЯЗИ"
        title="Сообщения"
        subtitle="Короткое сообщение другу через приглашение VRChat."
      />
      <div className="collection-note messenger-info">
        <Info size={19} />
        <p>
          Как и в ПК-версии, текст отправляется через шаблон приглашения VRChat. Это не обычный чат.
          VRChat ограничивает изменение шаблонов; отправка возможна только в доступный слот.
        </p>
      </div>
      <div className="messenger-layout">
        <section className="card messenger-friends">
          <div className="messenger-friends-heading">
            <h2>Кому написать</h2>
            <SearchField value={search} onChange={setSearch} placeholder="Найти друга" />
          </div>
          {friendsLoad.loading ? (
            <Loading />
          ) : friendsLoad.error ? (
            <ErrorState error={friendsLoad.error} retry={friendsLoad.reload} />
          ) : friends.length === 0 ? (
            <Empty
              title="Друзья не найдены"
              text="Попробуйте другое имя."
              icon={<Users size={28} />}
            />
          ) : (
            <div className="messenger-friend-list">
              {friends.map((friend) => (
                <button
                  className={`list-row messenger-friend ${recipient?.id === friend.id ? 'selected' : ''}`}
                  key={friend.id}
                  onClick={() => {
                    setRecipient(friend);
                    setReceipt('');
                  }}
                  aria-pressed={recipient?.id === friend.id}
                >
                  <AvatarImage
                    name={friend.displayName}
                    src={imageOf(friend)}
                    size={42}
                    status={friend.status}
                  />
                  <div>
                    <strong>{friend.displayName}</strong>
                    <p className="muted">{friend.statusDescription || 'Друг в VRChat'}</p>
                  </div>
                  {recipient?.id === friend.id && <Check size={18} />}
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="card messenger-composer">
          {recipient ? (
            <>
              <div className="messenger-recipient">
                <AvatarImage src={imageOf(recipient)} name={recipient.displayName} size={48} />
                <div>
                  <h2>{recipient.displayName}</h2>
                  <button className="text-button" onClick={() => openUser(recipient)}>
                    Открыть профиль
                  </button>
                </div>
              </div>
              <form className="form-stack" onSubmit={send}>
                <label className="field">
                  Сообщение
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={60}
                    placeholder="Привет! Исследуем новые миры вечером?"
                    rows={4}
                    disabled={sending}
                  />
                </label>
                <div className="composer-meta">
                  <span>{message.length}/60</span>
                  <span>Изменяемых слотов: {slotsLoad.loading ? '…' : freeSlots}</span>
                </div>
                {slotsLoad.error && <ErrorState error={slotsLoad.error} retry={slotsLoad.reload} />}{' '}
                {noSlots && (
                  <p className="collection-note">
                    <Clock3 size={17} />
                    Все слоты на паузе. Дождитесь окончания ограничения VRChat или используйте уже
                    сохранённый текст.
                  </p>
                )}
                {receipt && (
                  <p className="message-receipt" role="status">
                    <Check size={18} />
                    {receipt}
                  </p>
                )}
                <button
                  className="button"
                  type="submit"
                  disabled={
                    sending || !message.trim() || slotsLoad.loading || !!slotsLoad.error || noSlots
                  }
                >
                  <Send size={17} />
                  {sending ? 'Отправка…' : 'Отправить'}
                </button>
                <p className="muted messenger-cooldown">
                  Не повторяйте отправку часто. Доступность слотов и время ожидания определяет
                  VRChat.
                </p>
              </form>
            </>
          ) : (
            <Empty
              title="Выберите друга"
              text="Одного короткого сообщения бывает достаточно, чтобы собраться вместе."
              icon={<Mail size={34} />}
            />
          )}
        </section>
      </div>
      <Section title="Полученные сообщения">
        {incomingLoad.loading ? (
          <Loading />
        ) : incomingLoad.error ? (
          <ErrorState error={incomingLoad.error} retry={incomingLoad.reload} />
        ) : incoming.length === 0 ? (
          <Empty
            title="Новых сообщений нет"
            text="Здесь появятся приглашения с сообщениями VRCNext. Остальные приглашения находятся в уведомлениях."
            icon={<Mail size={26} />}
          />
        ) : (
          <div className="event-list">
            {incoming.map(({ notification, text }) => (
              <article className="card incoming-message" key={notification.id}>
                <div className="row">
                  <strong>
                    {notification.senderDisplayName ||
                      notification.senderUsername ||
                      'Пользователь VRChat'}
                  </strong>
                  <small className="muted">
                    {dateLabel(notification.created_at || notification.createdAt)}
                  </small>
                </div>
                <p>{text.slice(4)}</p>
                {notification.senderUserId && (
                  <button
                    className="text-button"
                    onClick={() => openUser(notification.senderUserId!)}
                  >
                    Открыть профиль
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </Section>
      <Section title="Шаблоны приглашений">
        <div className="card message-templates">
          {slotsLoad.loading ? (
            <Loading />
          ) : slotsLoad.error ? (
            <ErrorState error={slotsLoad.error} retry={slotsLoad.reload} />
          ) : (
            <>
              <p className="muted">
                Сохранённые тексты принадлежат вашему аккаунту VRChat. Изменение при отправке может
                заменить один из доступных шаблонов.
              </p>
              <div className="template-grid">
                {(slotsLoad.data || []).map((slot) => (
                  <button
                    key={slot.slot}
                    className="template-item"
                    onClick={() => {
                      if (slot.message.startsWith('msg ')) setMessage(slot.message.slice(4));
                      else
                        notify(
                          'Этот шаблон не создан мессенджером и не будет выбран автоматически.',
                        );
                    }}
                    disabled={!slot.message.startsWith('msg ')}
                  >
                    <span className="row">
                      <Badge>#{slot.slot + 1}</Badge>
                      <small className="muted">
                        {slot.canBeUpdated && (slot.remainingCooldownMinutes || 0) <= 0
                          ? 'Доступен'
                          : `${slot.remainingCooldownMinutes || '—'} мин.`}
                      </small>
                    </span>
                    <span>
                      {slot.message.startsWith('msg ')
                        ? slot.message.slice(4)
                        : slot.message || 'Пустой шаблон'}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </Section>
    </>
  );
}
