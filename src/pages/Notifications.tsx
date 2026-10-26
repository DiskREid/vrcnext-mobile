import { useEffect, useRef, useState } from 'react';
import { Bell, CalendarDays, ChevronRight, Globe2, Send, Users } from 'lucide-react';
import { api } from '../api';
import type { Notification } from '../api';
import { useApp, useLoad } from '../state';
import { Badge, Empty, ErrorState, Loading, Modal, PageHeader, Segmented } from '../components/ui';
import { notificationCategory, notificationDestination, sortNotifications } from '../data/notifications';
import './Notifications.css';
import { accessibleLocation } from '../data/locations';

const notificationLabel = (type: string) =>
  ({
    boop: 'Boop от друга',
    friendRequest: 'Заявка в друзья',
    invite: 'Приглашение',
    requestInvite: 'Запрос приглашения',
    inviteResponse: 'Ответ на приглашение',
    requestInviteResponse: 'Ответ на запрос',
    'group.announcement': 'Объявление группы',
    'group.event.created': 'Новое событие группы',
    'group.event.starting': 'Событие группы скоро начнётся',
    'event.announcement': 'Объявление мероприятия',
    'group.invite': 'Приглашение в группу',
    'group.joinRequest': 'Запрос в группу',
    groupAnnouncement: 'Объявление группы',
  })[type] || 'Уведомление VRChat';
