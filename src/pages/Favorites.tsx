import { useEffect, useState } from 'react';
import { Heart, Pencil, Plus, RefreshCw, Star, Trash2, MoveRight, UserRound, Image } from 'lucide-react';
import { api } from '../api';
import type { Avatar, Favorite, FavoriteGroup, FavoriteType, User, World } from '../api';
import { cacheFavoriteEntities, clearFavoriteEntityCache, favoriteApi, FavoriteMoveError, loadFavoriteEntity, loadFavoriteGroups, loadFavoriteWorlds, loadFavoriteAvatars } from '../api/favorites';
import type { FavoriteEntity, FavoriteVisibility } from '../api/favorites';
import { demoAvatars, demoFriends, demoWorlds } from '../demo';
import { useApp, useLoad } from '../state';
import { AvatarImage, Badge, Empty, ErrorState, imageOf, Loading, Modal, PageHeader, SearchField, Segmented } from '../components/ui';
import SecureImage from '../components/SecureImage';
import { statusName } from './Details';
import './Favorites.css';

const typeItems = [
  { id: 'friend', label: 'Друзья' }, { id: 'world', label: 'Миры' }, { id: 'avatar', label: 'Аватары' },
];
export function demoFavoriteGroups(type: FavoriteType): FavoriteGroup[] {
  return [
    { id: `${type}_demo_1`, type, name: type === 'friend' ? 'group_0' : type === 'world' ? 'worlds1' : 'avatars1', displayName: 'Избранное', visibility: 'private' },
    { id: `${type}_demo_2`, type, name: type === 'friend' ? 'group_1' : type === 'world' ? 'worlds2' : 'avatars2', displayName: 'На потом', visibility: 'private' },
  ];
}
function demoFavorites(type: FavoriteType): Favorite[] {
  const source = type === 'friend' ? demoFriends : type === 'world' ? demoWorlds : demoAvatars;
  const groups = demoFavoriteGroups(type);
  return source.map((item, index) => ({ id: `fvrt_demo_${item.id}`, type, favoriteId: item.id, tags: [groups[index % groups.length].name] }));
}

/** Reusable by Explore: the server determines how many collections are available. */
export function FavoriteCategoryPicker({ groups, value, onChange, all = true }: { groups: FavoriteGroup[]; value: string; onChange: (value: string) => void; all?: boolean }) {
  return <label className="favorite-category field">Коллекция
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Коллекция избранного">
      {all && <option value="">Все коллекции</option>}
      {groups.map((group) => <option key={`${group.type}:${group.name}`} value={group.name}>{group.displayName || group.name}</option>)}
    </select>
  </label>;
}

