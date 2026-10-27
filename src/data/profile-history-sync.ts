import type { PipelineEvent } from '../api/native';
import type { User } from '../api/types';
import { mergePublicProfile, readPublicProfile } from '../api/profile';

export interface ProfileHistorySyncState {
  pending: number;
  checked: number;
  total: number;
  running: boolean;
  error: string;
  lastSync?: string;
}

type Timer = ReturnType<typeof setTimeout>;
export interface ProfileHistorySyncDependencies {
  load: (userId: string) => Promise<unknown>;
  observe: (fresh: User) => void;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}
type Entry = {
  id: string;
  displayName: string;
  normalDueAt: number;
  lastSuccess?: number;
  cooldownUntil: number;
  priority: boolean;
  manual: boolean;
  error: string;
  revision: number;
  recheck: boolean;
  signals: Partial<Record<'bio' | 'currentAvatar' | 'currentAvatarImageUrl' | 'currentAvatarThumbnailImageUrl', string>>;
};
const requestSpacing = 10_000;
const signalFreshness = 120_000;
const rotationInterval = 300_000;
const validId = (value: unknown): value is string => typeof value === 'string'
  && /^usr_[A-Za-z0-9_-]{1,120}$/.test(value);

function signalValue(field: keyof Entry['signals'], value: string) {
  if (field === 'bio' || field === 'currentAvatar') return value;
  try {
    const url = new URL(value);
    const file = url.pathname.match(/\/(file_[A-Za-z0-9_-]+)\/(\d{1,9})(?:\/|$)/);
    return file ? `${file[1]}:${Number(file[2])}` : `${url.hostname}${url.pathname}`;
  } catch { return value; }
}

