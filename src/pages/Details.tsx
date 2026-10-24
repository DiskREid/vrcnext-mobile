import SecureImage, { useSecureImage } from '../components/SecureImage';
import { useEffect, useState } from 'react';
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
  Hand,
} from 'lucide-react';
import { api, native } from '../api';
import { mergePublicProfile, readPublicProfile } from '../api/profile';
import type { User, World, Group, CreateInstanceOptions } from '../api';
import { useApp, useLoad } from '../state';
import { demoFriends, demoWorlds, demoGroups } from '../demo';
import {
  Modal,
  AvatarImage,
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
export function rankOf(tags: string[] = []) {
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
  const { demo, act } = useApp();
  const groups = useLoad(
    () =>
      demo
        ? Promise.resolve([
            { name: type === 'friend' ? 'group_0' : 'worlds1', displayName: 'Избранное', type },
          ])
        : api.favoriteGroups().then((g) => g.filter((x) => x.type === type)),
    [id],
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
            key={g.name}
            onClick={() =>
              void act(async () => {
                await api.addFavorite(id, type, g.name);
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
  const ctx = useApp(),
    id = typeof target === 'string' ? target : target.id;
  const load = useLoad(
    () =>
      ctx.demo ? Promise.resolve(demoFriends.find((x) => x.id === id) || ctx.user) : api.user(id),
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
  const u = load.data && mergePublicProfile(load.data, profile.data);
  const banner = useSecureImage(u?.profileBannerUrl);
  const [tab, setTab] = useState('profile'),
    [note, setNote] = useState(''),
    [fav, setFav] = useState(false),
    [confirm, setConfirm] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [booping, setBooping] = useState(false);
  const groups = useLoad(() => (ctx.demo ? Promise.resolve(demoGroups) : api.userGroups(id)), [id]);
  const mutual = useLoad(
    () =>
      tab === 'mutual'
        ? ctx.demo
          ? Promise.resolve(demoFriends.slice(0, 2))
          : api.mutualFriends(id)
        : Promise.resolve([]),
    [id, tab],
  );
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
              <AvatarImage src={imageOf(u)} name={u.displayName} size={84} status={u.status} />
              <div>
                <h2>{u.displayName}</h2>
                <div className="chips">
                  <Badge className="rank">{rankOf(u.tags)}</Badge>
                  {u.ageVerificationStatus === 'verified' && <Badge>18+ подтверждено</Badge>}
                </div>
              </div>
            </div>
            <p className="status-line">
              <i className={`status-dot status-${u.status}`} />
              {statusName(u.status)} {u.pronouns && `· ${u.pronouns}`}
            </p>
            {u.statusDescription && <p className="status-description">{u.statusDescription}</p>}
            <div className="detail-actions">
              <button className="button primary" onClick={() => invite(u)}>
                <Send size={16} />
                Пригласить
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
              {!u.isFriend && (
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
                <button
                  className="button secondary"
                  disabled={booping}
                  onClick={() => {
                    setBooping(true);
                    void ctx
                      .act(() => api.boop(u.id), 'Boop отправлен')
                      .finally(() => setBooping(false));
                  }}
                >
                  <Hand size={16} />
                  {booping ? 'Отправка…' : 'Boop'}
                </button>
              )}
              <button className="icon-button" aria-label="В избранное" onClick={() => setFav(!fav)}>
                <Heart size={20} />
              </button>
            </div>
            {fav && <FavoritePicker id={id} type="friend" onClose={() => setFav(false)} />}
            <Segmented
              value={tab}
              onChange={setTab}
              items={[
                { id: 'profile', label: 'О человеке' },
                { id: 'groups', label: 'Группы' },
                { id: 'mutual', label: 'Общие друзья' },
              ]}
            />
            {tab === 'profile' && (
              <div className="form-stack">
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
                {u.location?.startsWith('wrld_') && (
                  <button
                    className="list-row"
                    onClick={() => ctx.openWorld(u.location!.split(':')[0])}
                  >
                    <Globe2 size={20} />
                    <span>Мир пользователя</span>
                    <ExternalLink size={16} />
                  </button>
                )}
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
            )}
            {tab === 'groups' &&
              (groups.loading ? (
                <Loading />
              ) : groups.error ? (
                <ErrorState error={groups.error} retry={groups.reload} />
              ) : groups.data?.length ? (
                groups.data.map((g) => (
                  <div className="list-row" key={g.id}>
                    <AvatarImage src={g.iconUrl} name={g.name} />
                    <div>
                      <strong>{g.name}</strong>
                      <p className="muted small">
                        {g.memberCount?.toLocaleString('ru')} участников
                      </p>
                    </div>
                    <button
                      className="button secondary compact"
                      onClick={() =>
                        void ctx.act(
                          () => api.joinGroup(g.groupId || g.id),
                          'Запрос на вступление отправлен',
                        )
                      }
                    >
                      Вступить
                    </button>
                  </div>
                ))
              ) : (
                <Empty />
              ))}
            {tab === 'mutual' &&
              (mutual.loading ? (
                <Loading />
              ) : mutual.error ? (
                <ErrorState error={mutual.error} retry={mutual.reload} />
              ) : mutual.data?.length ? (
                mutual.data.map((f) => (
                  <button className="list-row" key={f.id} onClick={() => ctx.openUser(f)}>
                    <AvatarImage name={f.displayName} src={imageOf(f)} />
                    {f.displayName}
                  </button>
                ))
              ) : (
                <Empty title="Нет общих друзей" />
              ))}
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
                        if (confirm === 'unfriend') await api.unfriend(id);
                        else await api.moderate(id, confirm as 'block' | 'mute');
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
export function WorldDetails({ target, onClose }: { target: World | string; onClose: () => void }) {
  const ctx = useApp(),
    id = typeof target === 'string' ? target : target.id;
  const world = useLoad(
    () =>
      ctx.demo
        ? Promise.resolve(demoWorlds.find((w) => w.id === id) || demoWorlds[0])
        : api.world(id),
    [id, ctx.refresh],
  );
  const [fav, setFav] = useState(false),
    [create, setCreate] = useState(false),
    [type, setType] = useState<CreateInstanceOptions['type']>('friends'),
    [region, setRegion] = useState<CreateInstanceOptions['region']>('eu'),
    [group, setGroup] = useState(''),
    [access, setAccess] = useState<'public' | 'plus' | 'members'>('members'),
    [canRequest, setCanRequest] = useState(false),
    [busy, setBusy] = useState(false),
    [inviteTo, setInviteTo] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [progress, setProgress] = useState('');
  const groups = useLoad(
    () =>
      create
        ? ctx.demo
          ? Promise.resolve(demoGroups)
          : api.groups(ctx.user.id)
        : Promise.resolve([]),
    [create],
  );
  const friends = useLoad(
    () =>
      inviteTo
        ? ctx.demo
          ? Promise.resolve(demoFriends)
          : api.allOnlineFriends()
        : Promise.resolve([]),
    [inviteTo],
  );
  const w = world.data;
  const createInstance = () =>
    void ctx.act(async () => {
      setBusy(true);
      try {
        const instance = await api.createInstance({
          worldId: id,
          type,
          region,
          ...(type === 'group'
            ? { ownerId: group, groupAccessType: access }
            : type === 'public'
              ? {}
              : { ownerId: ctx.user.id }),
          ...(type === 'private' ? { canRequestInvite: canRequest } : {}),
        });
        const raw = instance.location || instance.id || instance.instanceId;
        if (!raw) throw new Error('VRChat не вернул адрес созданного инстанса.');
        const loc = raw.includes(':') ? raw : `${id}:${raw}`;
        await api.inviteSelf(loc);
        setCreate(false);
      } finally {
        setBusy(false);
      }
    }, 'Инстанс создан, приглашение отправлено');
  const multiInvite = () =>
    void ctx.act(async () => {
      setBusy(true);
      let done = 0;
      try {
        for (const f of selected) {
          await api.invite(f, inviteTo);
          done++;
          setProgress(`${done} / ${selected.length}`);
          if (done < selected.length) await new Promise((r) => setTimeout(r, 1500));
        }
        setInviteTo('');
        setSelected([]);
      } finally {
        setBusy(false);
      }
    }, 'Приглашения отправлены');
  return (
    <Modal title="Мир" onClose={onClose} wide>
      {world.loading && !w ? (
        <Loading />
      ) : world.error ? (
        <ErrorState error={world.error} retry={world.reload} />
      ) : (
        w && (
          <>
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
              <button className="button primary" onClick={() => setCreate(!create)}>
                Создать инстанс
              </button>
              <button className="button secondary" onClick={() => setFav(!fav)}>
                <Heart size={17} />В избранное
              </button>
            </div>
            {fav && <FavoritePicker id={id} type="world" onClose={() => setFav(false)} />}{' '}
            {create && (
              <div className="inset-panel form-stack">
                <h3>Новый инстанс</h3>
                <label className="field">
                  Доступ
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as CreateInstanceOptions['type'])}
                  >
                    <option value="public">Public</option>
                    <option value="hidden">Friends+</option>
                    <option value="friends">Friends</option>
                    <option value="private">Invite</option>
                    <option value="group">Group</option>
                  </select>
                </label>
                <label className="field">
                  Регион
                  <select
                    value={region}
                    onChange={(e) => setRegion(e.target.value as CreateInstanceOptions['region'])}
                  >
                    <option value="eu">Европа</option>
                    <option value="us">США, запад</option>
                    <option value="use">США, восток</option>
                    <option value="jp">Япония</option>
                  </select>
                </label>
                {type === 'private' && (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={canRequest}
                      onChange={(e) => setCanRequest(e.target.checked)}
                    />
                    Разрешить запросы приглашений (Invite+)
                  </label>
                )}
                {type === 'group' && (
                  <>
                    <label className="field">
                      Группа
                      <select value={group} onChange={(e) => setGroup(e.target.value)}>
                        <option value="">Выберите группу</option>
                        {groups.data?.map((g) => (
                          <option key={g.id} value={g.groupId || g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Доступ группы
                      <select
                        value={access}
                        onChange={(e) => setAccess(e.target.value as typeof access)}
                      >
                        <option value="members">Только участники</option>
                        <option value="plus">Group+</option>
                        <option value="public">Group Public</option>
                      </select>
                    </label>
                  </>
                )}
                <button
                  disabled={busy || (type === 'group' && !group)}
                  className="button primary"
                  onClick={createInstance}
                >
                  Создать и пригласить себя
                </button>
              </div>
            )}
            <h3 className="spaced-title">
              Открытые инстансы <span className="muted">{w.instances?.length || 0}</span>
            </h3>
            {!w.instances?.length ? (
              <Empty
                title="Нет доступных инстансов"
                text="Можно создать свой и пригласить друзей."
              />
            ) : (
              w.instances.map(([inst, count]) => {
                const loc = `${id}:${inst}`;
                return (
                  <div key={inst} className="instance-row">
                    <div>
                      <strong>#{inst.split('~')[0]}</strong>
                      <p className="muted small">
                        <Users size={13} />
                        {count} / {w.capacity} ·{' '}
                        {inst.includes('region(jp)')
                          ? 'JP'
                          : inst.includes('region(eu)')
                            ? 'EU'
                            : 'US'}
                      </p>
                    </div>
                    <div className="row">
                      <button
                        className="button secondary compact"
                        onClick={() =>
                          void ctx.act(() => api.inviteSelf(loc), 'Приглашение отправлено в VRChat')
                        }
                      >
                        Инвайт себе
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Пригласить друзей"
                        onClick={() => setInviteTo(loc)}
                      >
                        <Send size={17} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
            {inviteTo && (
              <div className="inset-panel">
                <h3>Пригласить друзей</h3>
                <p className="muted small">Приглашения отправляются последовательно с паузой.</p>
                {friends.loading ? (
                  <Loading />
                ) : friends.error ? (
                  <ErrorState error={friends.error} retry={friends.reload} />
                ) : (
                  friends.data?.map((f) => (
                    <label className="check-row" key={f.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(f.id)}
                        onChange={(e) =>
                          setSelected((v) =>
                            e.target.checked ? [...v, f.id] : v.filter((x) => x !== f.id),
                          )
                        }
                      />
                      <AvatarImage name={f.displayName} src={imageOf(f)} size={32} />
                      {f.displayName}
                    </label>
                  ))
                )}
                <div className="detail-actions">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setInviteTo('')}
                  >
                    Отмена
                  </button>
                  <button
                    className="button primary"
                    disabled={!selected.length || busy}
                    onClick={multiInvite}
                  >
                    {busy ? progress || 'Отправляем…' : `Пригласить (${selected.length})`}
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
