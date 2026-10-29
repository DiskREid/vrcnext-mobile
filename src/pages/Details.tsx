import { uiMessage } from '../i18n';
import { t, useI18n, dateLocale } from '../i18n';
import SecureImage, { useSecureImage } from '../components/SecureImage';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
import { normalizeSelfUser } from '../data/self-user';
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
    'join me': t('Заходите'),
    active: t('В сети'),
    'ask me': t('Спросите меня'),
    busy: t('Не беспокоить'),
    offline: t('Не в сети'),
  })[s || ''] || t('В сети');
export function rankOf(tags?: string[]) {
  if (!tags) return t('Неизвестен');
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
  useI18n();
  const { user, demo, act } = useApp();
  const groups = useLoad<FavoriteGroup[]>(
    () =>
      demo
        ? Promise.resolve([
            { name: type === 'friend' ? 'group_0' : 'worlds1', displayName: t('Избранное'), type },
          ])
        : loadFavoriteGroups(user.id, type),
    [id, type, demo, user.id],
  );
  return (
    <div className="inset-panel">
      <h3>{t('Коллекция избранного')}</h3>
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
              }, uiMessage('Добавлено в избранное'))
            }
          >
            <Star size={17} />
            {g.displayName || g.name}
          </button>
        ))
      ) : (
        <Empty text={t('Нет доступных коллекций VRChat.')} />
      )}
      <button className="text-button" onClick={onClose}>
        {t('Отмена')}
      </button>
    </div>
  );
}
function UserProfileFrame({
  inline,
  onClose,
  children,
}: {
  inline: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return inline ? (
    <section className="card user-profile-panel self-profile-details" aria-label={t('Профиль')}>
      {children}
    </section>
  ) : (
    <Modal title={t('Профиль')} onClose={onClose} wide>
      {children}
    </Modal>
  );
}
export function UserDetails({
  target,
  onClose,
  inline = false,
}: {
  target: User | string;
  onClose: () => void;
  inline?: boolean;
}) {
  useI18n();
  const id = typeof target === 'string' ? target : target.id;
  // A different target gets a different loader and form, never retained data from the last profile.
  return <UserDetailsContent key={id} id={id} onClose={onClose} inline={inline} />;
}
function UserDetailsContent({
  id,
  onClose,
  inline,
}: {
  id: string;
  onClose: () => void;
  inline: boolean;
}) {
  useI18n();
  const ctx = useApp(),
    isSelf = ctx.user.id === id;
  const latestSelf = useRef(ctx.user);
  latestSelf.current = ctx.user;
  const selfRequestBaselines = useRef(new WeakMap<User, User>());
  const load = useLoad(() => {
    const requestedSelf = latestSelf.current;
    return (
      ctx.demo
        ? Promise.resolve(demoFriends.find((x) => x.id === id) || ctx.user)
        : isSelf
          ? api.resume()
          : api.user(id)
    ).then((user) => {
      if (user.id !== id) throw new Error(t('VRChat не вернул запрошенного пользователя.'));
      if (!isSelf) return user;
      const fresh = normalizeSelfUser(user);
      selfRequestBaselines.current.set(fresh, requestedSelf);
      return fresh;
    });
  }, [id, ctx.refresh]);
  const profile = useLoad(
    () =>
      ctx.demo
        ? Promise.resolve({
            bio: '',
            ...demoFriends.find((x) => x.id === id),
            ...(id === ctx.user.id ? ctx.user : {}),
          })
        : api.userProfile(id).then((value) => readPublicProfile(value, id)),
    [id, ctx.refresh],
  );
  const liveUser = isSelf ? ctx.user : ctx.friends.data.find((friend) => friend.id === id);
  const baseline = useRef<{ profile?: User; friend?: User }>({});
  if (baseline.current.profile !== load.data)
    baseline.current = {
      profile: load.data,
      friend: isSelf && load.data ? selfRequestBaselines.current.get(load.data) : liveUser,
    };
  const u =
    load.data &&
    overlayLiveUser(mergePublicProfile(load.data, profile.data), baseline.current.friend, liveUser);
  const banner = useSecureImage(u?.profileBannerUrl);
  const [tab, setTab] = useState('profile'),
    [note, setNote] = useState(''),
    [confirm, setConfirm] = useState(''),
    [boopOpen, setBoopOpen] = useState(false);
  useEffect(() => {
    // Our own event baseline belongs to the live pipeline and observation sampler.
    // An older profile-view response must not replace their newer location.
    if (!isSelf && !ctx.demo && load.data && profile.data && !load.error && !profile.error)
      ctx.history.observeProfile(mergePublicProfile(load.data, profile.data));
  }, [
    load.data,
    profile.data,
    load.error,
    profile.error,
    isSelf,
    ctx.demo,
    ctx.history.observeProfile,
  ]);
  useEffect(() => {
    setNote(u?.note || '');
  }, [u?.id, u?.note]);
  const invite = (user: User) =>
    void ctx.act(
      () => api.invite(user.id, ctx.user.location || ''),
      uiMessage('Приглашение отправлено'),
    );
  return (
    <UserProfileFrame inline={inline} onClose={onClose}>
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
              <AvatarImage
                src={imageOf(u)}
                name={u.displayName}
                size={84}
                user={u}
                fallbackSrc={u.currentAvatarThumbnailImageUrl || u.currentAvatarImageUrl}
              />
              <div>
                <h2>{u.displayName}</h2>
                <div className="chips">
                  <Badge className="rank">{rankOf(u.tags)}</Badge>
                  {u.ageVerificationStatus === 'verified' && <Badge>{t('18+ подтверждено')}</Badge>}
                </div>
              </div>
            </div>
            <p className="status-line">
              <PresenceIndicator user={u} />
              {t(presenceIndicator(u).label)} {u.pronouns && `· ${u.pronouns}`}
            </p>
            {u.statusDescription && <p className="status-description">{u.statusDescription}</p>}
            {!isSelf && (
              <div className="detail-actions">
                <button
                  className="button primary"
                  disabled={!accessibleLocation(ctx.user.location)}
                  onClick={() => invite(u)}
                >
                  <Send size={16} />
                  {t('Пригласить друга')}
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    void ctx.act(
                      () => api.requestInvite(u.id),
                      uiMessage('Запрос приглашения отправлен'),
                    )
                  }
                >
                  <MessageSquare size={16} />
                  {t('Попросить инвайт')}
                </button>
                {!u.isFriend && !isSelf && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      void ctx.act(
                        () => api.friendRequest(u.id),
                        uiMessage('Заявка в друзья отправлена'),
                      )
                    }
                  >
                    <UserPlus size={16} />
                    {t('Добавить')}
                  </button>
                )}
                {(u.isFriend || u.friendKey) && u.id !== ctx.user.id && (
                  <button className="button secondary" onClick={() => setBoopOpen(true)}>
                    Boop
                  </button>
                )}
                {!isSelf && <FriendFavoriteButton user={u} />}
              </div>
            )}
            {boopOpen && <BoopPicker target={u} onClose={() => setBoopOpen(false)} />}
            <Segmented
              value={tab}
              onChange={setTab}
              items={userProfileTabs
                .filter((item) => !isSelf || item.id !== 'mutual')
                .map((item) => ({ ...item, label: t(item.label) }))}
            />
            <div className="form-stack user-profile-panel" hidden={tab !== 'profile'}>
              {profile.loading && typeof u.bio !== 'string' ? (
                <Loading />
              ) : (
                <>
                  {profile.error && <ErrorState error={profile.error} retry={profile.reload} />}
                  {typeof u.bio === 'string' ? (
                    <p className="preserve-lines">
                      {u.bio.trim() ? u.bio : t('Описание пока не добавлено.')}
                    </p>
                  ) : !profile.error ? (
                    <p className="muted">{t('VRChat не передал биографию в публичном профиле.')}</p>
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
              {!isSelf && (
                <>
                  <label className="field">
                    {t('Личная заметка')}
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={256}
                      placeholder={t('Видна только вам')}
                    />
                  </label>
                  <button
                    className="button secondary"
                    onClick={() =>
                      void ctx.act(() => api.note(id, note), uiMessage('Заметка сохранена'))
                    }
                  >
                    {t('Сохранить заметку')}
                  </button>
                  <div className="divider" />
                  <h3>{t('Управление')}</h3>
                  <div className="detail-actions">
                    <button className="button secondary" onClick={() => setConfirm('mute')}>
                      {t('Заглушить')}
                    </button>
                    <button className="button danger" onClick={() => setConfirm('block')}>
                      {t('Заблокировать')}
                    </button>
                    {u.isFriend && (
                      <button className="button danger" onClick={() => setConfirm('unfriend')}>
                        {t('Удалить из друзей')}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
            <UserProfileTabs tab={tab} user={u} profile={profile.data} />
            {confirm && !isSelf && (
              <div className="confirm-panel" role="alert">
                <Shield size={22} />
                <p>
                  {confirm === 'block'
                    ? t('Заблокировать')
                    : confirm === 'mute'
                      ? t('Заглушить')
                      : t('Удалить из друзей')}{' '}
                  {u.displayName}?
                </p>
                <div className="row">
                  <button className="button secondary" onClick={() => setConfirm('')}>
                    {t('Отмена')}
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
                      }, uiMessage('Готово'))
                    }
                  >
                    {t('Подтвердить')}
                  </button>
                </div>
              </div>
            )}
          </>
        )
      )}
    </UserProfileFrame>
  );
}
export function WorldDetails({
  target,
  initialLocation,
  onClose,
}: {
  target: World | string;
  initialLocation?: string;
  onClose: () => void;
}) {
  useI18n();
  const id = typeof target === 'string' ? target : target.id;
  return (
    <WorldDetailsContent
      key={`${id}:${initialLocation || ''}`}
      id={id}
      initialLocation={initialLocation}
      onClose={onClose}
    />
  );
}
function WorldDetailsContent({
  id,
  initialLocation,
  onClose,
}: {
  id: string;
  initialLocation?: string;
  onClose: () => void;
}) {
  useI18n();
  const ctx = useApp();
  const world = useLoad(
    () =>
      ctx.demo
        ? Promise.resolve(demoWorlds.find((w) => w.id === id) || demoWorlds[0])
        : api.world(id),
    [id, ctx.refresh],
  );
  const [fav, setFav] = useState(false),
    [create, setCreate] = useState(false);
  const [invitation, setInvitation] = useState<{ mode: 'self' | 'friends'; location?: string }>();
  const [createdInstances, setCreatedInstances] = useState<KnownInstance[]>([]);
  const scopedLocation =
    accessibleLocation(initialLocation) && initialLocation.split(':')[0] === id
      ? initialLocation
      : undefined;
  const invalidTarget = initialLocation !== undefined && !scopedLocation;
  const w = world.data;
  return (
    <Modal title={t('Мир')} onClose={onClose} wide>
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
              by {w.authorName || t('Неизвестный автор')}
              <ExternalLink size={14} />
            </button>
            <div className="stat-row">
              <div>
                <strong>{(w.occupants || 0).toLocaleString(dateLocale())}</strong>
                <span>{t('сейчас в мире')}</span>
              </div>
              <div>
                <strong>{w.capacity || '—'}</strong>
                <span>{t('вместимость')}</span>
              </div>
              <div>
                <strong>{(w.favorites || 0).toLocaleString(dateLocale())}</strong>
                <span>{t('в избранном')}</span>
              </div>
            </div>
            <p className="preserve-lines">{w.description}</p>
            {scopedLocation && (
              <section className="inset-panel" aria-label={t('Выбранный инстанс')}>
                <h3>{t('Выбранный инстанс')}</h3>
                <p className="id-text">{scopedLocation}</p>
                <p className="muted small">
                  {t(
                    'Приглашение ведёт именно в этот инстанс. Примите его в VRChat, чтобы присоединиться.',
                  )}
                </p>
              </section>
            )}
            {invalidTarget && (
              <p className="error-inline" role="alert">
                {t('Адрес выбранного инстанса недоступен. Обновите профиль пользователя.')}
              </p>
            )}
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
              <button
                className="button primary"
                disabled={invalidTarget}
                onClick={() => setInvitation({ mode: 'self', location: scopedLocation })}
              >
                <Send size={16} />
                {t('Пригласить себя')}
              </button>
              <button
                className="button secondary"
                disabled={invalidTarget}
                onClick={() => setInvitation({ mode: 'friends', location: scopedLocation })}
              >
                <Users size={16} />
                {t('Пригласить друзей')}
              </button>
              {!initialLocation && (
                <button className="button primary" onClick={() => setCreate(!create)}>
                  {t('Создать инстанс')}
                </button>
              )}
              <button className="button secondary" onClick={() => setFav(!fav)}>
                <Heart size={17} />
                {t('В избранное')}
              </button>
            </div>
            {fav && <FavoritePicker id={id} type="world" onClose={() => setFav(false)} />}
            {create && (
              <InstanceCreator
                world={w}
                onClose={() => setCreate(false)}
                onCreated={(instance, location) =>
                  setCreatedInstances((old) => [
                    ...old.filter((entry) => entry.location !== location),
                    {
                      location,
                      count: instanceCount(instance.n_users) ?? instanceCount(instance.userCount),
                    },
                  ])
                }
              />
            )}
            {!initialLocation && (
              <WorldInstances
                world={w}
                created={createdInstances}
                onInviteFriends={(location) => setInvitation({ mode: 'friends', location })}
              />
            )}
            {invitation && (
              <InstanceInviteDialog
                world={w}
                created={createdInstances}
                mode={invitation.mode}
                initialLocation={invitation.location}
                fixedLocation={!!scopedLocation}
                onClose={() => setInvitation(undefined)}
              />
            )}
          </>
        )
      )}
    </Modal>
  );
}