export default function FavoritesPage() {
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
      : await Promise.all([loadFavoriteGroups(ctx.user.id, type), favoriteApi.familyFavorites(type)]);
    const metadata = ctx.demo ? type === 'friend' ? demoFriends : type === 'world' ? demoWorlds : demoAvatars
      : type === 'friend' ? [] : type === 'world' ? await loadFavoriteWorlds(ctx.user.id, false, groups) : await loadFavoriteAvatars(ctx.user.id, false, groups);
    cacheFavoriteEntities(ctx.user.id, type, metadata);
    if (type === 'world') cacheFavoriteEntities(ctx.user.id, 'vrcPlusWorld', metadata);
    return { type, groups, favorites, metadata };
  }, [type, ctx.user.id, ctx.demo, ctx.refresh, revision]);
  const current = load.data?.type === type ? load.data : undefined;
  const groups = current?.groups || [];
  const selected = groups.find((g) => g.name === category);
  const all = current?.favorites.filter((f) => {
    if (category && !f.tags.includes(category)) return false;
    if (!search) return true;
    const entity = type === 'friend' ? ctx.friends.data.find((u) => u.id === f.favoriteId) : current.metadata.find((m) => m.id === f.favoriteId);
    const name = entity && ('displayName' in entity ? entity.displayName : entity.name);
    const author = entity && 'authorName' in entity ? entity.authorName : '';
    return `${name || ''} ${author || ''} ${f.favoriteId}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  }) || [];
  const refresh = () => { clearFavoriteEntityCache(); setRevision((v) => v + 1); };
  useEffect(() => { setVisible(18); }, [type, category, search]);
  return <>
    <PageHeader eyebrow="ВАШИ КОЛЛЕКЦИИ" title="Избранное" subtitle="Друзья, миры и аватары — все доступные категории аккаунта"
      actions={<button className="icon-button" aria-label="Обновить избранное" onClick={refresh}><RefreshCw size={18} /></button>} />
    <Segmented value={type} items={typeItems} onChange={(v) => { setType(v as typeof type); setCategory(''); setSearch(''); setManage(null); setRecovery(null); }} />
    <div className="favorite-toolbar">
      <FavoriteCategoryPicker groups={groups} value={category} onChange={setCategory} />
      <SearchField value={search} onChange={setSearch} placeholder="Поиск в избранном" />
      <button className="button secondary compact" onClick={() => setAdding(true)} disabled={!groups.length}><Plus size={16} />Добавить</button>
      {selected && <button className="icon-button" aria-label="Изменить коллекцию" onClick={() => setEdit(selected)}><Pencil size={17} /></button>}
    </div>
    {load.error && <ErrorState error={load.error} retry={refresh} />}
    {recovery && !recovery.restored && <div className="inset-panel" role="alert">
      <p>{recovery.message}</p><p className="muted small">Исходные категории: {recovery.original.tags.join(', ')} · {recovery.original.favoriteId}</p>
      <button className="button secondary" onClick={() => void ctx.act(async () => { await favoriteApi.recover(recovery.original); setRecovery(null); refresh(); }, 'Исходное избранное восстановлено')}>Проверить и восстановить</button>
      <button className="text-button" onClick={refresh}>Обновить список</button>
    </div>}
    {!current && load.loading ? <Loading /> : !all.length && !load.error ? <Empty icon={<Heart size={30} />} title={search ? 'Ничего не найдено' : 'В этой коллекции пока пусто'} text={search ? 'Попробуйте другой запрос или выберите все коллекции.' : 'Добавьте друга, мир или аватар либо выберите другую коллекцию.'} /> : <>
      <p className="muted small">{all.length} записей · {groups.length} коллекций{load.loading ? ' · обновление…' : ''}</p>
      <div className="favorites-grid">
        {all.slice(0, visible).map((entry) => <FavoriteCard key={entry.id} entry={entry} revision={revision} onManage={() => { setManage(entry); setRecovery(null); }} onAvatar={setAvatar} />)}
      </div>
      {visible < all.length && <button className="button secondary load-more" onClick={() => setVisible((v) => v + 18)}>Загрузить ещё ({all.length - visible})</button>}
      {search && <p className="muted small">Поиск по всем загруженным записям избранного: название, автор и ID.</p>}
    </>}
    {manage && <ManageFavorite entry={manage} groups={groups} onClose={() => setManage(null)} onChanged={() => { setManage(null); refresh(); }} onRecovery={setRecovery} />}
    {edit && <EditFavoriteGroup group={edit} onClose={() => setEdit(null)} onChanged={() => { setEdit(null); refresh(); }} />}
    {adding && <AddFavorite type={type} groups={groups} category={category} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); refresh(); }} />}
    {avatar && <FavoriteAvatar avatar={avatar} onClose={() => setAvatar(null)} />}
  </>;
}

function FavoriteCard({ entry, revision, onManage, onAvatar }: { entry: Favorite; revision: number; onManage: () => void; onAvatar: (avatar: Avatar) => void }) {
  const ctx = useApp();
  const liveFriend = entry.type === 'friend' ? ctx.friends.data.find((f) => f.id === entry.favoriteId) : undefined;
  const load = useLoad<FavoriteEntity>(() => {
    if (ctx.demo) {
      const items = entry.type === 'friend' ? demoFriends : entry.type === 'world' ? demoWorlds : demoAvatars;
      const value = items.find((i) => i.id === entry.favoriteId);
      if (!value) return Promise.reject(new Error('Нет демонстрационной записи.'));
      return Promise.resolve(value);
    }
    return liveFriend ? Promise.resolve(liveFriend) : loadFavoriteEntity(entry, ctx.user.id);
  }, [entry.type, entry.favoriteId, ctx.user.id, ctx.demo, revision]);
  const entity = liveFriend || load.data;
  const name = entity ? ('displayName' in entity ? entity.displayName : entity.name) : entry.favoriteId;
  const author = entity && 'authorName' in entity ? entity.authorName : undefined;
  const open = () => {
    if (entry.type === 'friend') ctx.openUser(entity as User || entry.favoriteId);
    else if (entry.type === 'world' || entry.type === 'vrcPlusWorld') ctx.openWorld(entity as World || entry.favoriteId);
    else if (entity) onAvatar(entity as Avatar);
  };
  return <article className={`card favorite-card ${entry.type}`}>
    <button className="favorite-open" onClick={open} disabled={entry.type === 'avatar' && !entity}>
      {entry.type === 'friend' ? <AvatarImage src={entity ? imageOf(entity) : undefined} name={name} size={56} status={liveFriend?.status} /> : <div className="favorite-cover"><SecureImage src={entity ? imageOf(entity) : undefined} alt="" /></div>}
      <div className="favorite-card-text"><h3>{name}</h3>{load.loading && !entity ? <span className="muted small">Загружаем карточку…</span> : entry.type === 'friend' && entity ? <><p>{(entity as User).statusDescription || statusName((entity as User).status)}</p><span className="muted small">{(entity as User).location || 'Местоположение недоступно'}</span></> : <p>{author || 'Автор не указан'}</p>}</div>
    </button>
    {load.error && !liveFriend && <div className="favorite-card-error" role="alert">{load.error}<button className="text-button" onClick={load.reload}>Повторить</button></div>}
    <div className="favorite-card-actions"><span className="muted small" title={entry.favoriteId}>{entry.favoriteId}</span><button className="icon-button" aria-label={`Управление избранным ${name}`} onClick={onManage}><Star size={17} /></button></div>
  </article>;
}

function ManageFavorite({ entry, groups, onClose, onChanged, onRecovery }: { entry: Favorite; groups: FavoriteGroup[]; onClose: () => void; onChanged: () => void; onRecovery: (error: FavoriteMoveError) => void }) {
  const ctx = useApp();
  const [destination, setDestination] = useState(groups.find((g) => !entry.tags.includes(g.name))?.name || entry.tags[0] || '');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const [error, setError] = useState('');
  const perform = (operation: () => Promise<unknown>, message: string) => void ctx.act(async () => {
    setBusy(true);
    try { await operation(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось изменить избранное.'); setRequiresRefresh(true); if (e instanceof FavoriteMoveError) onRecovery(e); throw e; }
    finally { setBusy(false); }
  }, message);
  return <Modal title="Управление избранным" onClose={onClose}>
    <div className="form-stack">
      <p className="muted small">{entry.favoriteId}</p>
      <p>Сейчас: {entry.tags.map((tag) => groups.find((g) => g.name === tag)?.displayName || tag).join(', ')}</p>
      {error && <div className="error-state" role="alert"><p>{error}</p><p>Закройте окно и обновите список перед следующей попыткой.</p></div>}
      <FavoriteCategoryPicker groups={groups} value={destination} onChange={setDestination} all={false} />
      <button className="button primary" disabled={busy || requiresRefresh || !destination || (entry.tags.length === 1 && entry.tags[0] === destination)} onClick={() => perform(() => favoriteApi.move(entry, destination, groups.find((g) => g.name === destination)?.type || entry.type), 'Избранное перемещено')}><MoveRight size={17} />Переместить</button>
      <p className="muted small">VRChat перемещает запись удалением и повторным добавлением. Если добавление отклонено, приложение попробует восстановить все исходные категории.</p>
      {!confirm ? <button className="button danger" disabled={busy || requiresRefresh} onClick={() => setConfirm(true)}><Trash2 size={16} />Удалить из избранного</button> : <div className="inset-panel"><p>Удалить эту запись из всех категорий?</p><button className="button danger" disabled={busy || requiresRefresh} onClick={() => perform(() => favoriteApi.remove(entry.id), 'Удалено из избранного')}>Подтвердить удаление</button><button className="text-button" disabled={busy} onClick={() => setConfirm(false)}>Отмена</button></div>}
    </div>
  </Modal>;
}

function EditFavoriteGroup({ group, onClose, onChanged }: { group: FavoriteGroup; onClose: () => void; onChanged: () => void }) {
  const ctx = useApp();
  const [name, setName] = useState(group.displayName);
  const [visibility, setVisibility] = useState<FavoriteVisibility>((group.visibility as FavoriteVisibility) || 'private');
  const [busy, setBusy] = useState(false);
  return <Modal title="Коллекция избранного" onClose={onClose}><form className="form-stack" onSubmit={(e) => { e.preventDefault(); void ctx.act(async () => { setBusy(true); try { await favoriteApi.updateGroup(ctx.user.id, group, name, visibility); onChanged(); } finally { setBusy(false); } }, 'Коллекция обновлена'); }}>
    <label className="field">Название<input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required /></label>
    <label className="field">Видимость<select value={visibility} onChange={(e) => setVisibility(e.target.value as FavoriteVisibility)}><option value="private">Только я</option><option value="friends">Друзья</option><option value="public">Все</option></select></label>
    <p className="muted small">Доступность изменения видимости проверяет сервер VRChat.</p><button className="button primary" disabled={busy || !name.trim()} type="submit">Сохранить коллекцию</button>
  </form></Modal>;
}

function AddFavorite({ type, groups, category, onClose, onAdded }: { type: FavoriteType; groups: FavoriteGroup[]; category: string; onClose: () => void; onAdded: () => void }) {
  const ctx = useApp();
  const [id, setId] = useState('');
  const [tag, setTag] = useState(category || groups[0]?.name || '');
  const [busy, setBusy] = useState(false);
  const prefix = type === 'friend' ? 'usr_' : type === 'world' || type === 'vrcPlusWorld' ? 'wrld_' : 'avtr_';
  return <Modal title="Добавить в избранное" onClose={onClose}><form className="form-stack" onSubmit={(e) => { e.preventDefault(); void ctx.act(async () => { if (!id.trim().startsWith(prefix)) throw new Error(`Введите ID с префиксом ${prefix}`); setBusy(true); try { await favoriteApi.add(id.trim(), groups.find((g) => g.name === tag)?.type || type, [tag]); onAdded(); } finally { setBusy(false); } }, 'Добавлено в избранное'); }}>
    <label className="field">ID {type === 'friend' ? 'друга' : type === 'world' ? 'мира' : 'аватара'}<input value={id} onChange={(e) => setId(e.target.value)} placeholder={`${prefix}…`} maxLength={128} required /></label>
    <FavoriteCategoryPicker groups={groups} value={tag} onChange={setTag} all={false} />
    <p className="muted small">Сервер проверяет доступ к объекту, вместимость коллекции и права аккаунта. Избранным другом может быть только ваш друг.</p>
    <button className="button primary" disabled={busy || !tag || !id.trim()} type="submit"><Plus size={16} />Добавить</button>
  </form></Modal>;
}

function FavoriteAvatar({ avatar, onClose }: { avatar: Avatar; onClose: () => void }) {
  const ctx = useApp();
  return <Modal title={avatar.name} onClose={onClose}><div className="form-stack">
    <SecureImage className="favorite-avatar-preview" src={imageOf(avatar)} alt={avatar.name} />
    <h2>{avatar.name}</h2><p>{avatar.description || 'Описание не предоставлено.'}</p>
    <button className="text-button" disabled={!avatar.authorId} onClick={() => { if (avatar.authorId) { onClose(); ctx.openUser(avatar.authorId); } }}><UserRound size={16} />{avatar.authorName || avatar.authorId || 'Автор неизвестен'}</button>
    <div className="chips">{avatar.releaseStatus && <Badge>{avatar.releaseStatus}</Badge>}{avatar.unityPackages?.some((p) => p.platform === 'android') && <Badge>Android</Badge>}</div>
    <p className="muted small">{avatar.id}</p><button className="button primary" disabled={ctx.user.currentAvatar === avatar.id} onClick={() => void ctx.act(async () => { await api.selectAvatar(avatar.id); ctx.onUserUpdated({...ctx.user,currentAvatar:avatar.id}); }, 'Аватар выбран')}><Image size={16} />{ctx.user.currentAvatar === avatar.id ? 'Уже выбран' : 'Выбрать аватар'}</button>
  </div></Modal>;
}
