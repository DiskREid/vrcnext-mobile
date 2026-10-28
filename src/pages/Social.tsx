import { uiMessage } from '../i18n';
import { t, dateLocale, useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { api, native } from '../api';
import type { Moderation, User } from '../api';
import { mergePublicProfile, readPublicProfile } from '../api/profile';
import { historyLabels } from '../data/history';
import { accessibleLocation, presenceLabel } from '../data/locations';
import { presenceMode } from '../data/presence';
import { useApp, useLoad } from '../state';
import SecureImage from '../components/SecureImage';
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
} from '../components/ui';
import { rankOf, statusName } from './Details';
import './Social.css';

function date(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return t('Не предоставлено API');
  return new Date(value).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}
function rank(user: User) {
  return user.tags ? rankOf(user.tags) : 'Неизвестен';
}
function safeLink(link: string) {
  try {
    return new URL(link).protocol === 'https:';
  } catch {
    return false;
  }
}
function FriendDetail({ friend, onClose }: { friend: User; onClose: () => void }) {
  const ctx = useApp();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useLoad<{ user: User; profileError?: string }>(async () => {
    if (ctx.demo) return { user: friend };
    const user = await api.user(friend.id);
    try {
      const profile = readPublicProfile(await api.userProfile(friend.id), friend.id);
      return { user: mergePublicProfile(user, profile) };
    } catch (error) {
      // Retain the successful user response while making the failed Bio request explicit.
      return { user, profileError: error instanceof Error ? error.message : String(error) };
    }
  }, [friend.id, ctx.demo]);
  const user = load.data?.user || friend;
  const observed = useRef<User | undefined>(undefined);
  useEffect(() => {
    if (load.data && observed.current !== load.data.user && !ctx.demo) {
      observed.current = load.data.user;
      ctx.history.observeProfile(load.data.user);
    }
  }, [load.data, ctx.demo, ctx.history]);
  const stats = ctx.history.friendStats(friend.id);
  async function remove() {
    await ctx.act(async () => {
      setBusy(true);
      try {
        await api.unfriend(friend.id);
        ctx.history.recordFriendAction(friend.id, user.displayName, 'friend-remove');
        setConfirm(false);
        onClose();
      } finally {
        setBusy(false);
      }
    }, uiMessage('Пользователь удалён из друзей'));
  }
  return (
    <div className="social-expanded">
      {load.loading && <Loading />}
      {load.error && <ErrorState error={load.error} retry={load.reload} />}
      {load.data?.profileError && (
        <ErrorState
          error={t('Не удалось загрузить публичный профиль: {value0}', {
            value0: String(load.data.profileError),
          })}
          retry={load.reload}
        />
      )}
      <dl className="social-info">
        <div>
          <dt>ID</dt>
          <dd>{user.id}</dd>
        </div>
        <div>
          <dt>Trust Rank</dt>
          <dd>{t(rank(user))}</dd>
        </div>
        <div>
          <dt>{t('Статус')}</dt>
          <dd>
            {t(statusName(user.status))}
            {user.statusDescription && ` · ${user.statusDescription}`}
          </dd>
        </div>
        <div>
          <dt>{t('Местоположение')}</dt>
          <dd>
            {t(presenceLabel(user))}
            {accessibleLocation(user.location) && (
              <button
                className="text-button"
                onClick={() => ctx.openWorld(user.location!.split(':')[0])}
              >
                {t('Открыть мир')}
              </button>
            )}
          </dd>
        </div>
        <div>
          <dt>{t('Последняя активность')}</dt>
          <dd>{date(user.last_activity)}</dd>
        </div>
        <div>
          <dt>{t('Последний вход')}</dt>
          <dd>{date(user.last_login)}</dd>
        </div>
        <div>
          <dt>{t('Регистрация')}</dt>
          <dd>{date(user.date_joined)}</dd>
        </div>
        <div>
          <dt>{t('Языки')}</dt>
          <dd>
            {user.languages?.length
              ? user.languages.join(', ')
              : load.loading
                ? t('Загрузка…')
                : t('Не предоставлены')}
          </dd>
        </div>
        <div>
          <dt>{t('Совместные встречи')}</dt>
          <dd>{stats?.encounters ? stats.encounters : t('Нет наблюдений')}</dd>
        </div>
        <div>
          <dt>{t('Время вместе')}</dt>
          <dd>
            {stats?.totalMs
              ? t('{value0} мин наблюдений', { value0: String(Math.floor(stats.totalMs / 60_000)) })
              : stats.encounters
                ? t('Недостаточно наблюдений для оценки времени')
                : t('Нет наблюдений')}
          </dd>
        </div>
        <div>
          <dt>{t('Последняя встреча')}</dt>
          <dd>{stats?.lastMeeting ? date(stats.lastMeeting) : t('Нет наблюдений')}</dd>
        </div>
      </dl>
      {(user.currentAvatarImageUrl || user.currentAvatarThumbnailImageUrl) && (
        <div className="social-current-avatar">
          <SecureImage
            src={user.currentAvatarImageUrl || user.currentAvatarThumbnailImageUrl}
            alt={t('Текущий доступный аватар')}
          />
          <span className="muted small">
            {t('Доступное изображение аватара')}
            {user.currentAvatar && ` · ${user.currentAvatar}`}
          </span>
        </div>
      )}
      <section className="social-bio">
        <h3>Bio</h3>
        <p className="preserve-lines">
          {user.bio !== undefined
            ? user.bio || t('Биография пустая')
            : load.loading
              ? t('Загрузка…')
              : load.error || load.data?.profileError
                ? t('Не удалось загрузить Bio. Повторите запрос.')
                : t('API не предоставил биографию.')}
        </p>
        {user.bioLinks?.filter(safeLink).map((link) => (
          <button
            key={link}
            className="link-row"
            onClick={() => void ctx.act(() => native.openLink({ url: link }))}
          >
            <ExternalLink size={15} />
            {link}
          </button>
        ))}
      </section>
      <div className="social-detail-actions">
        <button className="button secondary compact" onClick={() => ctx.openUser(user)}>
          <UserRound size={16} />
          {t('Полный профиль')}
        </button>
        <button className="button danger compact" onClick={() => setConfirm(true)}>
          <Trash2 size={16} />
          {t('Удалить из друзей')}
        </button>
      </div>
      {confirm && (
        <Modal title={t('Удалить из друзей?')} onClose={() => !busy && setConfirm(false)}>
          <p>{t('Удалить {name} из списка друзей VRChat?', { name: user.displayName })}</p>
          <div className="social-detail-actions">
            <button className="button secondary" disabled={busy} onClick={() => setConfirm(false)}>
              {t('Отмена')}
            </button>
            <button className="button danger" disabled={busy} onClick={() => void remove()}>
              {busy ? t('Удаляем…') : t('Удалить')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function FriendsList() {
  const ctx = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('original');
  const [rankFilter, setRankFilter] = useState('all');
  const [expanded, setExpanded] = useState<string>();
  const [sortRevision, setSortRevision] = useState(0);
  const order = useRef<{ key: string; ids: string[] }>({ key: '', ids: [] });
  const friends = ctx.friends.data;
  const byId = new Map(friends.map((friend) => [friend.id, friend]));
  const compare = (a: User, b: User) => {
    if (sort === 'name') return a.displayName.localeCompare(b.displayName, dateLocale());
    if (sort === 'rank') {
      const ranks = ['Trusted', 'Known', 'User', 'New User', 'Visitor', 'Неизвестен'];
      return (
        ranks.indexOf(rank(a)) - ranks.indexOf(rank(b)) ||
        a.displayName.localeCompare(b.displayName, dateLocale())
      );
    }
    if (sort === 'last')
      return (b.last_activity || b.last_login || '').localeCompare(
        a.last_activity || a.last_login || '',
      );
    return 0;
  };
  const key = `${sort}:${dateLocale()}:${ctx.refresh}:${sortRevision}`;
  // Sort only after a deliberate user choice/refresh. New friends append without moving existing rows.
  if (order.current.key !== key) {
    order.current = { key, ids: [...friends].sort(compare).map((friend) => friend.id) };
  } else {
    const remaining = order.current.ids.filter((id) => byId.has(id));
    const seen = new Set(remaining);
    order.current.ids = [
      ...remaining,
      ...friends
        .filter((friend) => !seen.has(friend.id))
        .sort(compare)
        .map((friend) => friend.id),
    ];
  }
  const ids = order.current.ids;
  const items = ids
    .map((id) => byId.get(id)!)
    .filter((friend) => {
      const online = presenceMode(friend) === 'game';
      const web = presenceMode(friend) === 'website';
      return (
        (!query ||
          `${friend.displayName} ${friend.id}`.toLowerCase().includes(query.toLowerCase())) &&
        (filter === 'all' ||
          (filter === 'online' ? online : filter === 'web' ? web : !online && !web)) &&
        (rankFilter === 'all' || rank(friend) === rankFilter)
      );
    });
  return (
    <>
      <div className="toolbar">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t('Поиск друзей по имени или ID')}
        />
        <button
          className="icon-button"
          aria-label={t('Обновить список Social')}
          onClick={() => {
            ctx.friends.reload();
            setSortRevision((revision) => revision + 1);
          }}
        >
          <RefreshCw size={18} className={ctx.friends.refreshing ? 'spin' : ''} />
        </button>
      </div>
      <Segmented
        value={filter}
        onChange={setFilter}
        items={[
          { id: 'all', label: t('Все') },
          { id: 'online', label: t('В VRChat') },
          { id: 'web', label: t('На сайте') },
          { id: 'offline', label: t('Не в сети') },
        ]}
      />
      <div className="social-filters">
        <label className="field">
          {t('Сортировка')}
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="original">{t('Порядок списка')}</option>
            <option value="name">{t('По имени')}</option>
            <option value="rank">{t('По Trust Rank')}</option>
            <option value="last">{t('Последняя активность')}</option>
          </select>
        </label>
        <label className="field">
          Trust Rank
          <select value={rankFilter} onChange={(e) => setRankFilter(e.target.value)}>
            <option value="all">{t('Все ранги')}</option>
            {['Trusted', 'Known', 'User', 'New User', 'Visitor', 'Неизвестен'].map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="section-heading">
        <h2>Friends List</h2>
        <span className="count-label">{items.length}</span>
      </div>
      {ctx.friends.error && <ErrorState error={ctx.friends.error} retry={ctx.friends.reload} />}
      {ctx.friends.loading ? (
        <Loading />
      ) : items.length ? (
        <div className="social-friends">
          {items.map((friend) => (
            <article className="card social-friend-card" key={friend.id}>
              <div className="social-friend-summary">
                <button className="social-person" onClick={() => ctx.openUser(friend)}>
                  <AvatarImage
                    name={friend.displayName}
                    src={imageOf(friend)}
                    user={friend}
                    fallbackSrc={
                      friend.currentAvatarThumbnailImageUrl || friend.currentAvatarImageUrl
                    }
                    size={48}
                  />
                  <div>
                    <h3>{friend.displayName}</h3>
                    <p>{friend.statusDescription || t(presenceLabel(friend))}</p>
                    <span className="muted small">
                      {t(rank(friend))} · {t(presenceLabel(friend))}
                    </span>
                  </div>
                </button>
                <button
                  className="icon-button"
                  aria-expanded={expanded === friend.id}
                  aria-label={t('Подробности {value0}', { value0: String(friend.displayName) })}
                  onClick={() => setExpanded(expanded === friend.id ? undefined : friend.id)}
                >
                  <ChevronDown
                    size={20}
                    className={expanded === friend.id ? 'social-chevron-open' : ''}
                  />
                </button>
              </div>
              {expanded === friend.id && (
                <FriendDetail
                  key={friend.id}
                  friend={friend}
                  onClose={() => setExpanded(undefined)}
                />
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty title={t('Друзья не найдены')} text={t('Попробуйте другой фильтр или запрос.')} />
      )}
    </>
  );
}

function FriendLog() {
  const ctx = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const kinds = ['friend-add', 'friend-remove', 'name', 'trust', 'profile', 'bio'];
  const [limit, setLimit] = useState(100);
  const entries = ctx.history.events.filter(
    (event) =>
      kinds.includes(event.kind) &&
      (filter === 'all' || event.kind === filter) &&
      `${event.displayName} ${event.userId} ${event.detail}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <SearchField
        value={query}
        onChange={(value) => {
          setQuery(value);
          setLimit(100);
        }}
        placeholder={t('Поиск в журнале друзей')}
      />
      <Segmented
        value={filter}
        onChange={(value) => {
          setFilter(value);
          setLimit(100);
        }}
        items={[
          { id: 'all', label: t('Все') },
          { id: 'friend-add', label: t('Добавлены') },
          { id: 'friend-remove', label: t('Удалены') },
          { id: 'name', label: t('Имена') },
          { id: 'trust', label: 'Trust Rank' },
          { id: 'profile', label: t('Профиль') },
          { id: 'bio', label: 'Bio' },
        ]}
      />
      <p className="muted small">
        {t(
          'Сохраняются только изменения, наблюдавшиеся приложением. История до начала наблюдения и точное время изменений вне подключения неизвестны.',
        )}
      </p>
      {ctx.history.error && <ErrorState error={ctx.history.error} retry={ctx.history.retry} />}
      {ctx.history.loading ? (
        <Loading />
      ) : entries.length ? (
        <div className="social-log">
          {entries.slice(0, limit).map((event) => (
            <article className="card social-log-row" key={event.id}>
              <Users size={18} />
              <div>
                <button className="text-button" onClick={() => ctx.openUser(event.userId)}>
                  {event.displayName}
                </button>
                <h3>{t(historyLabels[event.kind])}</h3>
                <p>{event.detail}</p>
                {event.before !== undefined && (
                  <p className="muted small">
                    {t('Было:')}{' '}
                    {event.kind === 'trust'
                      ? rankOf(event.before.split(','))
                      : event.before || t('(пусто)')}
                  </p>
                )}
                {event.after !== undefined && (
                  <p className="muted small">
                    {t('Стало:')}{' '}
                    {event.kind === 'trust'
                      ? rankOf(event.after.split(','))
                      : event.after || t('(пусто)')}
                  </p>
                )}
                <time dateTime={event.time}>{date(event.time)}</time>
              </div>
            </article>
          ))}
          {entries.length > limit && (
            <button className="button secondary load-more" onClick={() => setLimit((n) => n + 100)}>
              {t('Показать ещё')}
            </button>
          )}
        </div>
      ) : (
        <Empty
          title={t('Журнал друзей пока пуст')}
          text={t('Новые наблюдаемые изменения появятся здесь и сохранятся после перезапуска.')}
        />
      )}
    </>
  );
}

function Moderations({ type }: { type: 'block' | 'mute' }) {
  const ctx = useApp();
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<Moderation>();
  const [busy, setBusy] = useState(false);
  const load = useLoad(
    () => (ctx.demo ? Promise.resolve([]) : api.moderations(type)),
    [ctx.demo, ctx.refresh, type],
  );
  const entries = (load.data || []).filter((m) =>
    `${m.targetDisplayName || ''} ${m.targetUserId || ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const history = ctx.history.events.filter((e) => e.kind === 'moderation');
  const remove = async () => {
    if (!confirm?.targetUserId) return;
    const target = confirm;
    await ctx.act(
      async () => {
        setBusy(true);
        try {
          await api.unmoderate(target.targetUserId!, type);
          ctx.history.recordModeration(
            target.targetUserId!,
            target.targetDisplayName || target.targetUserId!,
            type === 'block' ? 'Снята блокировка' : 'Снято заглушение',
          );
          setConfirm(undefined);
          load.reload();
        } finally {
          setBusy(false);
        }
      },
      type === 'block' ? uiMessage('Блокировка снята') : uiMessage('Заглушение снято'),
    );
  };
  return (
    <>
      <SearchField value={query} onChange={setQuery} placeholder={t('Поиск в списке модерации')} />
      {load.loading ? (
        <Loading />
      ) : load.error ? (
        <ErrorState error={load.error} retry={load.reload} />
      ) : entries.length ? (
        <div className="social-moderations">
          {entries.map((m) => (
            <article className="card social-moderation-row" key={m.id}>
              <button
                className="social-moderation-user"
                disabled={!m.targetUserId}
                onClick={() => m.targetUserId && ctx.openUser(m.targetUserId)}
              >
                <ShieldCheck size={20} />
                <span>
                  <strong>
                    {m.targetDisplayName || m.targetUserId || t('Неизвестный пользователь')}
                  </strong>
                  <small>{m.targetUserId}</small>
                  {typeof (m as Moderation & { created?: string }).created === 'string' && (
                    <time>{date((m as Moderation & { created?: string }).created)}</time>
                  )}
                </span>
              </button>
              <button
                className="button secondary compact"
                disabled={!m.targetUserId}
                onClick={() => setConfirm(m)}
              >
                {type === 'block' ? t('Разблокировать') : t('Снять mute')}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={type === 'block' ? t('Заблокированных нет') : t('Заглушённых нет')}
          text={query ? t('Попробуйте другой запрос.') : undefined}
        />
      )}
      <details className="social-moderation-history">
        <summary>
          {t('Локальная история модерации ·')} {history.length}
        </summary>
        {history.length ? (
          history.slice(0, 100).map((e) => (
            <div className="list-row" key={e.id}>
              <div>
                <button className="text-button" onClick={() => ctx.openUser(e.userId)}>
                  {e.displayName}
                </button>
                <p>{e.detail}</p>
                <time className="muted small">{date(e.time)}</time>
              </div>
            </div>
          ))
        ) : (
          <p className="muted small">
            {t('История действий появится после их выполнения в приложении.')}
          </p>
        )}
      </details>
      {confirm && (
        <Modal
          title={type === 'block' ? t('Снять блокировку?') : t('Снять заглушение?')}
          onClose={() => !busy && setConfirm(undefined)}
        >
          <p>{confirm.targetDisplayName || confirm.targetUserId}</p>
          <div className="social-detail-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirm(undefined)}
            >
              {t('Отмена')}
            </button>
            <button className="button primary" disabled={busy} onClick={() => void remove()}>
              {busy ? t('Выполняем…') : t('Подтвердить')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function ModerationTab() {
  const [type, setType] = useState<'block' | 'mute'>('block');
  return (
    <>
      <Segmented
        value={type}
        onChange={(v) => setType(v as typeof type)}
        items={[
          { id: 'block', label: t('Заблокированные') },
          { id: 'mute', label: t('Заглушённые') },
        ]}
      />
      <Moderations key={type} type={type} />
    </>
  );
}
export default function SocialPage() {
  useI18n();
  const [tab, setTab] = useState('friends');
  return (
    <>
      <PageHeader
        eyebrow={t('ВАШ КРУГ')}
        title="Social"
        subtitle={t('Друзья, наблюдаемые изменения и модерация')}
      />
      <Segmented
        value={tab}
        onChange={setTab}
        items={[
          { id: 'log', label: 'Friend Log' },
          { id: 'friends', label: 'Friends List' },
          { id: 'moderation', label: 'Moderation' },
        ]}
      />
      {tab === 'friends' ? <FriendsList /> : tab === 'log' ? <FriendLog /> : <ModerationTab />}
    </>
  );
}