function GroupEventNotices() {
  const ctx = useApp();
  const upcoming = ctx.calendarSync.events.filter((event) => Date.parse(event.startsAt || event.startDate || '') > Date.now()).sort((a,b) => Date.parse(a.startsAt || a.startDate || '') - Date.parse(b.startsAt || b.startDate || ''));
  if (ctx.demo) return null;
  return <section className="section group-event-notices">
    <div className="section-heading"><h2>Предстоящие события групп</h2><button className="text-button" disabled={ctx.calendarSync.loading} onClick={ctx.calendarSync.refresh}>Обновить события</button></div>
    {ctx.calendarSync.error && <ErrorState error={ctx.calendarSync.error} retry={ctx.calendarSync.refresh} />}
    <p className="muted small">Синхронизация раз в 5 минут при открытом приложении.{ctx.calendarSync.lastSync ? ` Последняя: ${new Date(ctx.calendarSync.lastSync).toLocaleString('ru')}.` : ''}</p>
    {ctx.calendarSync.loading && !upcoming.length ? <Loading /> : !upcoming.length ? <p className="muted">Предстоящих событий в полученных данных нет.</p> : upcoming.slice(0, 8).map((event) => <button key={event.id} className="card group-event-notice" onClick={() => ctx.openCalendarEvent(event)}><CalendarDays size={19} /><span><strong>{event.title || event.name || 'Событие группы'}</strong><small>{event.group?.name || event.groupId || 'Группа'} · {new Date(event.startsAt || event.startDate!).toLocaleString('ru')}</small>{event.description && <small className="group-event-excerpt">{event.description}</small>}</span><ChevronRight size={17} /></button>)}
  </section>;
}
export default function NotificationsPage() {
  const ctx = useApp(),
    [offset, setOffset] = useState(0),
    [category, setCategory] = useState('all'),
    [items, setItems] = useState<Notification[]>([]),
    [response, setResponse] = useState<Notification | null>(null),
    [text, setText] = useState('');
  const scope = `${ctx.pageActive !== false}:${ctx.refresh}:${ctx.notificationsRefresh}:${offset}`;
  const observation = useRef({ scope, generation: 0 });
  if (observation.current.scope !== scope) observation.current = { scope, generation: observation.current.generation + 1 };
  const load = useLoad(
    async () => {
      if (ctx.demo) return {items: [
            {
              id: 'demo_invite',
              type: 'invite',
              senderUsername: 'Luna',
              senderUserId: 'usr_1',
              message: 'Присоединяйся, мы на крыше! ✦',
              created_at: new Date().toISOString(),
              details: { worldId: 'wrld_demo1:demo' },
            },
          ] as Notification[], hasMore: false};
      const generation = observation.current.generation;
      const isCurrent = () => observation.current.generation === generation;
      const page = await api.notificationPage(offset, isCurrent);
      if (!isCurrent()) return { items: [], hasMore: false };
      // Modern V2 is a recent snapshot. Refresh it even while older V1 pages are open.
      const head = offset ? (await api.notificationPage(0, isCurrent)).items : [];
      return { items: [...head, ...page.items], hasMore: page.hasMore };
    },
    [ctx.refresh, ctx.notificationsRefresh, offset],
  );
  useEffect(() => {
    if (load.data)
      setItems((p) =>
        offset === 0
          ? load.data!.items
          : Array.from(new Map([...p, ...load.data!.items].map((n) => [n.id, n])).values()),
      );
  }, [load.data]);
  const action = (operation: () => Promise<unknown>, success: string, id: string) =>
    void ctx.act(async () => {
      await operation();
      setItems((p) => p.filter((i) => i.id !== id));
    }, success);
  const locationOf = (n: Notification) => {
    const d = n.details || {};
    const raw = String(d.worldId || d.instanceId || '');
    if (accessibleLocation(raw)) return raw;
    const combined = `${d.worldId || ''}:${d.instanceId || ''}`;
    return accessibleLocation(combined) ? combined : '';
  };
  const visible = sortNotifications(items).filter(item => category === 'all' || notificationCategory(item) === category);
  const unread = items.filter(item => item.seen !== true).length;
  const openDestination = (n: Notification) => {
    const destination = notificationDestination(n);
    if (!destination) return;
    if (destination.type === 'event') ctx.openCalendarEvent({id:destination.eventId,groupId:destination.groupId,title:n.title || 'Событие группы'});
    else if (destination.type === 'group') ctx.openGroup({id:destination.id,name:typeof n.details?.groupName === 'string' ? n.details.groupName : 'Группа'});
    else ctx.openUser(destination.id);
  };
  return (
    <>
      <PageHeader
        eyebrow="НЕ ПРОПУСТИТЕ"
        title="Уведомления"
        subtitle="Приглашения, друзья и события групп"
      />
      <div className="notification-categories"><Segmented value={category} onChange={setCategory} items={[
        {id:'all',label:'Все'}, {id:'invites',label:'Приглашения'}, {id:'friends',label:'Запросы в друзья'}, {id:'groups',label:'Объявления групп'}, {id:'calendar',label:'Календарные события'}
      ]} /></div>
      <p className="notification-unread-count" role="status">Непрочитано в загруженных уведомлениях: {unread}</p>
      {load.error && <ErrorState error={load.error} retry={load.reload} />}
      {load.loading && !items.length ? (
        <Loading />
      ) : !visible.length && !load.error ? (
        <Empty
          title={category === 'all' ? 'Вы всё посмотрели' : 'В этой категории уведомлений нет'}
          text="Новые приглашения и заявки появятся здесь."
          icon={<Bell size={32} />}
        />
      ) : (
        <div className="notification-list">
          {visible.map((n) => (
            <article className={`card notification-card ${n.seen !== true ? 'is-unread' : ''}`} data-notification-id={n.id} data-unread={n.seen !== true} key={n.id}>
              <div className="notification-icon">
                {n.type === 'friendRequest' ? (
                  <Users size={21} />
                ) : n.type.includes('group') ? (
                  <Globe2 size={21} />
                ) : (
                  <Send size={21} />
                )}
              </div>
              <div className="notification-body">
                <div className="notification-meta">
                  <Badge>{notificationLabel(n.type)}</Badge>{n.seen !== true && <span className="notification-new">Новое</span>}
                  <time>
                    {n.created_at || n.createdAt ? new Date(n.created_at || n.createdAt!).toLocaleString('ru', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    }) : 'Время не передано'}
                  </time>
                </div>
                {n.senderUserId?.startsWith('usr_') ? <button className="text-button person-link" onClick={() => ctx.openUser(n.senderUserId!)}>{n.senderUsername || 'Пользователь VRChat'}</button> : <strong className="person-link">{n.senderUsername || n.title || 'VRChat'}</strong>}
                <p>{n.message || 'Новое событие в вашем аккаунте.'}</p>
                <div className="detail-actions">
                  {['friendRequest', 'group.invite', 'group.joinRequest'].includes(n.type) && (
                    <button
                      className="button primary compact"
                      onClick={() =>
                        action(
                          async () => { await api.acceptNotification(n, ctx.user.location); if (n.type === 'friendRequest' && n.senderUserId) ctx.history.recordFriendAction(n.senderUserId, n.senderUsername || n.senderUserId, 'friend-add'); },
                          'Запрос принят',
                          n.id,
                        )
                      }
                    >
                      Принять
                    </button>
                  )}
                  {n.type === 'invite' && locationOf(n) && (
                    <button
                      className="button primary compact"
                      onClick={() =>
                        action(() => api.acceptNotification(n), 'Приглашение принято', n.id)
                      }
                    >
                      Принять приглашение
                    </button>
                  )}
                  {(n.type === 'invite' || n.type === 'requestInvite') && (
                    <button className="button secondary compact" onClick={() => setResponse(n)}>
                      Ответить
                    </button>
                  )}
                  {n.type === 'requestInvite' && n.senderUserId && (
                    <button
                      disabled={!accessibleLocation(ctx.user.location)}
                      title={!accessibleLocation(ctx.user.location) ? 'Сначала выберите доступный инстанс в информации о мире' : undefined}
                      className="button primary compact"
                      onClick={() =>
                        action(
                          () => api.invite(n.senderUserId!, ctx.user.location || ''),
                          'Приглашение отправлено',
                          n.id,
                        )
                      }
                    >
                      Пригласить
                    </button>
                  )}
                  {notificationDestination(n) && <button className="button secondary compact" onClick={() => openDestination(n)}>{notificationDestination(n)?.type === 'event' ? 'Открыть мероприятие' : notificationDestination(n)?.type === 'group' ? 'Открыть группу' : 'Открыть профиль'}</button>}
                  {n.seen !== true && <button className="button secondary compact" onClick={() => void ctx.act(async () => { await api.readNotification(n); setItems((current) => current.map((item) => item.id === n.id ? {...item, seen:true} : item)); }, 'Уведомление прочитано')}>Прочитано</button>}
                  <button
                    className="button secondary compact"
                    disabled={n.canDelete === false}
                    title={n.canDelete === false ? 'VRChat не разрешает удаление этого уведомления' : undefined}
                    onClick={() =>
                      action(() => api.dismissNotification(n), 'Уведомление скрыто', n.id)
                    }
                  >
                    {n.type === 'friendRequest' ? 'Отклонить' : 'Скрыть'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {category === 'calendar' && <GroupEventNotices />}
      {load.data?.hasMore && (
        <button className="button secondary load-more" disabled={load.loading} onClick={() => setOffset((o) => o + 100)}>
          Загрузить ещё
        </button>
      )}
      {response && (
        <Modal title="Ответ на приглашение" onClose={() => setResponse(null)}>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void ctx.act(async () => {
                await api.respondToInvite(
                  ctx.user.id,
                  response.id,
                  response.type as 'invite' | 'requestInvite',
                  text,
                );
                setResponse(null);
                setText('');
              }, 'Ответ отправлен');
            }}
          >
            <p className="muted">
              Ответ использует шаблон VRChat и доступный слот. Частоту изменений ограничивает
              VRChat.
            </p>
            <label className="field">
              Ваш ответ
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={64}
                required
              />
            </label>
            <button className="button primary" type="submit">
              Отправить
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
