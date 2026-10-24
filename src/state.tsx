import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { FriendState } from './data/friends';
import type { ReactNode } from 'react';
import type { User, World } from './api';
export type Activity = { id: string; title: string; detail: string; time: string };
export type AppState = {
  user: User;
  onUserUpdated: (user: User) => void;
  demo: boolean;
  online: boolean;
  refresh: number;
  friends: FriendState;
  notificationsRefresh: number;
  notify: (text: string) => void;
  act: <T>(operation: () => Promise<T>, success?: string) => Promise<T | undefined>;
  openUser: (user: User | string) => void;
  openWorld: (world: World | string) => void;
  onRefresh: () => void;
  logout: () => void;
  activity: Activity[];
};
export const AppContext = createContext<AppState | null>(null);
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppContext missing');
  return value;
}
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const loaded = useRef(false);
  useEffect(() => {
    let live = true;
    setLoading(!loaded.current);
    setError('');
    Promise.resolve()
      .then(loader)
      .then((v) => {
        if (live) { loaded.current = true; setData(v); }
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [...deps, revision]);
  return { data, error, loading, reload: () => setRevision((x) => x + 1), setData };
}
export function AppProvider({ value, children }: { value: AppState; children: ReactNode }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
