type PreviewLoader = () => Promise<string>;
type Job = { live: (() => boolean)[]; promise: Promise<string> };

/** Keep pending requests separate from the bounded LRU: eviction must never duplicate a download. */
export class ImagePreviewCache {
  private ready = new Map<string, string>();
  private pending = new Map<string, Job>();
  private queue: (() => void)[] = [];
  private active = 0;
  private bytes = 0;
  private generation = 0;
  constructor(private maxBytes = 8 * 1024 * 1024, private maxEntries = 96) {}
  clear() { this.generation++; this.ready.clear(); this.pending.clear(); this.bytes = 0; }
  private pump() { while (this.active < 2 && this.queue.length) this.queue.shift()!(); }
  load(key: string, loader: PreviewLoader, live: () => boolean): Promise<string> {
    const cached = this.ready.get(key);
    if (cached) { this.ready.delete(key); this.ready.set(key, cached); return Promise.resolve(cached); }
    const old = this.pending.get(key);
    if (old) { old.live.push(live); return old.promise; }
    const generation = this.generation;
    const job: Job = { live: [live], promise: Promise.resolve('') };
    job.promise = new Promise<string>((resolve, reject) => {
      this.queue.push(() => {
        this.active++;
        Promise.resolve().then(() => {
          if (generation !== this.generation || !job.live.some((current) => current())) throw new Error('Image request cancelled');
          return loader();
        }).then((data) => {
          if (generation !== this.generation) throw new Error('Image request cancelled');
          if (!data.startsWith('data:image/')) throw new Error('Invalid image preview');
          const size = data.length * 2;
          if (size <= this.maxBytes / 2) {
            this.ready.set(key, data); this.bytes += size;
            while (this.bytes > this.maxBytes || this.ready.size > this.maxEntries) {
              const first = this.ready.keys().next().value!;
              this.bytes -= this.ready.get(first)!.length * 2; this.ready.delete(first);
            }
          }
          resolve(data);
        }).catch(reject).finally(() => {
          if (this.pending.get(key) === job) this.pending.delete(key);
          this.active--; this.pump();
        });
      });
    });
    this.pending.set(key, job); this.pump();
    return job.promise;
  }
}
