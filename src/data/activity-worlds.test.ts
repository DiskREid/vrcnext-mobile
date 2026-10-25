import { describe, expect, it, vi } from 'vitest';
import { ActivityWorldCache, activityLocationLabel, activityWorldId } from './activity-worlds';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return {promise, resolve};
}

describe('activity world targets', () => {
  it('links disclosed world IDs while keeping hidden/invalid values out of API paths', () => {
    expect(activityWorldId('wrld_real:123~hidden(usr_owner)~region(eu)')).toBe('wrld_real');
    expect(activityWorldId('wrld_real')).toBe('wrld_real');
    for (const value of ['private', 'offline', 'traveling', 'https://x.test/wrld_real', 'wrld_real:12?token=secret', 'wrld_real/other', 'wrld_real:12#fragment', 'wrld_real:12%252Fother', ''])
      expect(activityWorldId(value), value).toBeUndefined();
    expect(activityLocationLabel('private')).toBe('Приватный инстанс');
    expect(activityLocationLabel('offline')).toBe('Не в сети');
  });
});

describe('activity world name cache', () => {
  it('deduplicates visible world names, serializes requests and whitelists cached data', async () => {
    const cache = new ActivityWorldCache();
    const first = deferred<{id:string;name:string;cookie?:string}>();
    const loaderA = vi.fn(() => first.promise), loaderB = vi.fn(async () => ({id:'wrld_b',name:'Second'}));
    const one = cache.load('account', 'wrld_a', loaderA, () => true);
    const duplicate = cache.load('account', 'wrld_a', loaderA, () => true);
    const two = cache.load('account', 'wrld_b', loaderB, () => true);
    await Promise.resolve();
    expect(loaderA).toHaveBeenCalledOnce(); expect(loaderB).not.toHaveBeenCalled();
    first.resolve({id:'wrld_a',name:'First',cookie:'must not be cached'});
    expect(await one).toEqual({id:'wrld_a',name:'First'});
    expect(await duplicate).toEqual({id:'wrld_a',name:'First'});
    expect(await two).toEqual({id:'wrld_b',name:'Second'});
    await cache.load('account', 'wrld_a', loaderA, () => true);
    expect(loaderA).toHaveBeenCalledOnce();
  });

  it('does not dispatch a queued request after its row left the active viewport', async () => {
    const cache = new ActivityWorldCache();
    const first = deferred<{id:string;name:string}>();
    const one = cache.load('account','wrld_a',() => first.promise,() => true);
    let visible = true;
    const loader = vi.fn(async () => ({id:'wrld_b',name:'Second'}));
    const two = cache.load('account','wrld_b',loader,() => visible);
    const cancelled = expect(two).rejects.toThrow('отменена');
    visible = false; first.resolve({id:'wrld_a',name:'First'});
    await one; await cancelled;
    expect(loader).not.toHaveBeenCalled();
  });

  it('keeps a shared queued request when another visible row still needs it', async () => {
    const cache = new ActivityWorldCache();
    const first = deferred<{id:string;name:string}>();
    const one = cache.load('account','wrld_a',() => first.promise,() => true);
    const loader = vi.fn(async () => ({id:'wrld_b',name:'Second'}));
    const hidden = cache.load('account','wrld_b',loader,() => false);
    const visible = cache.load('account','wrld_b',loader,() => true);
    first.resolve({id:'wrld_a',name:'First'}); await one;
    expect(await hidden).toEqual({id:'wrld_b',name:'Second'});
    expect(await visible).toEqual({id:'wrld_b',name:'Second'});
    expect(loader).toHaveBeenCalledOnce();
  });

  it('isolates account permissions, expires names and bounds old entries', async () => {
    let now = 0;
    const cache = new ActivityWorldCache(1,100,() => now);
    const loader = vi.fn(async () => ({id:'wrld_a',name:'First'}));
    await cache.load('first','wrld_a',loader,() => true);
    await cache.load('second','wrld_a',loader,() => true);
    expect(loader).toHaveBeenCalledTimes(2);
    await cache.load('first','wrld_a',loader,() => true);
    expect(loader).toHaveBeenCalledTimes(3);
    now=101; await cache.load('first','wrld_a',loader,() => true);
    expect(loader).toHaveBeenCalledTimes(4);
  });

  it('never caches another returned world or issues an invalid ID request', async () => {
    const cache = new ActivityWorldCache();
    const invalid = vi.fn(async () => ({id:'wrld_a',name:'First'}));
    await expect(cache.load('account','private',invalid,() => true)).rejects.toThrow('ID');
    expect(invalid).not.toHaveBeenCalled();
    await expect(cache.load('account','wrld_a',async () => ({id:'wrld_other',name:'Other'}),() => true)).rejects.toThrow('название');
    expect(await cache.load('account','wrld_a',invalid,() => true)).toEqual({id:'wrld_a',name:'First'});
  });
});
