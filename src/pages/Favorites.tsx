import type { UiMessage } from '../i18n';
import { uiMessage } from '../i18n';
import { t, useI18n } from '../i18n';
import { useEffect, useState } from 'react';
import {
  Heart,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  MoveRight,
  UserRound,
  Image,
} from 'lucide-react';
import { api } from '../api';
import type { Avatar, Favorite, FavoriteGroup, FavoriteType, User, World } from '../api';
import {
  cacheFavoriteEntities,
  clearFavoriteEntityCache,
  favoriteApi,
  FavoriteMoveError,
  loadFavoriteEntity,
  loadFavoriteGroups,
  loadFavoriteWorlds,
  loadFavoriteAvatars,
} from '../api/favorites';
import type { FavoriteEntity, FavoriteVisibility } from '../api/favorites';
import { demoAvatars, demoFriends, demoWorlds } from '../demo';
import { useApp, useLoad } from '../state';
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
import SecureImage from '../components/SecureImage';
import { statusName } from './Details';
import { refreshFriendFavorites } from '../data/favorite-friends';
import './Favorites.css';

const typeItems = [
  { id: 'friend', label: 'Друзья' },
  { id: 'world', label: 'Миры' },
  { id: 'avatar', label: 'Аватары' },
];
export function demoFavoriteGroups(type: FavoriteType): FavoriteGroup[] {
  return [
    {
      id: `${type}_demo_1`,
      type,
      name: type === 'friend' ? 'group_0' : type === 'world' ? 'worlds1' : 'avatars1',
      displayName: t('Избранное'),
      visibility: 'private',
    },
    {
      id: `${type}_demo_2`,
      type,
      name: type === 'friend' ? 'group_1' : type === 'world' ? 'worlds2' : 'avatars2',
      displayName: t('На потом'),
      visibility: 'private',
    },
  ];
}
function demoFavorites(type: FavoriteType): Favorite[] {
  const source = type === 'friend' ? demoFriends : type === 'world' ? demoWorlds : demoAvatars;
  const groups = demoFavoriteGroups(type);
  return source.map((item, index) => ({
    id: `fvrt_demo_${item.id}`,
    type,
    favoriteId: item.id,
    tags: [groups[index % groups.length].name],
  }));
}

