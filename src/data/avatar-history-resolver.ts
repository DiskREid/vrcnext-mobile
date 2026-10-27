import type { AvatarMetadata } from '../api/types';
import type { HistoryEvent } from './history';

const imageHosts = new Set([
  'api.vrchat.cloud', 'api.vrchat.com', 'files.vrchat.cloud', 'file-variants.vrchat.com',
  'assets.vrchat.com', 'vrchat.com', 'cloud.vrchat.com',
]);
const placeholderFiles = new Set([
  'file_0e8c4e32-7444-44ea-ade4-313c010d4bae',
  'file_31255e6b-696e-4c11-b007-595fa1142467',
]);

/** Only the real avatar image's file ID is sent to AvatarDB, never URL queries or user data. */
export function fileIdOfAvatarImage(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 4096) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !imageHosts.has(url.hostname)) return;
    // VRChat also sends versionless thumbnail paths. The file ID is independent
    // of version, resolution and the host's chosen path layout.
    const match = url.pathname.match(/\/(file_[A-Za-z0-9_-]{1,120})(?=\/|\.|$)/i);
    const id = match?.[1];
    if (id && !placeholderFiles.has(id.toLowerCase())) return id;
  } catch { /* Invalid or unsupported images need no external lookup. */ }
}

type Timer = ReturnType<typeof setTimeout>;
export interface AvatarHistoryResolverDependencies {
  resolve: (fileId: string) => Promise<AvatarMetadata | undefined>;
  enrich: (eventId: string, fileId: string, avatar: AvatarMetadata, side: 'before' | 'after') => void;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}
type Waiter = { eventId: string; side: 'before' | 'after' };
type Job = { fileId: string; waiters: Map<string, Waiter>; attempts: number };
type Cached = { avatar?: AvatarMetadata; expiresAt: number };
const requestSpacing = 1_000;
const positiveTtl = 600_000;
const negativeTtl = 120_000;
const maxJobs = 100;
const maxWaiters = 1000;

/**
 * Metadata for already received avatar events only. There is no friend/profile
 * enumeration, initial read, periodic refresh, or background replay.
 */
