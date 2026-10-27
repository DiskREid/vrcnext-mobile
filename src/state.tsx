import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { FriendState } from './data/friends';
import type { HistoryState } from './data/history';
import type { ObservationState } from './data/observation';
import type { CalendarSync } from './data/calendar-sync';
import type { ReactNode } from 'react';
import type { User, World, Group, CalendarEvent } from './api';
export type Activity = {
  id: string; title: string; detail: string; time: string;
  userId?: string; displayName?: string;
  beforeLocation?: string; location?: string; worldId?: string;
};
export type AppState = {
  user: User;
  onUserUpdated: (user: User) => void;
  demo: boolean;
  online: boolean;
  refresh: number;
  pageActive?: boolean;
  friends: FriendState;
  history: HistoryState;
  observation: ObservationState;
  calendarSync: CalendarSync;
  notificationsRefresh: number;
  notify: (text: string) => void;
  act: <T>(operation: () => Promise<T>, success?: string) => Promise<T | undefined>;
  openUser: (user: User | string) => void;
  openWorld: (world: World | string, instanceLocation?: string) => void;
  openGroup: (group: Group) => void;
  openCalendarEvent: (event: CalendarEvent) => void;
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
  const enabled = useContext(AppContext)?.pageActive !== false;
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const loaded = useRef(false);
  const completed = useRef<unknown[] | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    const signature = [...deps, revision];
    if (completed.current?.length === signature.length && completed.current.every((value, index) => Object.is(value, signature[index]))) return;
    let live = true;
    setLoading(!loaded.current);
    setError('');
    Promise.resolve()
      .then(() => live ? loader() : undefined)
      .then((v) => {
        if (live) { loaded.current = true; setData(v); }
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (live) { completed.current = signature; setLoading(false); }
      });
    return () => {
      live = false;
    };
  }, [...deps, revision, enabled]);
  return { data, error, loading, reload: () => setRevision((x) => x + 1), setData };
}
export function AppProvider({ value, children }: { value: AppState; children: ReactNode }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** Retained screens keep their controls and data without requesting APIs while hidden. */
export function PageScope({ active, refresh, children }: { active: boolean; refresh: number; children: ReactNode }) {
  const state = useApp();
  return <AppProvider value={{ ...state, pageActive: active && state.pageActive !== false, refresh }}>{children}</AppProvider>;
}
