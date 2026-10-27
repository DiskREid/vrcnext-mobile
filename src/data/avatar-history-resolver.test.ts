import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Avatar } from '../api/types';
import type { HistoryEvent } from './history';
import { AvatarHistoryResolver, fileIdOfAvatarImage } from './avatar-history-resolver';

const origin = Date.parse('2026-10-27T12:00:00Z');
const image = (id: string, version = 1) => `https://api.vrchat.cloud/api/1/file/file_${id}/${version}/file`;
const avatar = (fileId: string): Avatar => ({ id: fileId.replace('file_', 'avtr_'), name: `Avatar ${fileId}`, authorName: 'Creator' });
const event = (id = 'one', change: Partial<HistoryEvent> = {}): HistoryEvent => ({
  id: `event_${id}`, userId: 'usr_alice', displayName: 'Alice', kind: 'avatar',
  source: 'pipeline', time: new Date(origin).toISOString(), detail: 'Обновилось изображение аватара',
  avatarUrl: image(id), after: change.avatarUrl || image(id), avatarEvidence: 'image', ...change,
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const failure = (status: number, retryAfter?: number) => Object.assign(new Error(`AvatarDB ${status}`), { status, retryAfter });
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
function fixture(loader: (fileId: string) => Promise<Avatar | undefined> = async fileId => avatar(fileId)) {
  const enrich = vi.fn(), starts: { fileId: string; time: number }[] = [];
  const resolve = vi.fn((fileId: string) => { starts.push({ fileId, time: Date.now() }); return loader(fileId); });
  const resolver = new AvatarHistoryResolver('usr_account', { resolve, enrich });
  return { resolver, resolve, enrich, starts };
}

describe('avatar event file IDs', () => {
  it('uses a known HTTPS image path without forwarding signatures or mistaking placeholders for avatars', () => {
    expect(fileIdOfAvatarImage(image('actual') + '?auth=never-send#photo')).toBe('file_actual');
    expect(fileIdOfAvatarImage('https://file-variants.vrchat.com/file_actual/2/1024')).toBe('file_actual');
    for (const value of [
      undefined, '', 'not a URL', 'http://api.vrchat.cloud/file_actual/1/file',
      'https://api.vrchat.cloud.evil.test/file_actual/1/file',
      'https://name:secret@api.vrchat.cloud/file_actual/1/file',
      'https://api.vrchat.cloud:8443/file_actual/1/file',
      'https://example.com/file_actual/1/file', 'https://api.vrchat.cloud/image.png?file_actual/1/file',
      image('0e8c4e32-7444-44ea-ade4-313c010d4bae'), image('31255e6b-696e-4c11-b007-595fa1142467'),
    ]) expect(fileIdOfAvatarImage(value)).toBeUndefined();
  });
});

describe('event-only avatar metadata resolution', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(origin); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('has no startup, periodic, refresh, status or background reads', async () => {
    const { resolver, resolve, enrich } = fixture();
    resolver.observe([event()]);
    await tick(3_600_000);
    resolver.setActive(true);
    resolver.observe([
      event('status', { kind: 'status' }), event('online', { kind: 'online' }),
      event('refresh', { source: 'refresh' }), event('profile', { source: 'profile' }),
      event('named', { avatarName: 'Already supplied by the actual event' }),
      event('invalid', { avatarUrl: 'https://example.com/file_one/1/file' }),
    ]);
    await tick(3_600_000);
    expect(resolve).not.toHaveBeenCalled(); expect(enrich).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    resolver.dispose();
  });

  it('resolves only the exact file of a received event and enriches its original ID', async () => {
    const { resolver, starts, enrich } = fixture();
    resolver.setActive(true); resolver.observe([event('one', { avatarUrl: image('one') + '?auth=secret' })]);
    await tick();
    expect(starts).toEqual([{ fileId: 'file_one', time: origin }]);
    expect(enrich).toHaveBeenCalledExactlyOnceWith('event_one', 'file_one', avatar('file_one'));
    await tick(3_600_000); expect(starts).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    resolver.dispose();
  });

  it('uses the changed full image instead of an older thumbnail preview and never substitutes a missing image-evidence URL', async () => {
    const { resolver, resolve, enrich } = fixture();
    resolver.setActive(true);
    resolver.observe([event('one', { after: image('new-full'), avatarUrl: image('old-thumbnail') })]);
    await tick();
    expect(resolve).toHaveBeenCalledExactlyOnceWith('file_new-full');
    expect(enrich).toHaveBeenCalledExactlyOnceWith('event_one', 'file_new-full', avatar('file_new-full'));
    resolver.observe([event('missing', { after: undefined, avatarUrl: image('uncertain-preview') })]);
    await tick(20_000); expect(resolve).toHaveBeenCalledTimes(1);
    resolver.dispose();
  });

  it('deduplicates in-flight file lookups across friends and caches the result across image versions', async () => {
    const held = deferred<Avatar | undefined>();
    const { resolver, resolve, enrich } = fixture(() => held.promise);
    resolver.setActive(true); resolver.observe([event('one')]); await tick();
    resolver.observe([event('bob', { userId: 'usr_bob', avatarUrl: image('one', 2) })]);
    await tick(30_000); expect(resolve).toHaveBeenCalledTimes(1);
    held.resolve(avatar('file_one')); await tick();
    expect(enrich.mock.calls.map(args => args[0])).toEqual(['event_one', 'event_bob']);
    resolver.observe([event('next', { avatarUrl: image('one', 3) })]);
    expect(enrich).toHaveBeenLastCalledWith('event_next', 'file_one', avatar('file_one'));
    expect(resolve).toHaveBeenCalledTimes(1);
    resolver.dispose();
  });

  it('never attaches an old avatar response after a later different or fully named avatar event', async () => {
    const held = deferred<Avatar | undefined>();
    const { resolver, resolve, enrich } = fixture(fileId => fileId === 'file_one' ? held.promise : Promise.resolve(avatar(fileId)));
    resolver.setActive(true); resolver.observe([event('one')]); await tick();
    resolver.observe([event('two')]); await tick(10_000);
    expect(resolve).toHaveBeenCalledTimes(1);
    held.resolve(avatar('file_one')); await tick();
    expect(enrich).toHaveBeenCalledExactlyOnceWith('event_two', 'file_two', avatar('file_two'));
    const again = deferred<Avatar | undefined>();
    const other = fixture(() => again.promise);
    other.resolver.setActive(true); other.resolver.observe([event('three')]); await tick();
    other.resolver.observe([event('four', { avatarName: 'Known newer avatar' })]);
    again.resolve(avatar('file_three')); await tick();
    expect(other.enrich).not.toHaveBeenCalled();
    resolver.dispose(); other.resolver.dispose();
  });

  it('spaces physical requests globally without polling again once the event queue is empty', async () => {
    const { resolver, starts } = fixture();
    resolver.setActive(true);
    resolver.observe([event('one'), event('two', { userId: 'usr_bob' }), event('three', { userId: 'usr_carol' })]);
    await tick(); expect(starts).toHaveLength(1);
    await tick(9_999); expect(starts).toHaveLength(1);
    await tick(1); expect(starts).toHaveLength(2);
    await tick(10_000); expect(starts.map(start => start.time)).toEqual([origin, origin + 10_000, origin + 20_000]);
    await tick(3_600_000); expect(starts).toHaveLength(3); expect(vi.getTimerCount()).toBe(0);
    resolver.dispose();
  });

  it('does not replay events across a background gap or overlap a still-pending older generation', async () => {
    const held = deferred<Avatar | undefined>();
    let attempt = 0;
    const { resolver, resolve, enrich } = fixture(fileId => ++attempt === 1 ? held.promise : Promise.resolve(avatar(fileId)));
    resolver.setActive(true); resolver.observe([event('one')]); await tick();
    resolver.observe([event('queued', { userId: 'usr_bob' })]);
    resolver.setActive(false); resolver.observe([event('background')]); await tick(20_000);
    resolver.setActive(true); resolver.observe([event('new', { avatarUrl: image('one') })]);
    await tick(); expect(resolve).toHaveBeenCalledTimes(1);
    held.resolve(avatar('file_one')); await tick();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(enrich).toHaveBeenCalledExactlyOnceWith('event_new', 'file_one', avatar('file_one'));
    await tick(3_600_000); expect(resolve).toHaveBeenCalledTimes(2);
    resolver.dispose();
  });

  it('ignores disposed-account results and timers while a new account can process its own events', async () => {
    const held = deferred<Avatar | undefined>();
    const old = fixture(() => held.promise), next = fixture();
    old.resolver.setActive(true); old.resolver.observe([event('one')]); await tick();
    old.resolver.dispose(); old.resolver.setActive(true); old.resolver.observe([event('later')]);
    next.resolver.setActive(true); next.resolver.observe([event('new')]); await tick();
    held.resolve(avatar('file_one')); await tick(3_600_000);
    expect(old.enrich).not.toHaveBeenCalled(); expect(old.resolve).toHaveBeenCalledTimes(1);
    expect(next.enrich).toHaveBeenCalledExactlyOnceWith('event_new', 'file_new', avatar('file_new'));
    next.resolver.dispose();
  });

  it('caches unavailable results without erasing events and expires that cache only on a new received event', async () => {
    let available = false;
    const { resolver, resolve, enrich } = fixture(async fileId => available ? avatar(fileId) : undefined);
    resolver.setActive(true); resolver.observe([event('one')]); await tick();
    resolver.observe([event('again', { avatarUrl: image('one', 2) })]); await tick(120_000);
    expect(resolve).toHaveBeenCalledTimes(1); expect(enrich).not.toHaveBeenCalled();
    available = true; resolver.observe([event('new', { avatarUrl: image('one', 3) })]); await tick();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(enrich).toHaveBeenCalledExactlyOnceWith('event_new', 'file_one', avatar('file_one'));
    resolver.dispose();
  });

  it('honors global Retry-After for the already received event and stops after one bounded retry', async () => {
    const { resolver, starts, enrich } = fixture(async () => { throw failure(429, 90); });
    resolver.setActive(true); resolver.observe([event('one')]); await tick();
    await tick(89_999); expect(starts).toHaveLength(1);
    await tick(1); expect(starts).toHaveLength(2);
    await tick(3_600_000); expect(starts).toHaveLength(2);
    expect(enrich).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    resolver.dispose();
  });

  it('keeps transient failures and malformed metadata from fabricating successful avatar names', async () => {
    const { resolver, resolve, enrich } = fixture(async fileId => {
      if (fileId === 'file_one') throw failure(503);
      return { id: 'not-an-avatar', name: 'Wrong result' };
    });
    resolver.setActive(true); resolver.observe([event('one'), event('two', { userId: 'usr_bob' })]);
    await tick(20_000); expect(resolve).toHaveBeenCalledTimes(2);
    expect(enrich).not.toHaveBeenCalled();
    await tick(3_600_000); expect(resolve).toHaveBeenCalledTimes(2);
    resolver.dispose();
  });

  it('retains only bounded history metadata rather than the whole database response', async () => {
    const { resolver, enrich } = fixture(async () => ({
      id: 'avtr_one', name: 'N'.repeat(600), authorName: 'A'.repeat(600),
      description: 'Large response data must not remain in the history resolver cache.',
      tags: ['unrelated'], imageUrl: 'https://example.com/not-history-evidence',
    }));
    resolver.setActive(true); resolver.observe([event('one')]); await tick();
    const metadata = enrich.mock.calls[0][2];
    expect(metadata).toEqual({ id: 'avtr_one', name: 'N'.repeat(256), authorName: 'A'.repeat(256) });
    resolver.observe([event('cached', { avatarUrl: image('one', 2) })]);
    expect(enrich.mock.calls[1][2]).toEqual(metadata);
    resolver.dispose();
  });

  it('bounds a burst of queued event lookups while retaining the newest observed jobs', async () => {
    const { resolver, resolve, starts } = fixture();
    resolver.setActive(true);
    resolver.observe(Array.from({ length: 150 }, (_, index) => event(String(index), { userId: `usr_${index}` })));
    await tick(1_000_000);
    expect(resolve).toHaveBeenCalledTimes(100);
    expect(starts[0].fileId).toBe('file_50'); expect(starts.at(-1)?.fileId).toBe('file_149');
    expect(vi.getTimerCount()).toBe(0);
    resolver.dispose();
  });
});
