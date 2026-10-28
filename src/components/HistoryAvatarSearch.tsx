import { t, useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { api, ApiError } from '../api';
import type { Avatar } from '../api';
import { AppProvider, useApp } from '../state';
import { AvatarDetail } from '../pages/Explore';
import SecureImage from './SecureImage';
import { Badge, Empty, Loading, Modal, imageOf } from './ui';
import './HistoryAvatarSearch.css';

type SearchTarget = { query: string; label: string; avatarId?: string };
const pageSize = 20;
let retryAvatarDbAt = 0;

function searchTarget(
  name: string | undefined,
  avatarId: string | undefined,
): SearchTarget | undefined {
  const label = name?.trim() || avatarId?.trim();
  if (!label) return;
  const id =
    typeof avatarId === 'string' &&
    /^avtr_[A-Za-z0-9_-]+$/.test(avatarId.trim()) &&
    avatarId.trim().length <= 100
      ? avatarId.trim()
      : undefined;
  const query = name?.trim() && name.trim().length <= 100 ? name.trim() : id;
  return query ? { query, label, avatarId: id } : undefined;
}

/** The third-party search is requested only after the person presses an avatar name. */
export function HistoryAvatarSearch({ name, avatarId }: { name?: string; avatarId?: string }) {
  useI18n();
  const ctx = useApp();
  const target = searchTarget(name, avatarId);
  const label = name?.trim() || avatarId?.trim();
  const [opened, setOpened] = useState<SearchTarget>();
  useEffect(() => {
    setOpened(undefined);
  }, [ctx.user.id]);
  if (!label) return null;
  const unavailable = ctx.demo
    ? t('Поиск в AvatarDB доступен после входа в аккаунт.')
    : !ctx.online
      ? t('Для поиска в AvatarDB нужно подключение к интернету.')
      : !target
        ? t('Для поиска нужно название до 100 символов или известный ID аватара.')
        : '';
  return (
    <span className="history-avatar-search">
      <button
        className="text-button history-avatar-search-trigger"
        disabled={!!unavailable}
        aria-label={t('Найти аватар {p0} в AvatarDB', { p0: String(label) })}
        title={unavailable || t('Найти в AvatarDB')}
        onClick={() => {
          if (target) setOpened(target);
        }}
      >
        <span>{label}</span>
        <Search size={15} aria-hidden="true" />
      </button>
      {unavailable && <small className="muted">{unavailable}</small>}
      {opened && <AvatarSearchDialog target={opened} onClose={() => setOpened(undefined)} />}
    </span>
  );
}

function AvatarSearchDialog({ target, onClose }: { target: SearchTarget; onClose: () => void }) {
  useI18n();
  const ctx = useApp();
  const [items, setItems] = useState<Avatar[]>([]);
  const [loading, setLoading] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false),
    [nextPage, setNextPage] = useState(0);
  const [error, setError] = useState(''),
    [failedPage, setFailedPage] = useState(0);
  const [selected, setSelected] = useState<Avatar>();
  const [layer] = useState(() => 110 + document.querySelectorAll('[role="dialog"]').length);
  const [retryAt, setRetryAt] = useState(retryAvatarDbAt),
    [now, setNow] = useState(Date.now());
  const generation = useRef(0),
    live = useRef(true),
    busy = useRef(false);
  const owner = useRef(ctx.user.id);
  owner.current = ctx.user.id;
  useEffect(() => {
    live.current = true;
    void load(0);
    return () => {
      live.current = false;
      generation.current++;
    };
  }, [target.query, ctx.user.id]);
  useEffect(() => {
    if (!retryAt || now >= retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt, now >= retryAt]);

  async function load(page: number) {
    if (busy.current || ctx.demo || !ctx.online) return;
    if (Date.now() < retryAvatarDbAt) {
      setRetryAt(retryAvatarDbAt);
      setNow(Date.now());
      setFailedPage(page);
      setError(t('AvatarDB ограничила частоту поиска. Дождитесь окончания паузы.'));
      return;
    }
    const current = ++generation.current,
      account = ctx.user.id;
    busy.current = true;
    setLoading(true);
    setError('');
    setFailedPage(page);
    try {
      const results = await api.searchPublicAvatars(target.query, page);
      if (!live.current || current !== generation.current || owner.current !== account) return;
      setItems((previous) => [
        ...new Map(
          [...(page ? previous : []), ...results].map((avatar) => [avatar.id, avatar]),
        ).values(),
      ]);
      setHasMore(results.length >= pageSize && page < 10000);
      setNextPage(page + 1);
      setLoaded(true);
    } catch (failure) {
      if (!live.current || current !== generation.current || owner.current !== account) return;
      setError(
        failure instanceof Error ? failure.message : t('Не удалось выполнить поиск в AvatarDB.'),
      );
      if (failure instanceof ApiError && failure.status === 429) {
        const seconds =
          typeof failure.retryAfter === 'number' && Number.isFinite(failure.retryAfter)
            ? Math.max(1, failure.retryAfter)
            : 60;
        retryAvatarDbAt = Date.now() + seconds * 1000;
        setRetryAt(retryAvatarDbAt);
        setNow(Date.now());
      }
    } finally {
      // The request remains physically in flight after close, but can no longer update this dialog.
      busy.current = false;
      if (live.current && current === generation.current && owner.current === account)
        setLoading(false);
    }
  }

  const waiting = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const sorted = [...items].sort(
    (a, b) => Number(b.id === target.avatarId) - Number(a.id === target.avatarId),
  );
  // History also appears inside a profile. Escape the scrolling/container-query
  // parent and keep this nested search above whichever modal opened it.
  return createPortal(
    <div className="history-avatar-search-host" style={{ zIndex: layer }}>
      <Modal
        title={t('Поиск аватара в AvatarDB')}
        onClose={onClose}
        wide
        className="history-avatar-search-dialog"
      >
        <p className="history-avatar-query">{target.label}</p>
        <p className="muted small">
          {t(
            'Поиск в avtrdb.com. Название или ID передаётся этой базе. Совпадение имени не подтверждает совпадение аватара.',
          )}
        </p>
        {error && (
          <div className="history-avatar-search-error" role="alert">
            <p>{error}</p>
            <button
              className="button secondary compact"
              disabled={loading || waiting > 0 || !ctx.online}
              onClick={() => void load(failedPage)}
            >
              {waiting
                ? t('Повторить через {p0} сек.', { p0: String(waiting) })
                : t('Повторить поиск')}
            </button>
          </div>
        )}
        {loading && <Loading />}
        <div className="history-avatar-results" role="list" aria-label={t('Результаты AvatarDB')}>
          {sorted.map((avatar) => (
            <div role="listitem" key={avatar.id}>
              <button
                className="history-avatar-result"
                aria-label={t('Открыть аватар {p0}', { p0: String(avatar.name) })}
                onClick={() => setSelected(avatar)}
              >
                <SecureImage src={imageOf(avatar)} alt="" maxDimension={256} />
                <span>
                  <strong>{avatar.name}</strong>
                  {avatar.authorName && <small>{avatar.authorName}</small>}
                  {avatar.id === target.avatarId && <Badge>{t('ID совпадает')}</Badge>}
                </span>
              </button>
            </div>
          ))}
        </div>
        {loaded && !loading && !error && !items.length && (
          <Empty
            title={t('В AvatarDB нет совпадений')}
            text={t('База может не содержать этот аватар.')}
          />
        )}
        {hasMore && !error && (
          <button
            className="button secondary load-more"
            disabled={loading || waiting > 0 || !ctx.online}
            onClick={() => void load(nextPage)}
          >
            {t('Загрузить ещё')}
          </button>
        )}
      </Modal>
      {selected && (
        <AppProvider
          value={{
            ...ctx,
            openUser: (user) => {
              onClose();
              ctx.openUser(user);
            },
          }}
        >
          <AvatarDetail initial={selected} onClose={() => setSelected(undefined)} />
        </AppProvider>
      )}
    </div>,
    document.body,
  );
}
