export interface ActivityWorldLabel { id: string; name: string; }

/** Historical values are data. Only a disclosed world ID may become an API/link target. */
export function activityWorldId(value?: string): string | undefined {
  if (!value) return undefined;
  const match = /^(wrld_[A-Za-z0-9-]+)(?::[A-Za-z0-9~_().+\-]+)?$/.exec(value);
  return match?.[1];
}

export function activityLocationLabel(value?: string): string {
  if (value === 'private') return 'Приватный инстанс';
  if (value === 'offline') return 'Не в сети';
  if (value === 'traveling') return 'Переходит в другой мир';
  return 'Местоположение не передано';
}

type Pending = { live: (() => boolean)[]; promise: Promise<ActivityWorldLabel> };

/** Small account-scoped metadata cache. Visible rows share one serial request queue. */
export class ActivityWorldCache {
  private saved = new Map<string, { world: ActivityWorldLabel; expires: number }>();
  private pending = new Map<string, Pending>();
  private queue: Promise<void> = Promise.resolve();
  constructor(private max = 128, private ttl = 15 * 60_000, private now: () => number = () => Date.now()) {}

  load(account: string, id: string, loader: () => Promise<ActivityWorldLabel>, live: () => boolean, force = false): Promise<ActivityWorldLabel> {
    if (activityWorldId(id) !== id) return Promise.reject(new Error('Некорректный ID мира.'));
    const key = account + ':' + id;
    const cached = this.saved.get(key);
    if (!force && cached && cached.expires > this.now()) {
      this.saved.delete(key); this.saved.set(key, cached);
      return Promise.resolve(cached.world);
    }
    const existing = this.pending.get(key);
    if (existing) { existing.live.push(live); return existing.promise; }
    const job: Pending = { live: [live], promise: Promise.resolve({id, name: id}) };
    job.promise = this.queue.then(async () => {
      if (!job.live.some((current) => current())) throw new Error('Загрузка названия мира отменена.');
      const value = await loader();
      if (value.id !== id || typeof value.name !== 'string' || !value.name.trim()) throw new Error('VRChat не передал название этого мира.');
      const world = { id, name: value.name.slice(0, 512) };
      this.saved.delete(key); this.saved.set(key, { world, expires: this.now() + this.ttl });
      while (this.saved.size > this.max) this.saved.delete(this.saved.keys().next().value!);
      return world;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, job);
    this.queue = job.promise.then(() => {}, () => {});
    return job.promise;
  }
}