/** Reusable by Explore: the server determines how many collections are available. */
export function FavoriteCategoryPicker({
  groups,
  value,
  onChange,
  all = true,
}: {
  groups: FavoriteGroup[];
  value: string;
  onChange: (value: string) => void;
  all?: boolean;
}) {
  return (
    <label className="favorite-category field">
      {t('Коллекция')}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('Коллекция избранного')}
      >
        {all && <option value="">{t('Все коллекции')}</option>}
        {groups.map((group) => (
          <option key={`${group.type}:${group.name}`} value={group.name}>
            {group.displayName || group.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function FavoritesPage() {
  useI18n();
  const ctx = useApp();
  const [type, setType] = useState<'friend' | 'world' | 'avatar'>('friend');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(18);
  const [revision, setRevision] = useState(0);
  const [manage, setManage] = useState<Favorite | null>(null);
  const [edit, setEdit] = useState<FavoriteGroup | null>(null);
  const [adding, setAdding] = useState(false);
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [recovery, setRecovery] = useState<FavoriteMoveError | null>(null);
  const load = useLoad(async () => {
    const [groups, favorites] = ctx.demo
      ? [demoFavoriteGroups(type), demoFavorites(type)]
      : await Promise.all([
          loadFavoriteGroups(ctx.user.id, type),
          favoriteApi.familyFavorites(type),
        ]);
    const metadata = ctx.demo
      ? type === 'friend'
        ? demoFriends
        : type === 'world'
          ? demoWorlds
          : demoAvatars
      : type === 'friend'
        ? []
        : type === 'world'
          ? await loadFavoriteWorlds(ctx.user.id, false, groups)
          : await loadFavoriteAvatars(ctx.user.id, false, groups);
    cacheFavoriteEntities(ctx.user.id, type, metadata);
    if (type === 'world') cacheFavoriteEntities(ctx.user.id, 'vrcPlusWorld', metadata);
    return { type, groups, favorites, metadata };
  }, [type, ctx.user.id, ctx.demo, ctx.refresh, revision]);
  const current = load.data?.type === type ? load.data : undefined;
  const groups = current?.groups || [];
  const selected = groups.find((g) => g.name === category);
  const all =
    current?.favorites.filter((f) => {
      if (category && !f.tags.includes(category)) return false;
      if (!search) return true;
      const entity =
        type === 'friend'
          ? ctx.friends.data.find((u) => u.id === f.favoriteId)
          : current.metadata.find((m) => m.id === f.favoriteId);
      const name = entity && ('displayName' in entity ? entity.displayName : entity.name);
      const author = entity && 'authorName' in entity ? entity.authorName : '';
      return `${name || ''} ${author || ''} ${f.favoriteId}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase());
    }) || [];
  const refresh = () => {
    clearFavoriteEntityCache();
    if (type === 'friend') void refreshFriendFavorites(ctx.user.id, ctx.demo);
    setRevision((v) => v + 1);
  };
  useEffect(() => {
    setVisible(18);
  }, [type, category, search]);
  return (
    <>
      <PageHeader
        eyebrow={t('ВАШИ КОЛЛЕКЦИИ')}
        title={t('Избранное')}
        subtitle={t('Друзья, миры и аватары — все доступные категории аккаунта')}
        actions={
          <button className="icon-button" aria-label={t('Обновить избранное')} onClick={refresh}>
            <RefreshCw size={18} />
          </button>
        }
      />
      <Segmented
        value={type}
        items={typeItems.map((item) => ({ ...item, label: t(item.label) }))}
        onChange={(v) => {
          setType(v as typeof type);
          setCategory('');
          setSearch('');
          setManage(null);
          setRecovery(null);
        }}
      />
      <div className="favorite-toolbar">
        <FavoriteCategoryPicker groups={groups} value={category} onChange={setCategory} />
        <SearchField value={search} onChange={setSearch} placeholder={t('Поиск в избранном')} />
        <button
          className="button secondary compact"
          onClick={() => setAdding(true)}
          disabled={!groups.length}
        >
          <Plus size={16} />
          {t('Добавить')}
        </button>
        {selected && (
          <button
            className="icon-button"
            aria-label={t('Изменить коллекцию')}
            onClick={() => setEdit(selected)}
          >
            <Pencil size={17} />
          </button>
        )}
      </div>
      {load.error && <ErrorState error={load.error} retry={refresh} />}
      {recovery && !recovery.restored && (
        <div className="inset-panel" role="alert">
          <p>{recovery.message}</p>
          <p className="muted small">
            {t('Исходные категории:')} {recovery.original.tags.join(', ')} ·{' '}
            {recovery.original.favoriteId}
          </p>
          <button
            className="button secondary"
            onClick={() =>
              void ctx.act(async () => {
                await favoriteApi.recover(recovery.original);
                setRecovery(null);
                refresh();
              }, uiMessage('Исходное избранное восстановлено'))
            }
          >
            {t('Проверить и восстановить')}
          </button>
          <button className="text-button" onClick={refresh}>
            {t('Обновить список')}
          </button>
        </div>
      )}
      {!current && load.loading ? (
        <Loading />
      ) : !all.length && !load.error ? (
        <Empty
          icon={<Heart size={30} />}
          title={search ? t('Ничего не найдено') : t('В этой коллекции пока пусто')}
          text={
            search
              ? t('Попробуйте другой запрос или выберите все коллекции.')
              : t('Добавьте друга, мир или аватар либо выберите другую коллекцию.')
          }
        />
      ) : (
        <>
          <p className="muted small">
            {all.length} {t('записей ·')} {groups.length} {t('коллекций')}
            {load.loading ? t(' · обновление…') : ''}
          </p>
          <div className="favorites-grid">
            {all.slice(0, visible).map((entry) => (
              <FavoriteCard
                key={entry.id}
                entry={entry}
                revision={revision}
                onManage={() => {
                  setManage(entry);
                  setRecovery(null);
                }}
                onAvatar={setAvatar}
              />
            ))}
          </div>
          {visible < all.length && (
            <button
              className="button secondary load-more"
              onClick={() => setVisible((v) => v + 18)}
            >
              {t('Загрузить ещё (')}
              {all.length - visible})
            </button>
          )}
          {search && (
            <p className="muted small">
              {t('Поиск по всем загруженным записям избранного: название, автор и ID.')}
            </p>
          )}
        </>
      )}
      {manage && (
        <ManageFavorite
          entry={manage}
          groups={groups}
          onClose={() => setManage(null)}
          onChanged={() => {
            setManage(null);
            refresh();
          }}
          onRecovery={setRecovery}
        />
      )}
      {edit && (
        <EditFavoriteGroup
          group={edit}
          onClose={() => setEdit(null)}
          onChanged={() => {
            setEdit(null);
            refresh();
          }}
        />
      )}
      {adding && (
        <AddFavorite
          type={type}
          groups={groups}
          category={category}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}
      {avatar && <FavoriteAvatar avatar={avatar} onClose={() => setAvatar(null)} />}
    </>
  );
}

function FavoriteCard({
  entry,
  revision,
  onManage,
  onAvatar,
}: {
  entry: Favorite;
  revision: number;
  onManage: () => void;
  onAvatar: (avatar: Avatar) => void;
}) {
  const ctx = useApp();
  const liveFriend =
    entry.type === 'friend' ? ctx.friends.data.find((f) => f.id === entry.favoriteId) : undefined;
  const load = useLoad<FavoriteEntity>(() => {
    if (ctx.demo) {
      const items =
        entry.type === 'friend' ? demoFriends : entry.type === 'world' ? demoWorlds : demoAvatars;
      const value = items.find((i) => i.id === entry.favoriteId);
      if (!value) return Promise.reject(new Error(t('Нет демонстрационной записи.')));
      return Promise.resolve(value);
    }
    return liveFriend ? Promise.resolve(liveFriend) : loadFavoriteEntity(entry, ctx.user.id);
  }, [entry.type, entry.favoriteId, ctx.user.id, ctx.demo, revision]);
  const entity = liveFriend || load.data;
  const name = entity
    ? 'displayName' in entity
      ? entity.displayName
      : entity.name
    : entry.favoriteId;
  const author = entity && 'authorName' in entity ? entity.authorName : undefined;
  const open = () => {
    if (entry.type === 'friend') ctx.openUser((entity as User) || entry.favoriteId);
    else if (entry.type === 'world' || entry.type === 'vrcPlusWorld')
      ctx.openWorld((entity as World) || entry.favoriteId);
    else if (entity) onAvatar(entity as Avatar);
  };
  return (
    <article className={`card favorite-card ${entry.type}`}>
      <button
        className="favorite-open"
        onClick={open}
        disabled={entry.type === 'avatar' && !entity}
      >
        {entry.type === 'friend' ? (
          <AvatarImage
            src={entity ? imageOf(entity) : undefined}
            name={name}
            size={56}
            user={liveFriend || (entity as User | undefined)}
            fallbackSrc={(entity as User | undefined)?.currentAvatarThumbnailImageUrl}
          />
        ) : (
          <div className="favorite-cover">
            <SecureImage src={entity ? imageOf(entity) : undefined} alt="" />
          </div>
        )}
        <div className="favorite-card-text">
          <h3>{name}</h3>
          {load.loading && !entity ? (
            <span className="muted small">{t('Загружаем карточку…')}</span>
          ) : entry.type === 'friend' && entity ? (
            <>
              <p>{(entity as User).statusDescription || t(statusName((entity as User).status))}</p>
              <span className="muted small">
                {(entity as User).location || t('Местоположение недоступно')}
              </span>
            </>
          ) : (
            <p>{author || t('Автор не указан')}</p>
          )}
        </div>
      </button>
      {load.error && !liveFriend && (
        <div className="favorite-card-error" role="alert">
          {load.error}
          <button className="text-button" onClick={load.reload}>
            {t('Повторить')}
          </button>
        </div>
      )}
      <div className="favorite-card-actions">
        <span className="muted small" title={entry.favoriteId}>
          {entry.favoriteId}
        </span>
        <button
          className="icon-button"
          aria-label={t('Управление избранным {value0}', { value0: String(name) })}
          onClick={onManage}
        >
          <Star size={17} />
        </button>
      </div>
    </article>
  );
}

function ManageFavorite({
  entry,
  groups,
  onClose,
  onChanged,
  onRecovery,
}: {
  entry: Favorite;
  groups: FavoriteGroup[];
  onClose: () => void;
  onChanged: () => void;
  onRecovery: (error: FavoriteMoveError) => void;
}) {
  const ctx = useApp();
  const [destination, setDestination] = useState(
    groups.find((g) => !entry.tags.includes(g.name))?.name || entry.tags[0] || '',
  );
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const [error, setError] = useState('');
  const perform = (operation: () => Promise<unknown>, message: UiMessage) =>
    void ctx.act(async () => {
      setBusy(true);
      try {
        await operation();
        onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : t('Не удалось изменить избранное.'));
        setRequiresRefresh(true);
        if (e instanceof FavoriteMoveError) onRecovery(e);
        throw e;
      } finally {
        setBusy(false);
      }
    }, message);
  return (
    <Modal title={t('Управление избранным')} onClose={onClose}>
      <div className="form-stack">
        <p className="muted small">{entry.favoriteId}</p>
        <p>
          {t('Сейчас:')}{' '}
          {entry.tags
            .map((tag) => groups.find((g) => g.name === tag)?.displayName || tag)
            .join(', ')}
        </p>
        {error && (
          <div className="error-state" role="alert">
            <p>{error}</p>
            <p>{t('Закройте окно и обновите список перед следующей попыткой.')}</p>
          </div>
        )}
        <FavoriteCategoryPicker
          groups={groups}
          value={destination}
          onChange={setDestination}
          all={false}
        />
        <button
          className="button primary"
          disabled={
            busy ||
            requiresRefresh ||
            !destination ||
            (entry.tags.length === 1 && entry.tags[0] === destination)
          }
          onClick={() =>
            perform(
              () =>
                favoriteApi.move(
                  entry,
                  destination,
                  groups.find((g) => g.name === destination)?.type || entry.type,
                ),
              uiMessage('Избранное перемещено'),
            )
          }
        >
          <MoveRight size={17} />
          {t('Переместить')}
        </button>
        <p className="muted small">
          {t(
            'VRChat перемещает запись удалением и повторным добавлением. Если добавление отклонено, приложение попробует восстановить все исходные категории.',
          )}
        </p>
        {!confirm ? (
          <button
            className="button danger"
            disabled={busy || requiresRefresh}
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={16} />
            {t('Удалить из избранного')}
          </button>
        ) : (
          <div className="inset-panel">
            <p>{t('Удалить эту запись из всех категорий?')}</p>
            <button
              className="button danger"
              disabled={busy || requiresRefresh}
              onClick={() =>
                perform(() => favoriteApi.remove(entry.id), uiMessage('Удалено из избранного'))
              }
            >
              {t('Подтвердить удаление')}
            </button>
            <button className="text-button" disabled={busy} onClick={() => setConfirm(false)}>
              {t('Отмена')}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function EditFavoriteGroup({
  group,
  onClose,
  onChanged,
}: {
  group: FavoriteGroup;
  onClose: () => void;
  onChanged: () => void;
}) {
  const ctx = useApp();
  const [name, setName] = useState(group.displayName);
  const [visibility, setVisibility] = useState<FavoriteVisibility>(
    (group.visibility as FavoriteVisibility) || 'private',
  );
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={t('Коллекция избранного')} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void ctx.act(async () => {
            setBusy(true);
            try {
              await favoriteApi.updateGroup(ctx.user.id, group, name, visibility);
              onChanged();
            } finally {
              setBusy(false);
            }
          }, uiMessage('Коллекция обновлена'));
        }}
      >
        <label className="field">
          {t('Название')}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required />
        </label>
        <label className="field">
          {t('Видимость')}
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as FavoriteVisibility)}
          >
            <option value="private">{t('Только я')}</option>
            <option value="friends">{t('Друзья')}</option>
            <option value="public">{t('Все')}</option>
          </select>
        </label>
        <p className="muted small">
          {t('Доступность изменения видимости проверяет сервер VRChat.')}
        </p>
        <button className="button primary" disabled={busy || !name.trim()} type="submit">
          {t('Сохранить коллекцию')}
        </button>
      </form>
    </Modal>
  );
}

function AddFavorite({
  type,
  groups,
  category,
  onClose,
  onAdded,
}: {
  type: FavoriteType;
  groups: FavoriteGroup[];
  category: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const ctx = useApp();
  const [id, setId] = useState('');
  const [tag, setTag] = useState(category || groups[0]?.name || '');
  const [busy, setBusy] = useState(false);
  const prefix =
    type === 'friend' ? 'usr_' : type === 'world' || type === 'vrcPlusWorld' ? 'wrld_' : 'avtr_';
  return (
    <Modal title={t('Добавить в избранное')} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void ctx.act(async () => {
            if (!id.trim().startsWith(prefix))
              throw new Error(t('Введите ID с префиксом {value0}', { value0: String(prefix) }));
            setBusy(true);
            try {
              await favoriteApi.add(id.trim(), groups.find((g) => g.name === tag)?.type || type, [
                tag,
              ]);
              onAdded();
            } finally {
              setBusy(false);
            }
          }, uiMessage('Добавлено в избранное'));
        }}
      >
        <label className="field">
          {type === 'friend' ? t('ID друга') : type === 'world' ? t('ID мира') : t('ID аватара')}
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder={`${prefix}…`}
            maxLength={128}
            required
          />
        </label>
        <FavoriteCategoryPicker groups={groups} value={tag} onChange={setTag} all={false} />
        <p className="muted small">
          {t(
            'Сервер проверяет доступ к объекту, вместимость коллекции и права аккаунта. Избранным другом может быть только ваш друг.',
          )}
        </p>
        <button className="button primary" disabled={busy || !tag || !id.trim()} type="submit">
          <Plus size={16} />
          {t('Добавить')}
        </button>
      </form>
    </Modal>
  );
}

function FavoriteAvatar({ avatar, onClose }: { avatar: Avatar; onClose: () => void }) {
  const ctx = useApp();
  return (
    <Modal title={avatar.name} onClose={onClose}>
      <div className="form-stack">
        <SecureImage className="favorite-avatar-preview" src={imageOf(avatar)} alt={avatar.name} />
        <h2>{avatar.name}</h2>
        <p>{avatar.description || t('Описание не предоставлено.')}</p>
        <button
          className="text-button"
          disabled={!avatar.authorId}
          onClick={() => {
            if (avatar.authorId) {
              onClose();
              ctx.openUser(avatar.authorId);
            }
          }}
        >
          <UserRound size={16} />
          {avatar.authorName || avatar.authorId || t('Автор неизвестен')}
        </button>
        <div className="chips">
          {avatar.releaseStatus && <Badge>{avatar.releaseStatus}</Badge>}
          {avatar.unityPackages?.some((p) => p.platform === 'android') && <Badge>Android</Badge>}
        </div>
        <p className="muted small">{avatar.id}</p>
        <button
          className="button primary"
          disabled={ctx.user.currentAvatar === avatar.id}
          onClick={() =>
            void ctx.act(async () => {
              await api.selectAvatar(avatar.id);
              ctx.onUserUpdated({ ...ctx.user, currentAvatar: avatar.id });
            }, uiMessage('Аватар выбран'))
          }
        >
          <Image size={16} />
          {ctx.user.currentAvatar === avatar.id ? t('Уже выбран') : t('Выбрать аватар')}
        </button>
      </div>
    </Modal>
  );
}
