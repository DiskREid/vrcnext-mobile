import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileHistorySynchronizer } from './profile-history-sync';
import type { User } from '../api/types';

const alice: User = { id: 'usr_alice', displayName: 'Alice' };
const bob: User = { id: 'usr_bob', displayName: 'Bob' };
const origin = Date.parse('2026-10-27T09:00:00Z');
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function failure(status: number, retryAfter?: number) {
  return Object.assign(new Error(`API ${status}`), { status, retryAfter });
}
function fixture(loader: (id: string) => Promise<unknown> = async id => ({ id, bio: `Bio ${id}` })) {
  const observe = vi.fn(), starts: { id: string; time: number }[] = [];
  const load = vi.fn((id: string) => { starts.push({ id, time: Date.now() }); return loader(id); });
  const sync = new ProfileHistorySynchronizer('usr_account', { load, observe });
  return { sync, load, observe, starts };
}
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

describe('foreground public profile history synchronization', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(origin); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('waits for an active account and spaces requests globally, then rotates each profile after five minutes', async () => {
    const { sync, starts, observe } = fixture();
    sync.setFriends([alice, bob]);
    await tick(60_000); expect(starts).toEqual([]);
    sync.setActive(true); await tick();
    expect(starts).toEqual([{ id: alice.id, time: origin + 60_000 }]);
    await tick(9_999); expect(starts).toHaveLength(1);
    await tick(1); expect(starts[1]).toEqual({ id: bob.id, time: origin + 70_000 });
    expect(sync.state).toMatchObject({ checked: 2, total: 2, pending: 0, running: false });
    await tick(289_999); expect(starts).toHaveLength(2);
    await tick(1); expect(starts[2]).toEqual({ id: alice.id, time: origin + 360_000 });
    expect(observe).toHaveBeenCalledTimes(3);
    sync.dispose();
  });

  it('observes only returned public fields and the current friend identity, never old profile or auth-bearing fields', async () => {
    const { sync, observe } = fixture(async id => ({ id, bio: '', currentAvatarName: 'New avatar', currentAvatarAuthorName: 'Creator', authToken: 'secret', location: 'private', displayName: 'Old server name' }));
    sync.setFriends([{ ...alice, bio: 'Old biography', currentAvatar: 'avtr_old', currentAvatarImageUrl: 'https://api.vrchat.cloud/api/1/file/file_old/1/file' }]);
    sync.setActive(true); await tick();
    expect(observe).toHaveBeenCalledWith({ id: alice.id, displayName: alice.displayName, bio: '', currentAvatarName: 'New avatar', currentAvatarAuthorName: 'Creator' });
    expect(JSON.stringify(observe.mock.calls)).not.toContain('secret');
    sync.dispose();
  });

  it('coalesces websocket requests into a two-minute user cache and explicit refresh still respects global spacing', async () => {
    const { sync, starts } = fixture();
    sync.setFriends([alice]); sync.setActive(true); await tick();
    for (let i = 0; i < 5; i++) sync.handlePipeline({ type: 'friend-update', content: { userId: alice.id } });
    await tick(119_999); expect(starts).toHaveLength(1);
    await tick(1); expect(starts).toHaveLength(2);
    sync.refresh(); sync.refresh(); await tick(9_999); expect(starts).toHaveLength(2);
    await tick(1); expect(starts).toHaveLength(3);
    sync.dispose();
  });

  it('does not let prioritized friends starve an unseen normal friend', async () => {
    const { sync, starts } = fixture();
    const users = Array.from({ length: 6 }, (_, index) => ({ id: `usr_${index + 1}`, displayName: `${index + 1}` }));
    sync.setFriends(users);
    for (const id of ['usr_4', 'usr_5', 'usr_6']) sync.request(id);
    sync.setActive(true); await tick(20_000);
    expect(starts.map(start => start.id)).toEqual(['usr_4', 'usr_5', 'usr_1']);
    sync.dispose();
  });

  it('never overlaps physical requests, discards background results and waits for the old request before resuming', async () => {
    const first = deferred<unknown>();
    const { sync, load, observe, starts } = fixture(id => load.mock.calls.length === 1 ? first.promise : Promise.resolve({ id, bio: 'Fresh' }));
    sync.setFriends([alice, bob]); sync.setActive(true); await tick();
    expect(sync.state.running).toBe(true);
    sync.setActive(false); await tick(20_000); sync.setActive(true); await tick();
    expect(starts).toHaveLength(1);
    first.resolve({ id: alice.id, bio: 'Background result' }); await tick();
    expect(observe.mock.calls.flat()).not.toContainEqual(expect.objectContaining({ bio: 'Background result' }));
    expect(starts).toHaveLength(2);
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ bio: 'Fresh' }));
    sync.dispose();
  });

  it('discards a profile made stale by a newer websocket signal and rechecks it after global spacing', async () => {
    const first = deferred<unknown>();
    const { sync, load, starts, observe } = fixture(id => load.mock.calls.length === 1 ? first.promise : Promise.resolve({ id, bio: 'Newest' }));
    sync.setFriends([alice]); sync.setActive(true); await tick();
    sync.handlePipeline({ type: 'friend-update', content: { userId: alice.id } });
    first.resolve({ id: alice.id, bio: 'Stale' }); await tick();
    expect(observe).not.toHaveBeenCalled();
    await tick(9_999); expect(starts).toHaveLength(1);
    await tick(1); expect(observe).toHaveBeenCalledWith(expect.objectContaining({ bio: 'Newest' }));
    sync.dispose();
  });

  it('ignores a stale per-user failure rather than applying its five-minute cooldown to the fresh signal', async () => {
    const first = deferred<unknown>();
    const { sync, load, observe } = fixture(id => load.mock.calls.length === 1 ? first.promise : Promise.resolve({ id, bio: 'Available now' }));
    sync.setFriends([alice]); sync.setActive(true); await tick();
    sync.handlePipeline({ type: 'friend-update', content: { user: { id: alice.id } } });
    first.reject(failure(404)); await tick();
    expect(sync.state.error).toBe('');
    await tick(10_000); expect(observe).toHaveBeenCalledWith(expect.objectContaining({ bio: 'Available now' }));
    sync.dispose();
  });

  it('drops an in-flight response when fresh friend-list avatar evidence changes and keeps new reads within the user cache', async () => {
    const first = deferred<unknown>();
    const { sync, load, starts, observe } = fixture(id => load.mock.calls.length === 1 ? first.promise : Promise.resolve({ id, bio: 'Fresh' }));
    const image = (id: string) => `https://api.vrchat.cloud/api/1/file/${id}/1/file`;
    sync.setFriends([{ ...alice, currentAvatarImageUrl: image('file_old') }]); sync.setActive(true); await tick();
    sync.setFriends([{ ...alice, currentAvatarImageUrl: image('file_new') }]);
    first.resolve({ id: alice.id, bio: 'Stale' }); await tick();
    expect(observe).not.toHaveBeenCalled();
    await tick(10_000); expect(starts).toHaveLength(2);
    sync.setFriends([{ ...alice, currentAvatarImageUrl: image('file_later') }]);
    await tick(119_999); expect(starts).toHaveLength(2);
    await tick(1); expect(starts).toHaveLength(3);
    sync.dispose();
  });

  it('ignores avatar URL token, resolution and CDN changes as new read signals', async () => {
    const { sync, starts } = fixture();
    sync.setFriends([{ ...alice, currentAvatarImageUrl: 'https://api.vrchat.cloud/api/1/file/file_same/2/file?token=old' }]);
    sync.setActive(true); await tick();
    sync.setFriends([{ ...alice, currentAvatarImageUrl: 'https://files.vrchat.cloud/image/file_same/2/1024?token=new#hash' }]);
    await tick(299_999); expect(starts).toHaveLength(1);
    await tick(1); expect(starts).toHaveLength(2);
    sync.dispose();
  });

  it('halts globally on 401 until manual retry without bypassing request spacing', async () => {
    let expired = true;
    const { sync, starts } = fixture(async id => { if (expired) throw failure(401); return { id, bio: 'Restored' }; });
    sync.setFriends([alice, bob]); sync.setActive(true); await tick();
    expect(sync.state.error).toContain('401');
    sync.request(bob.id); await tick(60_000); expect(starts).toHaveLength(1);
    expired = false; sync.refresh(); await tick(); expect(starts).toHaveLength(2);
    await tick(10_000); expect(starts).toHaveLength(3);
    expect(sync.state.error).toBe('');
    sync.dispose();
  });

  it('honors global Retry-After even if a new signal made the rate-limited response stale', async () => {
    const first = deferred<unknown>();
    const { sync, load, starts } = fixture(id => load.mock.calls.length === 1 ? first.promise : Promise.resolve({ id }));
    sync.setFriends([alice, bob]); sync.setActive(true); await tick();
    sync.request(alice.id); first.reject(failure(429, 90)); await tick();
    sync.refresh(); await tick(89_999); expect(starts).toHaveLength(1);
    await tick(1); expect(starts).toHaveLength(2);
    sync.dispose();
  });

  it('holds only forbidden friends for five minutes while letting other friends complete', async () => {
    const { sync, starts } = fixture(async id => { if (id === alice.id) throw failure(403); return { id }; });
    sync.setFriends([alice, bob]); sync.setActive(true); await tick(10_000);
    expect(starts.map(start => start.id)).toEqual([alice.id, bob.id]);
    expect(sync.state).toMatchObject({ checked: 1, total: 2 });
    expect(sync.state.error).toContain('Alice');
    sync.refresh(); await tick(289_999);
    expect(starts.filter(start => start.id === alice.id)).toHaveLength(1);
    await tick(1); expect(starts.filter(start => start.id === alice.id)).toHaveLength(2);
    sync.dispose();
  });

  it('rejects mismatched identities and does not observe missing fields as an empty biography', async () => {
    const { sync, observe } = fixture(async id => id === alice.id ? { id: bob.id, bio: 'Wrong person' } : { id });
    sync.setFriends([alice, bob]); sync.setActive(true); await tick(10_000);
    expect(sync.state.error).toContain('другого пользователя');
    expect(observe.mock.calls).toEqual([[{ id: bob.id, displayName: bob.displayName }]]);
    sync.dispose();
  });

  it('forgets removed friends and prevents disposed-account results or timers from affecting the next account', async () => {
    const waiting = deferred<unknown>();
    const old = fixture(() => waiting.promise), fresh = fixture();
    const listener = vi.fn(); old.sync.subscribe(listener);
    old.sync.setFriends([alice]); old.sync.setActive(true); await tick();
    old.sync.handlePipeline({ type: 'friend-delete', content: { userId: alice.id } });
    old.sync.dispose(); const publishedBefore = listener.mock.calls.length;
    fresh.sync.setFriends([bob]); fresh.sync.setActive(true); await tick();
    waiting.resolve({ id: alice.id, bio: 'Previous account' }); await tick(600_000);
    expect(old.observe).not.toHaveBeenCalled();
    expect(old.starts).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(publishedBefore);
    expect(fresh.observe.mock.calls.flat().every(user => user.id === bob.id)).toBe(true);
    fresh.sync.dispose();
  });
});
