import { useMemo } from 'react';
import { Send, Users } from 'lucide-react';
import { api } from '../api';
import type { User, World } from '../api';
import { useApp } from '../state';
import { buildWorldInstances } from '../data/world-instances';
import { instanceCount } from '../data/instance-location';
import { AvatarImage, Badge, Empty, imageOf } from './ui';
import './WorldInstances.css';

function accessLabel(type: string): string {
  const known: Record<string, string> = {
    Public: 'Публичный', Friends: 'Друзья', 'Friends+': 'Друзья+', Invite: 'По приглашению',
    'Invite+': 'Приглашение+', Group: 'Группа', 'Group · public': 'Группа · публичный',
    'Group · members': 'Группа · участники', 'Group · plus': 'Группа+',
  };
  return known[type] || type;
}

const statuses: Record<string, string> = {
  'join me': 'Заходите', active: 'В сети', 'ask me': 'Спросите меня', busy: 'Не беспокоить',
};
const statusLabel = (friend: User) => friend.statusDescription || statuses[friend.status || ''] || 'В VRChat';

/** Existing disclosed presence is enough; opening a list never fetches every friend's profile. */
export function InstanceFriends({ friends, onOpenUser }: { friends: User[]; onOpenUser?: (friend: User) => void }) {
  const ctx = useApp();
  if (!friends.length) return null;
  return <div className="world-instance-friends" aria-label="Друзья в этом инстансе">
    {friends.map((friend) => <button className="world-instance-friend" key={friend.id}
      aria-label={`Открыть профиль ${friend.displayName}`} onClick={() => (onOpenUser || ctx.openUser)(friend)}>
      <AvatarImage src={imageOf(friend)} name={friend.displayName} size={36} status={friend.status} />
      <span className="world-instance-friend-text"><strong>{friend.displayName}</strong><small>{statusLabel(friend)}</small></span>
    </button>)}
  </div>;
}

export default function WorldInstances({ world, onInviteFriends }: { world: World; onInviteFriends: (location: string) => void }) {
  const ctx = useApp();
  const rows = useMemo(() => buildWorldInstances(world, ctx.friends.data), [world, ctx.friends.data]);
  const capacity = instanceCount(world.capacity);
  return <section className="world-instances" aria-label="Инстансы мира">
    <h3 className="spaced-title">Инстансы <span className="muted">{rows.length}</span></h3>
    <p className="muted small">Публичные инстансы и доступные места друзей.</p>
    {!rows.length ? <Empty title="Нет доступных инстансов" text="Можно создать свой и пригласить друзей." />
      : rows.map((row) => {
        const number = row.instanceId.split('~')[0];
        return <article className="world-instance" key={row.location} data-location={row.location} aria-label={`Инстанс #${number}`}>
          <div className="world-instance-header">
            <div className="world-instance-summary">
              <strong title={row.location}>{accessLabel(row.type)} · #{number}</strong>
              <div className="world-instance-meta">
                {row.region && <Badge>{row.region.toUpperCase()}</Badge>}
                <span>{row.count !== undefined ? `${row.count}${capacity !== undefined ? ` / ${capacity}` : ''} игроков` : 'Число игроков не передано'}</span>
                <span className="world-instance-friend-count"><Users size={13} />Друзья · {row.friends.length}</span>
              </div>
              {row.source === 'friends' && <small className="muted">По местоположению друзей</small>}
            </div>
            <div className="world-instance-actions">
              <button className="button secondary compact" onClick={() => void ctx.act(() => api.inviteSelf(row.location), 'Приглашение отправлено в VRChat')}>Инвайт себе</button>
              <button className="icon-button" aria-label={`Пригласить друзей в инстанс #${number}`} onClick={() => onInviteFriends(row.location)}><Send size={17} /></button>
            </div>
          </div>
          <InstanceFriends friends={row.friends} />
        </article>;
      })}
  </section>;
}
