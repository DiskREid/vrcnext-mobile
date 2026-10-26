import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { World } from '../api';
import { useApp } from '../state';
import { buildWorldInstances } from '../data/world-instances';
import type { KnownInstance } from '../data/world-instances';
import { AvatarImage, Empty, ErrorState, imageOf, Loading, Modal, SearchField } from './ui';

export default function InstanceInviteDialog({ world, initialLocation = '', fixedLocation = false, mode, created, onClose }: {
  world: World; initialLocation?: string; fixedLocation?: boolean; mode: 'self' | 'friends'; created: KnownInstance[]; onClose: () => void;
}) {
  const ctx = useApp();
  const [location, setLocation] = useState(initialLocation), [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]), [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [error, setError] = useState('');
  const [selfSent, setSelfSent] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);
  const rows = buildWorldInstances(world, ctx.friends.data, created);
  const friends = ctx.friends.data.filter((friend) => friend.id !== ctx.user.id && friend.isFriend !== false && `${friend.displayName} ${friend.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  async function send() {
    if (busy || !location) return;
    setBusy(true); setError('');
    try {
      if (mode === 'self') {
        await ctx.act(async () => {
          try { await api.inviteSelf(location); if (!cancelled.current) setSelfSent(true); }
          catch (failure) { if (!cancelled.current) setError(failure instanceof Error ? failure.message : 'Не удалось отправить приглашение.'); throw failure; }
        }, 'Приглашение себе отправлено');
      } else {
        const result = await ctx.act(async () => {
          const successful: string[] = [], failures: string[] = [];
          for (const id of selected) {
            if (cancelled.current) break;
            setProgress(`${successful.length + failures.length + 1} / ${selected.length}`);
            try {
              await api.invite(id, location);
              successful.push(id);
              if (!cancelled.current) { setSent((old) => [...old, id]); setSelected((old) => old.filter((value) => value !== id)); }
            } catch (failure) {
              const name = ctx.friends.data.find((friend) => friend.id === id)?.displayName || id;
              failures.push(`${name}: ${failure instanceof Error ? failure.message : 'Ошибка отправки'}`);
              if (failure instanceof ApiError && (failure.status === 401 || failure.status === 429)) break;
            }
            if (id !== selected.at(-1) && !cancelled.current) await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          return { successful, failures };
        });
        if (result && !cancelled.current) {
          setProgress(`Отправлено: ${result.successful.length} из ${selected.length}`);
          setError(result.failures.join('\n'));
          ctx.notify(result.successful.length ? `Приглашений отправлено: ${result.successful.length}` : 'Приглашения не отправлены');
        }
      }
    } finally { if (!cancelled.current) setBusy(false); }
  }
  return <Modal title={mode === 'self' ? 'Пригласить себя' : 'Пригласить друзей'} onClose={onClose}>
    <div className="form-stack">
      <p>{world.name}</p>
      <p className="muted small">Приглашение придёт в VRChat. Для отправки с телефона не требуется находиться в игре.</p>
      {fixedLocation ? <p className="muted small preserve-lines">Выбранный инстанс: <span className="id-text">{initialLocation}</span></p> : <label className="field">Инстанс для приглашения<select value={location} disabled={busy} onChange={(event) => { setLocation(event.target.value); setSent([]); setSelected([]); setSelfSent(false); setError(''); }}>
        <option value="">Выберите инстанс</option>
        {rows.map((row) => <option key={row.location} value={row.location}>#{row.instanceId.split('~')[0]} · {row.type}{row.region ? ` · ${row.region.toUpperCase()}` : ''}{row.count !== undefined ? ` · ${row.count} игроков` : ''}</option>)}
        {!!initialLocation && !rows.some((row) => row.location === initialLocation) && <option value={initialLocation}>#{initialLocation.split(':')[1]?.split('~')[0]} · выбранный инстанс</option>}
      </select></label>}
      {!rows.length && !initialLocation && <p className="muted">Нет доступных инстансов. Вернитесь к миру и создайте новый.</p>}
      {mode === 'friends' && <>
        <SearchField value={query} onChange={setQuery} placeholder="Кого пригласить" />
        {ctx.friends.loading && <Loading />}{ctx.friends.error && <ErrorState error={ctx.friends.error} retry={ctx.friends.reload} />}
        {!ctx.friends.loading && !friends.length && <Empty title="Друзья не найдены" />}
        <div className="invite-recipient-list">{friends.map((friend) => <label className="check-row invite-recipient" key={friend.id}>
          <input type="checkbox" checked={selected.includes(friend.id)} disabled={busy || sent.includes(friend.id)} onChange={(event) => setSelected((old) => event.target.checked ? [...old, friend.id] : old.filter((id) => id !== friend.id))} />
          <AvatarImage name={friend.displayName} src={imageOf(friend)} fallbackSrc={friend.currentAvatarThumbnailImageUrl} user={friend} size={36} />
          <span>{friend.displayName}{sent.includes(friend.id) && <small className="muted">Отправлено</small>}</span>
        </label>)}</div>
      </>}
      {error && <p className="error-inline preserve-lines" role="alert">{error}</p>}
      {progress && <p role="status">{progress}</p>}
      {selfSent && <p role="status">Приглашение себе отправлено</p>}
      <button className="button primary" disabled={busy || !location || (mode === 'friends' ? !selected.length : selfSent)} onClick={() => void send()}>{busy ? progress || 'Отправляем…' : mode === 'self' ? 'Отправить приглашение себе' : `Пригласить (${selected.length})`}</button>
    </div>
  </Modal>;
}
