import SecureImage, { useSecureImage } from '../components/SecureImage';
import { useEffect, useRef, useState } from 'react';
import {
  Users,
  Globe2,
  Heart,
  Send,
  UserPlus,
  MessageSquare,
  Shield,
  MapPin,
  Copy,
  ExternalLink,
  Check,
  Flag,
  Star,
} from 'lucide-react';
import { api, native } from '../api';
import { mergePublicProfile, readPublicProfile } from '../api/profile';
import { loadFavoriteGroups } from '../api/favorites';
import WorldInstances from '../components/WorldInstances';
import InstanceCreator from '../components/InstanceCreator';
import InstanceInviteDialog from '../components/InstanceInviteDialog';
import FriendFavoriteButton from '../components/FriendFavoriteButton';
import BoopPicker from '../components/BoopPicker';
import type { KnownInstance } from '../data/world-instances';
import { instanceCount } from '../data/instance-location';
import { overlayLiveUser, presenceIndicator } from '../data/presence';
import { accessibleLocation } from '../data/locations';
import type { User, World, FavoriteGroup } from '../api';
import { useApp, useLoad } from '../state';
import { demoFriends, demoWorlds, demoGroups } from '../demo';
import {
  ProfileInformation,
  UserProfileTabs,
  userProfileTabs,
} from '../components/UserProfileTabs';
import {
  Modal,
  AvatarImage,
  PresenceIndicator,
  Loading,
  ErrorState,
  Badge,
  imageOf,
  Empty,
  Segmented,
} from '../components/ui';
export const statusName = (s?: string) =>
  ({
    'join me': 'Заходите',
    active: 'В сети',
    'ask me': 'Спросите меня',
    busy: 'Не беспокоить',
    offline: 'Не в сети',
  })[s || ''] || 'В сети';
