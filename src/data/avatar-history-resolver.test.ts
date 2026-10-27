import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvatarMetadata } from '../api/types';
import type { HistoryEvent } from './history';
import { AvatarHistoryResolver, fileIdOfAvatarImage } from './avatar-history-resolver';

const origin = Date.parse('2026-10-27T12:00:00Z');
const image = (id: string, version = 1) => 'https://api.vrchat.cloud/api/1/file/file_' + id + '/' + version + '/file';
const avatar = (fileId: string): AvatarMetadata => ({ id: fileId.replace('file_', 'avtr_'), name: 'Avatar ' + fileId, authorName: 'Creator' });
const event = (id = 'one', change: Partial<HistoryEvent> = {}): HistoryEvent => ({
  id: 'event_' + id, userId: 'usr_alice', displayName: 'Alice', kind: 'avatar',
  source: 'pipeline', time: new Date(origin).toISOString(), detail: 'Обновилось изображение аватара',
  avatarUrl: image(id), after: change.avatarUrl || image(id), avatarEvidence: 'image', ...change,
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const failure = (status: number, retryAfter?: number) => Object.assign(new Error('AvatarDB ' + status), { status, retryAfter });
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
function fixture(loader: (fileId: string) => Promise<AvatarMetadata | undefined> = async fileId => avatar(fileId)) {
  const enrich = vi.fn(), starts: { fileId: string; time: number }[] = [];
  const resolve = vi.fn((fileId: string) => { starts.push({ fileId, time: Date.now() }); return loader(fileId); });
  const resolver = new AvatarHistoryResolver('usr_account', { resolve, enrich });
  return { resolver, resolve, enrich, starts };
}

describe('avatar event file IDs', () => {
  it('accepts trusted versionless and CDN file paths without forwarding signatures or mistaking placeholders for avatars', () => {
    for (const value of [
      image('actual') + '?auth=never-send#photo',
      'https://file-variants.vrchat.com/file_actual/2/1024',
      'https://files.vrchat.cloud/thumb/file_actual',
      'https://files.vrchat.cloud/thumb/file_actual.png?signature=never-send',
      'https://api.vrchat.cloud/api/1/image/file_actual',
    ]) expect(fileIdOfAvatarImage(value)).toBe('file_actual');
    for (const value of [
      undefined, '', 'not a URL', 'http://api.vrchat.cloud/file_actual/1/file',
      'https://api.vrchat.cloud.evil.test/file_actual/1/file',
      'https://name:secret@api.vrchat.cloud/file_actual/1/file',
      'https://api.vrchat.cloud:8443/file_actual/1/file',
      'https://example.com/file_actual/1/file', 'https://api.vrchat.cloud/image.png?file_actual/1/file',
      image('0e8c4e32-7444-44ea-ade4-313c010d4bae'), image('31255e6b-696e-4c11-b007-595fa1142467'),
      'https://files.vrchat.cloud/thumb/file_0e8c4e32-7444-44ea-ade4-313c010d4bae.png',
      'https://api.vrchat.cloud/file_' + 'x'.repeat(121),
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

  it('resolves the exact received after-file and retains its event ID and side', async () => {
    const { resolver, starts, enrich } = fixture();
    resolver.setActive(true); resolver.observe([event('one', { avatarUrl: image('one') + '?auth=secret' })]);
    await tick();
    expect(starts).toEqual([{ fileId: 'file_one', time: origin }]);
    expect(enrich).toHaveBeenCalledExactlyOnceWith('event_one', 'file_one', avatar('file_one'), 'after');
    await tick(3_600_000); expect(starts).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    resolver.dispose();
  });

  it('resolves both actual transition sides without querying unrelated friends', async () => {
    const { resolver, starts, enrich } = fixture();
    resolver.setActive(true);
    resolver.observe([event('new', { before: image('old'), previousAvatarUrl: image('old'), previousAvatarFileId: 'file_old', avatarFileId: 'file_new' })]);
    await tick();
    expect(starts).toEqual([{ fileId: 'file_new', time: origin }]);
    expect(enrich).toHaveBeenCalledWith('event_new', 'file_new', avatar('file_new'), 'after');
    await tick(1_000);
    expect(starts).toEqual([{ fileId: 'file_new', time: origin }, { fileId: 'file_old', time: origin + 1_000 }]);
    expect(enrich).toHaveBeenCalledWith('event_new', 'file_old', avatar('file_old'), 'before');
    expect(enrich).toHaveBeenCalledTimes(2);
    await tick(3_600_000); expect(starts).toHaveLength(2);
    resolver.dispose();
  });

  it('uses explicit file evidence and the changed full image instead of an older thumbnail', async () => {
    const { resolver, resolve, enrich } = fixture();
    resolver.setActive(true);
    resolver.observe([event('one', { after: image('new-full'), avatarUrl: image('old-thumbnail') })]);
    await tick();
    expect(resolve).toHaveBeenCalledExactlyOnceWith('file_new-full');
    expect(enrich).toHaveBeenCalledExactlyOnceWith('event_one', 'file_new-full', avatar('file_new-full'), 'after');
    resolver.observe([event('missing', { after: undefined, avatarUrl: image('uncertain-preview') })]);
    await tick(20_000); expect(resolve).toHaveBeenCalledTimes(1);
    resolver.observe([event('explicit', { avatarFileId: 'file_explicit', after: undefined, avatarUrl: image('stale-preview') })]);
    await tick();
    expect(resolve).toHaveBeenLastCalledWith('file_explicit');
    expect(enrich).toHaveBeenLastCalledWith('event_explicit', 'file_explicit', avatar('file_explicit'), 'after');
    resolver.dispose();
  });

  it('looks up only the unknown side when the actual event already supplies a name', async () => {
    const { resolver, resolve, enrich } = fixture();
    resolver.setActive(true);
    resolver.observe([event('new', { avatarName: 'Known new name', previousAvatarFileId: 'file_old' })]);
    await tick();
    expect(resolve).toHaveBeenCalledExactlyOnceWith('file_old');
    expect(enrich).toHaveBeenCalledExactlyOnceWith('event_new', 'file_old', avatar('file_old'), 'before');
    resolver.observe([event('other', { previousAvatarName: 'Known old name', previousAvatarFileId: 'file_old' })]);
    await tick(1_000);
    expect(resolve.mock.calls.map(args => args[0])).toEqual(['file_old', 'file_other']);
    expect(enrich).toHaveBeenLastCalledWith('event_other', 'file_other', avatar('file_other'), 'after');
    resolver.dispose();
  });

  it('deduplicates in-flight lookups across friends and both sides, then reuses the cached file across image versions', async () => {
    const held = deferred<AvatarMetadata | undefined>();
    const { resolver, resolve, enrich } = fixture(() => held.promise);
    resolver.setActive(true); resolver.observe([event('one')]); await tick();
    resolver.observe([event('bob', { userId: 'usr_bob', avatarName: 'Known Bob avatar', previousAvatarFileId: 'file_one' })]);
    await tick(30_000); expect(resolve).toHaveBeenCalledTimes(1);
    held.resolve(avatar('file_one')); await tick();
    expect(enrich.mock.calls).toEqual([
      ['event_one', 'file_one', avatar('file_one'), 'after'],
      ['event_bob', 'file_one', avatar('file_one'), 'before'],
    ]);
    resolver.observe([event('next', { avatarUrl: image('one', 3) })]);
    expect(enrich).toHaveBeenLastCalledWith('event_next', 'file_one', avatar('file_one'), 'after');
    expect(resolve).toHaveBeenCalledTimes(1);
    resolver.dispose();
  });

  it('preserves late metadata for each historical event instead of dropping older transitions of the same person', async () => {
    const held = deferred<AvatarMetadata | undefined>();
    const { resolver, resolve, enrich } = fixture(fileId => fileId === 'file_b' ? held.promise : Promise.resolve(avatar(fileId)));
    resolver.setActive(true);
    resolver.observe([event('a-to-b', { avatarFileId: 'file_b', previousAvatarFileId: 'file_a' })]); await tick();
    resolver.observe([event('b-to-c', { avatarFileId: 'file_c', previousAvatarFileId: 'file_b' })]);
    await tick(2_000); expect(resolve).toHaveBeenCalledTimes(1);
    held.resolve(avatar('file_b')); await tick(); await tick(1_000);
    expect(enrich.mock.calls).toEqual([
      ['event_a-to-b', 'file_b', avatar('file_b'), 'after'],
      ['event_b-to-c', 'file_b', avatar('file_b'), 'before'],
      ['event_a-to-b', 'file_a', avatar('file_a'), 'before'],
      ['event_b-to-c', 'file_c', avatar('file_c'), 'after'],
    ]);
    resolver.dispose();
  });

  it('does not cancel an older event lookup when a later event already has its own name', async () => {
    const held = deferred<AvatarMetadata | undefined>();
    const { resolver, resolve, enrich } = fixture(() => held.promise);
    resolver.setActive(true); resolver.observe([event('one')]); await tick();
    resolver.observe([event('two', { avatarName: 'Already known later avatar' })]);
    held.resolve(avatar('file_one')); await tick();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(enrich).toHaveBeenCalledExactlyOnceWith('event_one', 'file_one', avatar('file_one'), 'after');
    resolver.dispose();
  });

  it('spaces physical requests by one second and stops all scheduling when the received event queue is empty', async () => {
    const { resolver, starts } = fixture();
    resolver.setActive(true);
    resolver.observe([event('one'), event('two', { userId: 'usr_bob' }), event('three', { userId: 'usr_carol' })]);
    await tick(); expect(starts).toHaveLength(1);
    await tick(999); expect(starts).toHaveLength(1);
    await tick(1); expect(starts).toHaveLength(2);
    await tick(1_000); expect(starts.map(start => start.time)).toEqual([origin, origin + 1_000, origin + 2_000]);
    await tick(3_600_000); expect(starts).toHaveLength(3); expect(vi.getTimerCount()).toBe(0);
    resolver.dispose();
  });

  it('does not replay events across a background gap or overlap a still-pending older generation', async () => {
    const held = deferred<AvatarMetadata | undefined>();
    let attempt = 0;
    const { resolver, resolve, enrich } = fixture(fileId => ++attempt === 1 ? held.promise : Promise.resolve(avatar(fileId)));
    resolver.setActive(true); resolver.observe([event('one')]); await tick();
    resolver.observe([event('queued', { userId: 'usr_bob' })]);
    resolver.setActive(false); resolver.observe([event('background')]); await tick(20_000);
    resolver.setActive(true); resolver.observe([event('new', { avatarUrl: image('one') })]);
    await tick(); expect(resolve).toHaveBeenCalledTimes(1);
    held.resolve(avatar('file_one')); await tick();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(enrich).toHaveBeenCalledExactlyOnceWith('event_new', 'file_one', avatar('file_one'), 'after');
    await tick(3_600_000); expect(resolve).toHaveBeenCalledTimes(2);
    resolver.dispose();
  });

  it('ignores disposed-account results and timers while the next account processes its own events', async () => {
    const held = deferred<AvatarMetadata | undefined>();
    const old = fixture(() => held.promise), next = fixture();
    old.resolver.setActive(true); old.resolver.observe([event('one')]); await tick();
    old.resolver.dispose(); old.resolver.setActive(true); old.resolver.observe([event('later')]);
    next.resolver.setActive(true); next.resolver.observe([event('new')]); await tick();
    held.resolve(avatar('file_one')); await tick(3_600_000);
    expect(old.enrich).not.toHaveBeenCalled(); expect(old.resolve).toHaveBeenCalledTimes(1);
    expect(next.enrich).toHaveBeenCalledExactlyOnceWith('event_new', 'file_new', avatar('file_new'), 'after');
    next.resolver.dispose();
  });

  it('accepts an honest file-derived name with no guessed avatar ID and preserves its source', async () => {
    const metadata: AvatarMetadata = { name: 'Name read from a real VRChat file', source: 'vrchat-file' };
    const { resolver, enrich } = fixture(async () => metadata);
    resolver.setActive(true); resolver.observe([event('one')]); await tick();
    expect(enrich).toHaveBeenCalledExactlyOnceWith('event_one', 'file_one', metadata, 'after');
    resolver.observe([event('cached', { avatarFileId: 'file_one' })]);
    expect(enrich).toHaveBeenLastCalledWith('event_cached', 'file_one', metadata, 'after');
    expect(enrich.mock.calls.every(args => args[2].id === undefined)).toBe(true);
    resolver.dispose();
  });

  it('caches unavailable results without erasing events and retries only after a new event past cache expiry', async () => {
    let available = false;
    const { resolver, resolve, enrich } = fixture(async fileId => available ? avatar(fileId) : undefined);
    resolver.setActive(true); resolver.observe([event('one')]); await tick();
    resolver.observe([event('again', { avatarUrl: image('one', 2) })]); await tick(120_000);
    expect(resolve).toHaveBeenCalledTimes(1); expect(enrich).not.toHaveBeenCalled();
    available = true; resolver.observe([event('new', { avatarUrl: image('one', 3) })]); await tick();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(enrich).toHaveBeenCalledExactlyOnceWith('event_new', 'file_one', avatar('file_one'), 'after');
    resolver.dispose();
  });

  it('honors Retry-After for the received event and stops after one bounded retry', async () => {
    const { resolver, starts, enrich } = fixture(async () => { throw failure(429, 90); });
    resolver.setActive(true); resolver.observe([event('one')]); await tick();
    await tick(89_999); expect(starts).toHaveLength(1);
    await tick(1); expect(starts).toHaveLength(2);
    await tick(3_600_000); expect(starts).toHaveLength(2);
    expect(enrich).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    resolver.dispose();
  });

  it('applies a database cooldown to both queued transition sides without overlapping requests', async () => {
    let attempts = 0;
    const { resolver, starts, enrich } = fixture(async fileId => {
      if (fileId === 'file_new' && ++attempts === 1) throw failure(429, 90);
      return avatar(fileId);
    });
    resolver.setActive(true); resolver.observe([event('new', { previousAvatarFileId: 'file_old' })]); await tick();
    await tick(89_999); expect(starts).toHaveLength(1);
    await tick(1); expect(starts.map(start => start.fileId)).toEqual(['file_new', 'file_new']);
    await tick(999); expect(starts).toHaveLength(2);
    await tick(1);
    expect(starts).toEqual([
      { fileId: 'file_new', time: origin },
      { fileId: 'file_new', time: origin + 90_000 },
      { fileId: 'file_old', time: origin + 91_000 },
    ]);
    expect(enrich).toHaveBeenCalledWith('event_new', 'file_new', avatar('file_new'), 'after');
    expect(enrich).toHaveBeenCalledWith('event_new', 'file_old', avatar('file_old'), 'before');
    resolver.dispose();
  });

  it('leaves failed or malformed metadata unresolved without fabricating successful names', async () => {
    const { resolver, resolve, enrich } = fixture(async fileId => {
      if (fileId === 'file_one') throw failure(503);
      return { id: 'not-an-avatar', name: 'Wrong result' };
    });
    resolver.setActive(true); resolver.observe([event('one'), event('two', { userId: 'usr_bob' })]);
    await tick(2_000); expect(resolve).toHaveBeenCalledTimes(2);
    expect(enrich).not.toHaveBeenCalled();
    await tick(3_600_000); expect(resolve).toHaveBeenCalledTimes(2);
    resolver.dispose();
  });

  it('retains only bounded history metadata rather than descriptions and image payloads', async () => {
    const { resolver, enrich } = fixture(async () => ({
      id: 'avtr_one', name: 'N'.repeat(600), authorName: 'A'.repeat(600), source: 'icu',
      description: 'Large response data must not remain in the history resolver cache.',
      tags: ['unrelated'], imageUrl: 'https://example.com/not-history-evidence',
    }));
    resolver.setActive(true); resolver.observe([event('one')]); await tick();
    const metadata = enrich.mock.calls[0][2];
    expect(metadata).toEqual({ id: 'avtr_one', name: 'N'.repeat(256), authorName: 'A'.repeat(256), source: 'icu' });
    resolver.observe([event('cached', { avatarUrl: image('one', 2) })]);
    expect(enrich.mock.calls[1][2]).toEqual(metadata);
    resolver.dispose();
  });

  it('bounds a burst of queued event lookups while keeping the newest observed jobs', async () => {
    const { resolver, resolve, starts } = fixture();
    resolver.setActive(true);
    resolver.observe(Array.from({ length: 150 }, (_, index) => event(String(index), { userId: 'usr_' + index })));
    await tick(100_000);
    expect(resolve).toHaveBeenCalledTimes(100);
    expect(starts[0].fileId).toBe('file_50'); expect(starts.at(-1)?.fileId).toBe('file_149');
    expect(vi.getTimerCount()).toBe(0);
    resolver.dispose();
  });

  it('evicts old cached files so a new real event can re-resolve them instead of keeping unbounded history metadata', async () => {
    const { resolver, resolve } = fixture();
    resolver.setActive(true);
    resolver.observe(Array.from({ length: 100 }, (_, index) => event(String(index))));
    await tick(100_000); expect(resolve).toHaveBeenCalledTimes(100);
    resolver.observe([event('extra')]); await tick();
    expect(resolve).toHaveBeenCalledTimes(101);
    resolver.observe([event('return', { avatarFileId: 'file_0' })]); await tick(1_000);
    expect(resolve).toHaveBeenCalledTimes(102);
    expect(resolve).toHaveBeenLastCalledWith('file_0');
    resolver.dispose();
  });
});