/** Foreground, account-owned reads. No profile snapshots or server objects are persisted here. */
export class ProfileHistorySynchronizer {
  state: ProfileHistorySyncState = { pending: 0, checked: 0, total: 0, running: false, error: '' };
  private friends = new Map<string, Entry>();
  private checked = new Set<string>();
  private listeners = new Set<(state: ProfileHistorySyncState) => void>();
  private active = false;
  private disposed = false;
  private sessionExpired = false;
  private generation = 0;
  private timer?: Timer;
  private pending?: Promise<void>;
  private loadingId?: string;
  private nextRequestAt = 0;
  private retryAt = 0;
  private globalError = '';
  private consecutivePriorities = 0;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delay: number) => Timer;
  private readonly clearTimer: (timer: Timer) => void;

  constructor(readonly account: string, private readonly dependencies: ProfileHistorySyncDependencies) {
    this.now = dependencies.now || Date.now;
    this.setTimer = dependencies.setTimer || ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = dependencies.clearTimer || ((timer) => clearTimeout(timer));
  }

  subscribe(listener: (state: ProfileHistorySyncState) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(change: Partial<ProfileHistorySyncState> = {}) {
    if (this.disposed) return;
    const now = this.now();
    this.state = {
      ...this.state,
      checked: this.checked.size,
      total: this.friends.size,
      pending: [...this.friends.values()].filter(entry => entry.priority
        || !this.checked.has(entry.id) || entry.normalDueAt <= now).length,
      error: this.globalError || [...this.friends.values()].find(entry => entry.error)?.error || '',
      ...change,
    };
    for (const listener of this.listeners) listener(this.state);
  }

  setFriends(users: User[]) {
    if (this.disposed) return;
    const next = new Map<string, Entry>();
    for (const user of users) {
      if (!validId(user.id)) continue;
      const entry = this.friends.get(user.id) || {
        id: user.id, displayName: user.displayName || user.id, normalDueAt: this.now(),
        cooldownUntil: 0, priority: false, manual: false, error: '', revision: 0, recheck: false, signals: {},
      };
      let changed = false;
      for (const field of ['bio', 'currentAvatar', 'currentAvatarImageUrl', 'currentAvatarThumbnailImageUrl'] as const) {
        const value = user[field];
        if (typeof value !== 'string') continue;
        const signal = signalValue(field, value);
        if (entry.signals[field] !== undefined && entry.signals[field] !== signal) changed = true;
        entry.signals[field] = signal;
      }
      if (changed) {
        entry.revision++; entry.priority = true;
        if (this.loadingId === entry.id) entry.recheck = true;
      }
      entry.displayName = typeof user.displayName === 'string' ? user.displayName : entry.displayName;
      next.set(entry.id, entry);
    }
    this.friends = next;
    for (const id of this.checked) if (!next.has(id)) this.checked.delete(id);
    this.publish();
    this.schedule();
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    this.generation++;
    this.cancelTimer();
    if (active) {
      // The observer may have paused while the app was hidden: begin fresh samples,
      // never replay snapshots from an unobserved period as a new change.
      this.checked.clear();
      for (const entry of this.friends.values()) entry.normalDueAt = this.now();
      this.schedule();
    }
    this.publish({ running: false });
  }

  /** A WS signal asks for one coalesced read; a recently read profile has a two-minute cache. */
  request(userId?: string) {
    if (userId === undefined) { this.refresh(); return; }
    if (this.disposed) return;
    const entry = this.friends.get(userId);
    if (!entry) return;
    entry.revision++;
    if (this.loadingId === entry.id) entry.recheck = true;
    entry.priority = true;
    this.publish();
    this.schedule();
  }

  /** Explicit user refresh retries authentication and queues a pass, without bypassing rate limits. */
  refresh() {
    if (this.disposed) return;
    this.sessionExpired = false;
    this.globalError = '';
    this.checked.clear();
    for (const entry of this.friends.values()) { entry.priority = true; entry.manual = true; }
    this.publish();
    this.schedule();
  }

  handlePipeline(event: PipelineEvent) {
    if (this.disposed) return;
    const content = event.content;
    const partial = content.user && typeof content.user === 'object' && !Array.isArray(content.user)
      ? content.user as Record<string, unknown> : {};
    const id = content.userId || content.userid || partial.id;
    if (!validId(id)) return;
    if (event.type === 'friend-delete') {
      this.friends.delete(id); this.checked.delete(id); this.publish(); this.schedule();
    } else if (event.type === 'friend-update' || event.type === 'friend-online' || event.type === 'friend-active') {
      this.request(id);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.active = false; this.disposed = true; this.generation++;
    this.cancelTimer(); this.friends.clear(); this.checked.clear(); this.listeners.clear();
  }

  private cancelTimer() {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  private priorityDue(entry: Entry) {
    return Math.max(entry.cooldownUntil,
      entry.manual || entry.recheck || entry.lastSuccess === undefined ? 0 : entry.lastSuccess + signalFreshness);
  }

  private nextEntry() {
    const now = this.now();
    const normal = [...this.friends.values()]
      .filter(entry => Math.max(entry.normalDueAt, entry.cooldownUntil) <= now)
      .sort((a, b) => a.normalDueAt - b.normalDueAt);
    const prioritized = [...this.friends.values()]
      .filter(entry => entry.priority && this.priorityDue(entry) <= now);
    // Signals must not permanently starve an unseen/old friend in a large list.
    if (prioritized.length && (this.consecutivePriorities < 2 || !normal.length)) {
      this.consecutivePriorities++;
      return prioritized[0];
    }
    if (normal.length) { this.consecutivePriorities = 0; return normal[0]; }
    return undefined;
  }

  private schedule() {
    this.cancelTimer();
    if (this.disposed || !this.active || this.sessionExpired || this.pending || !this.friends.size) return;
    const now = this.now();
    const earliest = Math.min(...[...this.friends.values()].map(entry => Math.min(
      Math.max(entry.normalDueAt, entry.cooldownUntil),
      entry.priority ? this.priorityDue(entry) : Infinity,
    )));
    const dueAt = Math.max(this.nextRequestAt, this.retryAt, earliest);
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      this.run();
    }, Math.max(0, dueAt - now));
  }

  private run() {
    if (this.disposed || !this.active || this.pending || this.sessionExpired) return;
    const entry = this.nextEntry();
    if (!entry) { this.schedule(); return; }
    const generation = this.generation;
    const revision = entry.revision;
    entry.priority = false; entry.manual = false; entry.recheck = false;
    this.loadingId = entry.id;
    this.nextRequestAt = this.now() + requestSpacing;
    this.publish({ running: true });
    this.pending = (async () => {
      try {
        const response = await this.dependencies.load(entry.id);
        if (!this.current(generation, entry) || revision !== entry.revision) return;
        const publicProfile = readPublicProfile(response, entry.id);
        // Only identity comes from the existing row. Missing avatar/Bio fields
        // remain missing instead of resurrecting stale values from the friend list.
        const fresh = mergePublicProfile({ id: entry.id, displayName: entry.displayName }, publicProfile);
        this.dependencies.observe(fresh);
        const now = this.now();
        entry.lastSuccess = now; entry.normalDueAt = now + rotationInterval;
        entry.cooldownUntil = 0; entry.error = ''; this.globalError = '';
        this.checked.add(entry.id);
        this.publish({ lastSync: new Date(now).toISOString() });
      } catch (failure) {
        if (!this.currentSession(generation)) return;
        const response = failure as { status?: number; retryAfter?: number };
        const message = failure instanceof Error ? failure.message : 'Не удалось получить публичный профиль.';
        const now = this.now();
        if (response?.status === 401) {
          this.sessionExpired = true; this.globalError = message;
        } else if (response?.status === 429) {
          const seconds = typeof response.retryAfter === 'number' && Number.isFinite(response.retryAfter)
            ? Math.max(0, response.retryAfter) : 60;
          this.retryAt = now + Math.max(requestSpacing, seconds * 1000);
          this.globalError = message; entry.normalDueAt = this.retryAt;
        } else {
          // A response to an older signal must not delay its fresh replacement.
          if (!this.current(generation, entry) || revision !== entry.revision) return;
          entry.cooldownUntil = now + (response?.status === 403 || response?.status === 404 ? rotationInterval : signalFreshness);
          entry.normalDueAt = entry.cooldownUntil;
          entry.error = `${entry.displayName}: ${message}`;
        }
        this.publish();
      }
    })().finally(() => {
      this.pending = undefined;
      this.loadingId = undefined;
      if (this.disposed) return;
      this.publish({ running: false });
      this.schedule();
    });
  }

  private current(generation: number, entry: Entry) {
    return this.currentSession(generation) && this.friends.get(entry.id) === entry;
  }

  private currentSession(generation: number) {
    return !this.disposed && this.active && generation === this.generation;
  }
}
