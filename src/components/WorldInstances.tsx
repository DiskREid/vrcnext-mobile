import { uiMessage } from '../i18n';
import { t, useI18n } from '../i18n';
import { useMemo } from 'react';
import { Send, Users } from 'lucide-react';
import { api } from '../api';
import type { User, World } from '../api';
import { useApp } from '../state';
import { buildWorldInstances } from '../data/world-instances';
import type { KnownInstance } from '../data/world-instances';
import { instanceCount } from '../data/instance-location';
import { AvatarImage, Badge, Empty, imageOf } from './ui';
import './WorldInstances.css';

function accessLabel(type: string): string {
  const known: Record<string, string> = {
    Public: t('Публичный'),
    Friends: t('Друзья'),
    'Friends+': t('Друзья+'),
    Invite: t('По приглашению'),
    'Invite+': t('Приглашение+'),
    Group: t('Группа'),
    'Group · public': t('Группа · публичный'),
    'Group · members': t('Группа · участники'),
    'Group · plus': t('Группа+'),
  };
  return known[type] || type;
}

const statuses: Record<string, string> = {
  'join me': 'Заходите',
  active: 'В сети',
  'ask me': 'Спросите меня',
  busy: 'Не беспокоить',
};
const statusLabel = (friend: User) =>
  friend.statusDescription || t(statuses[friend.status || ''] || '') || t('В VRChat');

/** Existing disclosed presence is enough; opening a list never fetches every friend's profile. */
export function InstanceFriends({
  friends,
  onOpenUser,
}: {
  friends: User[];
  onOpenUser?: (friend: User) => void;
}) {
  useI18n();
  const ctx = useApp();
  if (!friends.length) return null;
  return (
    <div className="world-instance-friends" aria-label={t('Друзья в этом инстансе')}>
      {friends.map((friend) => (
        <button
          className="world-instance-friend"
          key={friend.id}
          aria-label={t('Открыть профиль {p0}', { p0: String(friend.displayName) })}
          onClick={() => (onOpenUser || ctx.openUser)(friend)}
        >
          <AvatarImage
            src={imageOf(friend)}
            name={friend.displayName}
            size={36}
            user={friend}
            fallbackSrc={friend.currentAvatarThumbnailImageUrl || friend.currentAvatarImageUrl}
          />
          <span className="world-instance-friend-text">
            <strong>{friend.displayName}</strong>
            <small>{statusLabel(friend)}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

export default function WorldInstances({
  world,
  onInviteFriends,
  created = [],
}: {
  world: World;
  onInviteFriends: (location: string) => void;
  created?: KnownInstance[];
}) {
  useI18n();
  const ctx = useApp();
  const rows = useMemo(
    () => buildWorldInstances(world, ctx.friends.data, created),
    [world, ctx.friends.data, created],
  );
  const capacity = instanceCount(world.capacity);
  return (
    <section className="world-instances" aria-label={t('Инстансы мира')}>
      <h3 className="spaced-title">
        {t('Инстансы ')}
        <span className="muted">{rows.length}</span>
      </h3>
      <p className="muted small">{t('Публичные инстансы и доступные места друзей.')}</p>
      {!rows.length ? (
        <Empty
          title={t('Нет доступных инстансов')}
          text={t('Можно создать свой и пригласить друзей.')}
        />
      ) : (
        rows.map((row) => {
          const number = row.instanceId.split('~')[0];
          return (
            <article
              className="world-instance"
              key={row.location}
              data-location={row.location}
              aria-label={t('Инстанс #{p0}', { p0: String(number) })}
            >
              <div className="world-instance-header">
                <div className="world-instance-summary">
                  <strong title={row.location}>
                    {accessLabel(row.type)} · #{number}
                  </strong>
                  <div className="world-instance-meta">
                    {row.region && <Badge>{row.region.toUpperCase()}</Badge>}
                    <span>
                      {row.count !== undefined
                        ? t('{p0}{p1} игроков', {
                            p0: String(row.count),
                            p1: String(capacity !== undefined ? ` / ${capacity}` : ''),
                          })
                        : t('Число игроков не передано')}
                    </span>
                    <span className="world-instance-friend-count">
                      <Users size={13} />
                      {t('Друзья · ')}
                      {row.friends.length}
                    </span>
                  </div>
                  {row.source === 'friends' && (
                    <small className="muted">{t('По местоположению друзей')}</small>
                  )}
                  {row.source === 'created' && (
                    <small className="muted">{t('Созданный инстанс')}</small>
                  )}
                </div>
                <div className="world-instance-actions">
                  <button
                    className="button secondary compact"
                    onClick={() =>
                      void ctx.act(
                        () => api.inviteSelf(row.location),
                        uiMessage('Приглашение отправлено в VRChat'),
                      )
                    }
                  >
                    {t('Инвайт себе')}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t('Пригласить друзей в инстанс #{p0}', { p0: String(number) })}
                    onClick={() => onInviteFriends(row.location)}
                  >
                    <Send size={17} />
                  </button>
                </div>
              </div>
              <InstanceFriends friends={row.friends} />
            </article>
          );
        })
      )}
    </section>
  );
}