export function rankOf(tags?: string[]) {
  if (!tags) return 'Неизвестен';
  return tags.includes('system_trust_veteran')
    ? 'Trusted'
    : tags.includes('system_trust_trusted')
      ? 'Known'
      : tags.includes('system_trust_known')
        ? 'User'
        : tags.includes('system_trust_basic')
          ? 'New User'
          : 'Visitor';
}
function FavoritePicker({
  id,
  type,
  onClose,
}: {
  id: string;
  type: 'friend' | 'world';
  onClose: () => void;
}) {
  const { user, demo, act } = useApp();
  const groups = useLoad<FavoriteGroup[]>(
    () =>
      demo
        ? Promise.resolve([
            { name: type === 'friend' ? 'group_0' : 'worlds1', displayName: 'Избранное', type },
          ])
        : loadFavoriteGroups(user.id, type),
    [id, type, demo, user.id],
  );
  return (
    <div className="inset-panel">
      <h3>Коллекция избранного</h3>
      {groups.loading ? (
        <Loading />
      ) : groups.error ? (
        <ErrorState error={groups.error} retry={groups.reload} />
      ) : groups.data?.length ? (
        groups.data.map((g) => (
          <button
            className="list-row"
            key={`${g.type}:${g.name}`}
            onClick={() =>
              void act(async () => {
                await api.addFavorite(id, g.type, g.name);
                onClose();
              }, 'Добавлено в избранное')
            }
          >
            <Star size={17} />
            {g.displayName || g.name}
          </button>
        ))
      ) : (
        <Empty text="Нет доступных коллекций VRChat." />
      )}
      <button className="text-button" onClick={onClose}>
        Отмена
      </button>
    </div>
  );
}
export function UserDetails({ target, onClose }: { target: User | string; onClose: () => void }) {
  const id = typeof target === 'string' ? target : target.id;
  // A different target gets a different loader and form, never retained data from the last profile.
  return <UserDetailsContent key={id} id={id} onClose={onClose} />;
}
function UserDetailsContent({ id, onClose }: { id: string; onClose: () => void }) {
  const ctx = useApp(),
    isSelf = ctx.user.id === id;
  const load = useLoad(
    () =>
      (ctx.demo
        ? Promise.resolve(demoFriends.find((x) => x.id === id) || ctx.user)
        : api.user(id)
      ).then((user) => {
        if (user.id !== id) throw new Error('VRChat не вернул запрошенного пользователя.');
        return user;
      }),
    [id, ctx.refresh],
  );
  const profile = useLoad(
    () =>
      ctx.demo
        ? Promise.resolve({
            bio: '',
            ...demoFriends.find((x) => x.id === id),
            ...(id === ctx.user.id ? ctx.user : {}),
          })
        : api.userProfile(id).then((value) => readPublicProfile(value, id)),
    [id],
  );
  const liveUser = isSelf ? ctx.user : ctx.friends.data.find((friend) => friend.id === id);
  const baseline = useRef<{ profile?: User; friend?: User }>({});
  if (baseline.current.profile !== load.data) baseline.current = { profile: load.data, friend: liveUser };
  const u = load.data && overlayLiveUser(mergePublicProfile(load.data, profile.data), baseline.current.friend, liveUser);
  const banner = useSecureImage(u?.profileBannerUrl);
  const [tab, setTab] = useState('profile'),
    [note, setNote] = useState(''),
    [confirm, setConfirm] = useState(''),
    [boopOpen, setBoopOpen] = useState(false);
  useEffect(() => {
    if (!ctx.demo && load.data && profile.data && !load.error && !profile.error)
      ctx.history.observeProfile(mergePublicProfile(load.data, profile.data));
  }, [load.data, profile.data, load.error, profile.error, ctx.demo, ctx.history.observeProfile]);
  useEffect(() => {
    setNote(u?.note || '');
  }, [u?.id, u?.note]);
  const invite = (user: User) =>
    void ctx.act(() => api.invite(user.id, ctx.user.location || ''), 'Приглашение отправлено');
  return (
    <Modal title="Профиль" onClose={onClose} wide>
      {load.loading && !u ? (
        <Loading />
      ) : load.error ? (
        <ErrorState error={load.error} retry={load.reload} />
      ) : (
        u && (
          <>
            <div
              className="profile-banner"
              style={
                banner ? { backgroundImage: `url("${banner.replaceAll('"', '%22')}")` } : undefined
              }
            />
            <div className="profile-identity">
              <AvatarImage src={imageOf(u)} name={u.displayName} size={84} user={u} fallbackSrc={u.currentAvatarThumbnailImageUrl || u.currentAvatarImageUrl} />
              <div>
                <h2>{u.displayName}</h2>
                <div className="chips">
                  <Badge className="rank">{rankOf(u.tags)}</Badge>
                  {u.ageVerificationStatus === 'verified' && <Badge>18+ подтверждено</Badge>}
                </div>
              </div>
            </div>
            <p className="status-line">
              <PresenceIndicator user={u} />
              {presenceIndicator(u).label} {u.pronouns && `· ${u.pronouns}`}
            </p>
            {u.statusDescription && <p className="status-description">{u.statusDescription}</p>}
            <div className="detail-actions">
              <button className="button primary" disabled={!accessibleLocation(ctx.user.location)} onClick={() => invite(u)}>
                <Send size={16} />
                Пригласить друга
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  void ctx.act(() => api.requestInvite(u.id), 'Запрос приглашения отправлен')
                }
              >
                <MessageSquare size={16} />
                Попросить инвайт
              </button>
              {!u.isFriend && !isSelf && (
                <button
                  className="button secondary"
                  onClick={() =>
                    void ctx.act(() => api.friendRequest(u.id), 'Заявка в друзья отправлена')
                  }
                >
                  <UserPlus size={16} />
                  Добавить
                </button>
              )}
              {(u.isFriend || u.friendKey) && u.id !== ctx.user.id && (
                <button className="button secondary" onClick={() => setBoopOpen(true)}>Boop</button>
              )}
              {!isSelf && <FriendFavoriteButton user={u} />}
            </div>
            {boopOpen && <BoopPicker target={u} onClose={() => setBoopOpen(false)} />}
            <Segmented value={tab} onChange={setTab} items={userProfileTabs} />
            <div className="form-stack user-profile-panel" hidden={tab !== 'profile'}>
              {profile.loading && typeof u.bio !== 'string' ? (
                <Loading />
              ) : (
                <>
                  {profile.error && <ErrorState error={profile.error} retry={profile.reload} />}
                  {typeof u.bio === 'string' ? (
                    <p className="preserve-lines">
                      {u.bio.trim() ? u.bio : 'Описание пока не добавлено.'}
                    </p>
                  ) : !profile.error ? (
                    <p className="muted">VRChat не передал биографию в публичном профиле.</p>
                  ) : null}
                </>
              )}
              {u.bioLinks?.map((link) => (
                <button
                  key={link}
                  className="link-row"
                  onClick={() => void ctx.act(() => native.openLink({ url: link }))}
                >
                  <ExternalLink size={15} />
                  {link}
                </button>
              ))}
              <div className="chips">{u.languages?.map((l) => <Badge key={l}>{l}</Badge>)}</div>
              <ProfileInformation user={u} profile={profile.data} />
              <label className="field">
                Личная заметка
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={256}
                  placeholder="Видна только вам"
                />
              </label>
              <button
                className="button secondary"
                onClick={() => void ctx.act(() => api.note(id, note), 'Заметка сохранена')}
              >
                Сохранить заметку
              </button>
              <div className="divider" />
              <h3>Управление</h3>
              <div className="detail-actions">
                <button className="button secondary" onClick={() => setConfirm('mute')}>
                  Заглушить
                </button>
                <button className="button danger" onClick={() => setConfirm('block')}>
                  Заблокировать
                </button>
                {u.isFriend && (
                  <button className="button danger" onClick={() => setConfirm('unfriend')}>
                    Удалить из друзей
                  </button>
                )}
              </div>
            </div>
            <UserProfileTabs tab={tab} user={u} profile={profile.data} />
            {confirm && (
              <div className="confirm-panel" role="alert">
                <Shield size={22} />
                <p>
                  {confirm === 'block'
                    ? 'Заблокировать'
                    : confirm === 'mute'
                      ? 'Заглушить'
                      : 'Удалить из друзей'}{' '}
                  {u.displayName}?
                </p>
                <div className="row">
                  <button className="button secondary" onClick={() => setConfirm('')}>
                    Отмена
                  </button>
                  <button
                    className="button danger"
                    onClick={() =>
                      void ctx.act(async () => {
                        if (confirm === 'unfriend') {
                          await api.unfriend(id);
                          ctx.history.recordFriendAction(id, u.displayName, 'friend-remove');
                        } else {
                          await api.moderate(id, confirm as 'block' | 'mute');
                          ctx.history.recordModeration(id, u.displayName, confirm);
                        }
                        setConfirm('');
                        load.reload();
                      }, 'Готово')
                    }
                  >
                    Подтвердить
                  </button>
                </div>
              </div>
            )}
          </>
        )
      )}
    </Modal>
  );
}
export function WorldDetails({ target, initialLocation, onClose }: { target: World | string; initialLocation?: string; onClose: () => void }) {
  const id = typeof target === 'string' ? target : target.id;
  return <WorldDetailsContent key={`${id}:${initialLocation || ''}`} id={id} initialLocation={initialLocation} onClose={onClose} />;
}
function WorldDetailsContent({ id, initialLocation, onClose }: { id: string; initialLocation?: string; onClose: () => void }) {
  const ctx = useApp();
  const world = useLoad(
    () =>
      ctx.demo
        ? Promise.resolve(demoWorlds.find((w) => w.id === id) || demoWorlds[0])
        : api.world(id),
    [id, ctx.refresh],
  );
  const [fav, setFav] = useState(false), [create, setCreate] = useState(false);
  const [invitation, setInvitation] = useState<{ mode: 'self' | 'friends'; location?: string }>();
  const [createdInstances, setCreatedInstances] = useState<KnownInstance[]>([]);
  const scopedLocation = accessibleLocation(initialLocation) && initialLocation.split(':')[0] === id ? initialLocation : undefined;
  const invalidTarget = initialLocation !== undefined && !scopedLocation;
  const w = world.data;
  return (
    <Modal title="Мир" onClose={onClose} wide>
      {world.loading && !w ? (
        <Loading />
      ) : world.error && !w ? (
        <ErrorState error={world.error} retry={world.reload} />
      ) : (
        w && (
          <>
            {world.error && <ErrorState error={world.error} retry={world.reload} />}
            <div className="world-detail-cover">
              <SecureImage src={w.imageUrl || w.thumbnailImageUrl} alt="" />
              <div className="cover-gradient" />
              <span className="cover-label">
                <Globe2 size={15} />
                WORLD
              </span>
            </div>
            <h2 className="detail-title">{w.name}</h2>
            <button className="text-button" onClick={() => w.authorId && ctx.openUser(w.authorId)}>
              by {w.authorName || 'Неизвестный автор'}
              <ExternalLink size={14} />
            </button>
            <div className="stat-row">
              <div>
                <strong>{(w.occupants || 0).toLocaleString('ru')}</strong>
                <span>сейчас в мире</span>
              </div>
              <div>
                <strong>{w.capacity || '—'}</strong>
                <span>вместимость</span>
              </div>
              <div>
                <strong>{(w.favorites || 0).toLocaleString('ru')}</strong>
                <span>в избранном</span>
              </div>
            </div>
            <p className="preserve-lines">{w.description}</p>
            {scopedLocation && <section className="inset-panel" aria-label="Выбранный инстанс">
              <h3>Выбранный инстанс</h3>
              <p className="id-text">{scopedLocation}</p>
              <p className="muted small">Приглашение ведёт именно в этот инстанс. Примите его в VRChat, чтобы присоединиться.</p>
            </section>}
            {invalidTarget && <p className="error-inline" role="alert">Адрес выбранного инстанса недоступен. Обновите профиль пользователя.</p>}
            <div className="chips">
              {w.unityPackages?.some((p) => p.platform === 'android') && (
                <Badge className="green">Android / Quest</Badge>
              )}
              {w.unityPackages?.some((p) => p.platform === 'standalonewindows') && (
                <Badge>PC</Badge>
              )}
              {w.tags
                ?.filter((t) => t.startsWith('author_tag_'))
                .slice(0, 8)
                .map((t) => <Badge key={t}>{t.replace('author_tag_', '')}</Badge>)}
            </div>
            <div className="detail-actions">
              <button className="button primary" disabled={invalidTarget} onClick={() => setInvitation({ mode: 'self', location: scopedLocation })}><Send size={16} />Пригласить себя</button>
              <button className="button secondary" disabled={invalidTarget} onClick={() => setInvitation({ mode: 'friends', location: scopedLocation })}><Users size={16} />Пригласить друзей</button>
              {!initialLocation && <button className="button primary" onClick={() => setCreate(!create)}>
                Создать инстанс
              </button>}
              <button className="button secondary" onClick={() => setFav(!fav)}>
                <Heart size={17} />В избранное
              </button>
            </div>
            {fav && <FavoritePicker id={id} type="world" onClose={() => setFav(false)} />}
            {create && <InstanceCreator world={w} onClose={() => setCreate(false)} onCreated={(instance, location) => setCreatedInstances((old) => [...old.filter((entry) => entry.location !== location), { location, count: instanceCount(instance.n_users) ?? instanceCount(instance.userCount) }])} />}
            {!initialLocation && <WorldInstances world={w} created={createdInstances} onInviteFriends={(location) => setInvitation({ mode: 'friends', location })} />}
            {invitation && <InstanceInviteDialog world={w} created={createdInstances} mode={invitation.mode} initialLocation={invitation.location} fixedLocation={!!scopedLocation} onClose={() => setInvitation(undefined)} />}

          </>
        )
      )}
    </Modal>
  );
}
