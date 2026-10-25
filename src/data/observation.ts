import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, isNative } from '../api';
import { App as AndroidApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import type { User } from '../api';
import type { FriendState } from './friends';
import type { HistoryState } from './history';

export function useObservation(user: User | null, demo: boolean, online: boolean, connected: boolean,
  friends: FriendState, history: HistoryState, updateUser: (user: User) => void) {
  const latest = useRef({ user, friends, history, connected, updateUser });
  latest.current = { user, friends, history, connected, updateUser };
  const [status, setStatus] = useState('paused');
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState<string>();
  const [foreground, setForeground] = useState(true);
  const nativeActive = useRef(true);
  const refreshAction = useRef<() => void>(() => {});
  const initialAccount = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    let handle: PluginListenerHandle | undefined;
    const active = (value: boolean) => { if (!cancelled) { nativeActive.current = value; setForeground(value); } };
    void AndroidApp.addListener('appStateChange', ({ isActive }) => active(isActive)).then((h) => {
      if (cancelled) void h.remove(); else handle = h;
    }).catch(() => {
      if (!cancelled) { nativeActive.current = false; setForeground(false); setError('Не удалось определить активность приложения. Наблюдение приостановлено.'); }
    });
    void AndroidApp.getState().then(({ isActive }) => active(isActive)).catch(() => {});
    return () => { cancelled = true; void handle?.remove(); };
  }, []);
  useEffect(() => {
    let live = true, busy = false, expired = false, visibilityEpoch = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => nativeActive.current && document.visibilityState === 'visible';
    const schedule = (delay = 120_000) => { clearTimeout(timer); if (live && visible() && !expired) timer = setTimeout(() => void sample(), delay); };
    const sample = async () => {
      if (!live || busy || !visible() || !online || !latest.current.user || demo) return;
      busy = true; setStatus('syncing');
      const epoch = visibilityEpoch;
      let delay = 120_000;
      try {
        const fresh = await api.resume();
        if (!live || !visible() || epoch !== visibilityEpoch) return;
        const current = latest.current;
        if (fresh.id !== current.user?.id) throw new Error('Аккаунт наблюдения изменился. Войдите снова.');
        // Only the actual response can prove location. Never fill an absent location from old UI data.
        current.history.observeSession(fresh, current.connected && !current.friends.refreshing ? current.friends.data : [], 'api');
        current.updateUser({ ...current.user, ...fresh });
        setLastSync(new Date().toISOString()); setStatus('observing'); setError('');
      } catch (failure) {
        if (!live || epoch !== visibilityEpoch) return;
        latest.current.history.pause();
        expired = failure instanceof ApiError && failure.status === 401;
        if (failure instanceof ApiError && failure.status === 429) delay = Math.max(delay, (failure.retryAfter || 60) * 1000);
        setStatus('error'); setError(failure instanceof Error ? failure.message : 'Не удалось получить текущее местоположение.');
      } finally { busy = false; schedule(epoch !== visibilityEpoch ? 0 : delay); }
    };
    refreshAction.current = () => { expired = false; clearTimeout(timer); void sample(); };
    const visibility = () => {
      if (visible()) { if (!expired) void sample(); }
      else { visibilityEpoch++; clearTimeout(timer); latest.current.history.pause(); setStatus('paused'); }
    };
    if (!user) { initialAccount.current = undefined; setLastSync(undefined); setError(''); setStatus('paused'); }
    else if (demo) { setLastSync(undefined); setError(''); setStatus('demo'); }
    else if (!online || !visible()) { history.pause(); setStatus('paused'); }
    else if (initialAccount.current !== user.id) {
      // Auth just returned this real snapshot; avoid a duplicate /auth/user request on login.
      initialAccount.current = user.id;
      history.observeSession(user, connected && !friends.refreshing ? friends.data : [], 'api');
      setLastSync(new Date().toISOString()); setStatus('observing'); schedule();
    } else void sample();
    document.addEventListener('visibilitychange', visibility);
    return () => { live = false; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); history.pause(); refreshAction.current = () => {}; };
  }, [user?.id, demo, online, foreground, history.observeSession, history.pause]);
  const refresh = useCallback(() => refreshAction.current(), []);
  return { status, error, lastSync, refresh };
}
export type ObservationState = ReturnType<typeof useObservation>;
