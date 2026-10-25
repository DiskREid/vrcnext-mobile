import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { PipelineEvent, User } from '../api';
import { demoFriends } from '../demo';

/** Keep known rows in place: live presence must never sort a list under a finger. */
export function stableFriends(previous: User[], incoming: User[]): User[] {
  const remaining = new Map(incoming.map((u) => [u.id, u]));
  const result: User[] = [];
  for (const old of previous) {
    const next = remaining.get(old.id);
    if (!next) continue;
    result.push(JSON.stringify(old) === JSON.stringify(next) ? old : next);
    remaining.delete(old.id);
  }
  return [...result, ...remaining.values()];
}

export function patchFriends(users: User[], event: PipelineEvent): User[] {
  if (!event.type.startsWith('friend-')) return users;
  const c = event.content;
  const partial = c.user && typeof c.user === 'object' ? c.user as Partial<User> : {};
  const id = String(c.userId || c.userid || partial.id || '');
  if (!id) return users;
  if (event.type === 'friend-delete') return users.filter((u) => u.id !== id);
  const old = users.find((u) => u.id === id);
  if (!old && !partial.displayName) return users;
  const next: User = { ...old, ...partial, id, displayName: partial.displayName || old!.displayName };
  if (typeof c.location === 'string') next.location = c.location;
  if (typeof c.worldId === 'string') next.worldId = c.worldId;
  if (event.type === 'friend-offline') {
    next.state = 'offline'; next.location = 'offline';
    delete next.worldId; delete next.instanceId;
  } else if (event.type === 'friend-online' || event.type === 'friend-location') {
    next.state = 'online';
    // Presence is known; the user's chosen status is not supplied by every event.
    if (next.status === 'offline') next.status = undefined;
  } else if (event.type === 'friend-active') {
    next.state = 'active';
    if (next.status === 'offline') next.status = undefined;
    // An old in-game location must not turn website presence back into a game dot.
    const freshLocation = typeof c.location === 'string' ? c.location : partial.location;
    next.location = freshLocation || '';
    if (!freshLocation) { delete next.worldId; delete next.instanceId; }
  }
  if (event.type === 'friend-add') next.isFriend = true;
  if (!old) return [...users, next];
  if (JSON.stringify(old) === JSON.stringify(next)) return users;
  return users.map((u) => u.id === id ? next : u);
}

export function useFriends(account: string | undefined, demo: boolean, revision: number) {
  const [data, setData] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const state = useRef<User[]>([]);
  const owner = useRef<string | undefined>(undefined);
  const events = useRef<PipelineEvent[] | null>(null);
  const apply = useCallback((event: PipelineEvent) => {
    if (events.current) events.current.push(event);
    state.current = patchFriends(state.current, event);
    setData(state.current);
  }, []);
  useEffect(() => {
    let live = true;
    const identity = `${account}:${demo}`;
    if (owner.current !== identity) { state.current = []; setData([]); owner.current = identity; }
    if (!account) return;
    setLoading(!state.current.length);
    setRefreshing(true); setError(''); events.current = [];
    (demo ? Promise.resolve(demoFriends) : api.allFriends()).then((incoming) => {
      if (!live) return;
      let merged = stableFriends(state.current, incoming);
      for (const event of events.current || []) merged = patchFriends(merged, event);
      state.current = merged; setData(merged);
    }).catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (live) { events.current = null; setLoading(false); setRefreshing(false); } });
    return () => { live = false; events.current = null; };
  }, [account, demo, revision, retry]);
  return { data, loading, refreshing, error, apply, reload: () => setRetry((v) => v + 1) };
}

export type FriendState = ReturnType<typeof useFriends>;