export class AvatarHistoryResolver {
  private active = false;
  private disposed = false;
  private generation = 0;
  private timer?: Timer;
  private pending?: Promise<void>;
  private currentJob?: Job;
  private jobs = new Map<string, Job>();
  private cache = new Map<string, Cached>();
  private nextRequestAt = 0;
  private retryAt = 0;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delay: number) => Timer;
  private readonly clearTimer: (timer: Timer) => void;

  constructor(readonly account: string, private readonly dependencies: AvatarHistoryResolverDependencies) {
    this.now = dependencies.now || Date.now;
    this.setTimer = dependencies.setTimer || ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = dependencies.clearTimer || (timer => clearTimeout(timer));
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    this.generation++;
    this.cancelTimer();
    if (!active) {
      this.jobs.clear();
      this.currentJob = undefined;
      // Keep the physical pending request until it settles. Its older generation
      // cannot deliver metadata or overlap a new request after foregrounding.
    } else this.schedule();
  }

  observe(events: HistoryEvent[]) {
    if (this.disposed || !this.active) return;
    for (const event of events) {
      if (event.kind !== 'avatar' || event.source !== 'pipeline') continue;
      // Each side belongs to this exact historical event/file pair. A later
      // user's switch must not discard the names of an earlier real switch.
      const sides = [
        { side:'after' as const, name:event.avatarName, fileId:event.avatarFileId || fileIdOfAvatarImage(event.after)
          || (event.avatarEvidence !== 'image' ? fileIdOfAvatarImage(event.avatarUrl) : undefined) },
        { side:'before' as const, name:event.previousAvatarName, fileId:event.previousAvatarFileId
          || fileIdOfAvatarImage(event.before) || fileIdOfAvatarImage(event.previousAvatarUrl) },
      ];
      for (const {side,name,fileId} of sides) {
      if (name?.trim() || !fileId || !/^file_[A-Za-z0-9_-]{1,120}$/.test(fileId) || placeholderFiles.has(fileId.toLowerCase())) continue;
      const waiter = { eventId:event.id, side };
      const key = `${event.id}:${side}`;
      const cached = this.cache.get(fileId);
      if (cached && cached.expiresAt > this.now()) {
        this.cache.delete(fileId);
        this.cache.set(fileId, cached);
        if (cached.avatar) this.deliver(waiter, fileId, cached.avatar);
        continue;
      }
      if (cached) this.cache.delete(fileId);
      const job = this.currentJob?.fileId === fileId ? this.currentJob : this.jobs.get(fileId);
      if (job) {
        job.waiters.set(key, waiter);
        while (job.waiters.size > maxWaiters) job.waiters.delete(job.waiters.keys().next().value!);
      } else {
        this.jobs.set(fileId, { fileId, waiters: new Map([[key, waiter]]), attempts: 0 });
        while (this.jobs.size > maxJobs) this.jobs.delete(this.jobs.keys().next().value!);
      }
      }
    }
    this.schedule();
  }

  dispose() {
    if (this.disposed) return;
    this.setActive(false);
    this.disposed = true;
    this.cache.clear();
  }

  private deliver(waiter: Waiter, fileId: string, avatar: AvatarMetadata) {
    if (this.active && !this.disposed)
      this.dependencies.enrich(waiter.eventId, fileId, { ...avatar }, waiter.side);
  }

  private cancelTimer() {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  private schedule() {
    this.cancelTimer();
    if (!this.active || this.disposed || this.pending || !this.jobs.size) return;
    const due = Math.max(this.nextRequestAt, this.retryAt);
    this.timer = this.setTimer(() => { this.timer = undefined; this.run(); }, Math.max(0, due - this.now()));
  }

  private remember(fileId: string, avatar?: AvatarMetadata) {
    this.cache.delete(fileId);
    this.cache.set(fileId, { avatar, expiresAt: this.now() + (avatar ? positiveTtl : negativeTtl) });
    while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
  }

  private run() {
    if (!this.active || this.disposed || this.pending) return;
    const job = this.jobs.values().next().value as Job | undefined;
    if (!job) return;
    this.jobs.delete(job.fileId);
    this.currentJob = job;
    const generation = this.generation;
    this.nextRequestAt = this.now() + requestSpacing;
    job.attempts++;
    this.pending = (async () => {
      try {
        const result = await this.dependencies.resolve(job.fileId);
        if (this.disposed || !this.active || generation !== this.generation) return;
        // History needs only these bounded fields. Do not retain full public DB
        // descriptions, package arrays, arbitrary extra fields, or image blobs.
        const avatar: AvatarMetadata | undefined = result && (!result.id || /^avtr_[A-Za-z0-9_-]{1,120}$/.test(result.id))
          && typeof result.name === 'string' && result.name.trim() ? {
            ...(result.id ? {id:result.id} : {}), name: result.name.trim().slice(0, 256),
            ...(result.source ? {source:result.source} : {}),
            ...(typeof result.authorName === 'string' && result.authorName.trim()
              ? { authorName: result.authorName.trim().slice(0, 256) } : {}),
          } : undefined;
        this.remember(job.fileId, avatar);
        if (avatar) for (const waiter of job.waiters.values()) this.deliver(waiter, job.fileId, avatar);
      } catch (error) {
        if (this.disposed || !this.active || generation !== this.generation) return;
        const failure = error as { status?: number; retryAfter?: number };
        if (failure?.status === 429) {
          const seconds = typeof failure.retryAfter === 'number' && Number.isFinite(failure.retryAfter)
            ? Math.min(86_400, Math.max(0, failure.retryAfter)) : 60;
          this.retryAt = this.now() + Math.max(requestSpacing, seconds * 1000);
          if (job.attempts < 2) {
            if (job.waiters.size) this.jobs = new Map([[job.fileId, job] as [string, Job], ...this.jobs].slice(0, maxJobs));
          } else this.remember(job.fileId);
        } else this.remember(job.fileId);
        // A failed lookup never removes/replaces the actual observed image event.
      }
    })().finally(() => {
      this.pending = undefined;
      this.currentJob = undefined;
      this.schedule();
    });
  }
}
