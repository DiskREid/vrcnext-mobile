import { useCallback, useEffect, useMemo, useState } from 'react';
import { App as AndroidApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { api, isNative } from '../api';
import type { CalendarEvent } from '../api';
import { createCalendarClient, normalizeCalendarEvent, withCalendarGroups } from '../api/calendar';

export interface CalendarReminder { id: string; event: CalendarEvent; createdAt: string; }
export interface CalendarSyncState { events: CalendarEvent[]; reminders: CalendarReminder[]; loading: boolean; error: string; lastSync?: string; }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type Client = ReturnType<typeof createCalendarClient>;
const empty = (): CalendarSyncState => ({ events: [], reminders: [], loading: false, error: '' });
const storageKey = (account: string) => 'vrcnext-calendar-sync-v1:' + encodeURIComponent(account);
const limitedEvent = (event: CalendarEvent) => ({ ...event, description: event.description?.slice(0, 2048) });

/** Events are API snapshots; reminders are observations of a real followed upcoming event. */
export class CalendarSynchronizer {
  state = empty();
  private listeners = new Set<(state: CalendarSyncState) => void>();
  private notified = new Set<string>();
  private primed = false;
  private generation = 0;
  private retryAt = 0;
  private sessionExpired = false;
  private pending?: Promise<{ applied: boolean; retryAfter: number }>;
  constructor(readonly account: string, private client: Client, private storage?: Storage,
    private now: () => number = () => Date.now()) {
    if (!storage) { this.state.error = 'Кеш событий недоступен: напоминания сохраняются только в текущем запуске.'; return; }
    try {
      const saved = storage.getItem(storageKey(account));
      if (!saved) return;
      const value = JSON.parse(saved) as Record<string, unknown>;
      if (value.version !== 1 || !Array.isArray(value.events) || !Array.isArray(value.reminders) || !Array.isArray(value.notified)) throw new Error();
      this.state.events = value.events.slice(0, 800).map((event) => normalizeCalendarEvent(event));
      this.state.reminders = value.reminders.slice(0, 30).map((item) => {
        if (!item || typeof item !== 'object') throw new Error();
        const reminder = item as Record<string, unknown>;
        if (typeof reminder.id !== 'string' || typeof reminder.createdAt !== 'string') throw new Error();
        return { id: reminder.id, createdAt: reminder.createdAt, event: normalizeCalendarEvent(reminder.event) };
      }).filter((reminder) => Date.parse(reminder.event.startsAt || reminder.event.startDate || '') > this.now());
      this.notified = new Set(value.notified.filter((key): key is string => typeof key === 'string').slice(-1000));
      this.primed = value.primed === true;
      this.state.lastSync = typeof value.lastSync === 'string' ? value.lastSync : undefined;
    } catch { this.state = { ...empty(), error: 'Не удалось прочитать кеш событий. Повторная синхронизация загрузит актуальные данные.' }; }
  }
  subscribe(listener: (state: CalendarSyncState) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(change: Partial<CalendarSyncState>) { this.state = { ...this.state, ...change }; for (const listener of this.listeners) listener(this.state); }
  private persist(): string {
    if (!this.storage) return 'Кеш событий недоступен: напоминания не сохранятся после закрытия приложения.';
    try {
      this.storage.setItem(storageKey(this.account), JSON.stringify({ version: 1, primed: this.primed, lastSync: this.state.lastSync,
        events: this.state.events.slice(0, 800).map(limitedEvent),
        reminders: this.state.reminders.slice(0, 30).map((reminder) => ({ ...reminder, event: limitedEvent(reminder.event) })),
        notified: [...this.notified].slice(-1000) }));
      return '';
    } catch { return 'Не удалось сохранить кеш и напоминания. Проверьте свободную память устройства.'; }
  }
  pause() { this.generation++; this.publish({ loading: false }); }
  /** Only an explicit user retry may resume requests after a 401. */
  retryAuthentication() { this.sessionExpired = false; }
  dismissReminder(id: string) { this.publish({ reminders: this.state.reminders.filter((reminder) => reminder.id !== id) }); const error = this.persist(); if (error) this.publish({ error }); }
  sync(): Promise<{ applied: boolean; retryAfter: number }> {
    if (this.pending) return this.pending;
    if (this.sessionExpired) return Promise.resolve({ applied: false, retryAfter: Infinity });
    if (this.retryAt > this.now()) return Promise.resolve({ applied: false, retryAfter: this.retryAt - this.now() });
    const current = this.generation;
    this.publish({ loading: true });
    this.pending = (async () => {
      try {
        const now = this.now(), date = new Date(now);
        const months = [new Date(date.getFullYear(), date.getMonth(), 1), new Date(date.getFullYear(), date.getMonth() + 1, 1)];
        const snapshots = [];
        for (const month of months) {
          snapshots.push(await this.client.allMonth(month, 'all', 4, () => current === this.generation));
          if (current !== this.generation) return { applied: false, retryAfter: 0 };
        }
        const incomplete = snapshots.some((snapshot) => !snapshot.complete);
        const windowStart = months[0].getTime(), windowEnd = new Date(date.getFullYear(), date.getMonth() + 2, 1).getTime();
        const retained = incomplete ? this.state.events.filter((event) => {
          const start = Date.parse(event.startsAt || event.startDate || ''), end = Date.parse(event.endsAt || event.endDate || '');
          return Number.isFinite(start) && start < windowEnd && (Number.isFinite(end) && end > start ? end > windowStart : start >= windowStart);
        }) : [];
        const events = [...new Map([...retained, ...snapshots.flatMap((snapshot) => snapshot.events)].map((event) => [event.id, event])).values()];
        let groupError = '', groups: Awaited<ReturnType<Client['groups']>> = [];
        try { groups = await this.client.groups(this.account); }
        catch (failure) {
          const status = (failure as { status?: number }).status;
          if (status === 401 || status === 429) throw failure;
          groupError = failure instanceof Error ? failure.message : 'Не удалось получить названия групп.';
        }
        if (current !== this.generation) return { applied: false, retryAfter: 0 };
        const resolved = withCalendarGroups(events, groups);
        const byId = new Map(resolved.map((event) => [event.id, event]));
        const reminders = this.state.reminders.filter((reminder) => {
          const event = byId.get(reminder.event.id);
          return event?.isFollowing === true && event.startsAt === reminder.event.startsAt && Date.parse(event.startsAt || '') > now;
        });
        if (this.primed) for (const event of resolved) {
          const start = Date.parse(event.startsAt || event.startDate || '');
          const key = `${event.id}:${event.startsAt || event.startDate || ''}`;
          if (event.isFollowing === true && Number.isFinite(start) && start > now && start - now <= 15 * 60_000 && !this.notified.has(key)) {
            this.notified.add(key);
            if (this.notified.size > 1000) this.notified.delete(this.notified.values().next().value!);
            reminders.unshift({ id: 'calendar:' + key, event, createdAt: new Date(now).toISOString() });
          }
        }
        this.primed = true;
        this.retryAt = 0;
        const partial = incomplete ? 'Синхронизирована часть событий; ранее загруженные события сохранены. Полный список доступен в календаре через «Ещё события».' : '';
        this.publish({ events: resolved, reminders: reminders.slice(0, 30), lastSync: new Date(now).toISOString(), error: [partial, groupError].filter(Boolean).join(' ') });
        const storageError = this.persist();
        if (storageError) this.publish({ error: [this.state.error, storageError].filter(Boolean).join(' ') });
        return { applied: true, retryAfter: 300_000 };
      } catch (failure) {
        if (current !== this.generation) return { applied: false, retryAfter: 0 };
        this.publish({ error: failure instanceof Error ? failure.message : 'Не удалось синхронизировать события.' });
        const response = failure as { status?: number; retryAfter?: number };
        this.sessionExpired = response.status === 401;
        const retryAfter = response.status === 401 ? Infinity : Math.max(300_000, response.status === 429 ? (response.retryAfter || 60) * 1000 : 0);
        if (response.status === 429) this.retryAt = this.now() + retryAfter;
        return { applied: true, retryAfter };
      } finally {
        this.pending = undefined;
        if (current === this.generation) this.publish({ loading: false });
      }
    })();
    return this.pending;
  }
}

const client = createCalendarClient(api.request);
export function useCalendarSync(account: string | undefined, demo: boolean, online: boolean) {
  const controller = useMemo(() => {
    if (!account || demo) return undefined;
    let storage: Storage | undefined;
    try { storage = localStorage; } catch { /* The controller reports unavailable persistence. */ }
    return new CalendarSynchronizer(account, client, storage);
  }, [account, demo]);
  const [state, setState] = useState<CalendarSyncState>(empty);
  const [foreground, setForeground] = useState(!isNative);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    let handle: PluginListenerHandle | undefined;
    void AndroidApp.addListener('appStateChange', ({ isActive }) => { if (!cancelled) setForeground(isActive); })
      .then((listener) => { if (cancelled) void listener.remove(); else handle = listener; })
      .catch(() => { if (!cancelled) setForeground(false); });
    void AndroidApp.getState().then(({ isActive }) => { if (!cancelled) setForeground(isActive); }).catch(() => {});
    return () => { cancelled = true; void handle?.remove(); };
  }, []);
  useEffect(() => {
    if (!controller) { setState(empty()); return; }
    setState(controller.state);
    return controller.subscribe(setState);
  }, [controller]);
  useEffect(() => {
    if (!controller || !online || !foreground) { controller?.pause(); return; }
    let live = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => document.visibilityState === 'visible';
    const sync = async () => {
      if (!live || !visible()) return;
      const currentAttempt = ++attempt;
      const result = await controller.sync();
      if (live && currentAttempt === attempt && visible() && Number.isFinite(result.retryAfter)) timer = setTimeout(() => void sync(), result.retryAfter);
    };
    const visibility = () => {
      attempt++;
      clearTimeout(timer);
      if (visible()) void sync(); else controller.pause();
    };
    if (visible()) void sync();
    document.addEventListener('visibilitychange', visibility);
    return () => { live = false; attempt++; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); controller.pause(); };
  }, [controller, online, foreground, revision]);
  const refresh = useCallback(() => { controller?.retryAuthentication(); setRevision((value) => value + 1); }, [controller]);
  const dismissReminder = useCallback((id: string) => controller?.dismissReminder(id), [controller]);
  const visible = controller && state === controller.state ? state : controller?.state || empty();
  return { ...visible, refresh, dismissReminder };
}
export type CalendarSync = ReturnType<typeof useCalendarSync>;
