import { describe, expect, it } from 'vitest';
import type { User } from '../api';
import { HistoryObserver, HistoryJournal } from './history';
import { GameObserver, friendStatistics, intervalMs } from './game-history';
import { MemoryHistoryStore } from './history-storage';
import { normalizeSelfUser, selfUserUpdate } from './self-user';

const self: User = {
  id: 'usr_self',
  displayName: 'Self',
  state: 'offline',
  status: 'active',
  currentLocation: 'wrld_a:1',
  bio: 'Original',
  currentAvatar: 'avtr_old',
};
const friend: User = {
  id: 'usr_friend',
  displayName: 'Friend',
  state: 'online',
  location: 'wrld_a:1',
};
const origin = Date.parse('2026-10-29T08:00:00Z');
const at = (seconds: number) => new Date(origin + seconds * 1000).toISOString();
function observer() {
  let id = 0;
  return new HistoryObserver(
    () => at(0),
    () => `event_${++id}`,
  );
}

describe('own real activity feed', () => {
  it('seeds the first real auth snapshot without a fabricated login or changes', () => {
    const history = observer();
    expect(history.observeSelf(self)).toEqual([]);
    expect(history.observeSelf(self)).toEqual([]);
    expect(
      history.observePipeline(
        { type: 'user-location', content: { location: 'wrld_a:1' } },
        [],
        self,
      ),
    ).toEqual([]);
  });
  it('logs own world and instance events with their true navigation target', () => {
    const history = observer();
    history.observeSelf(self);
    const instance = history.observePipeline(
      { type: 'user-location', content: { location: 'wrld_a:2' } },
      [],
      self,
    );
    expect(instance).toMatchObject([
      {
        kind: 'instance',
        userId: self.id,
        displayName: self.displayName,
        before: 'wrld_a:1',
        after: 'wrld_a:2',
        location: 'wrld_a:2',
        worldId: 'wrld_a',
        source: 'pipeline',
      },
    ]);
    expect(
      history.observePipeline(
        { type: 'user-location', content: { location: 'wrld_b:3' } },
        [],
        self,
      ),
    ).toMatchObject([{ kind: 'world', before: 'wrld_a:2', after: 'wrld_b:3', worldId: 'wrld_b' }]);
  });
  it('records actual self online/offline transitions once and keeps private locations private', () => {
    const history = observer();
    history.observeSelf({ ...self, currentLocation: 'offline' });
    expect(history.observeSelf(self)).toMatchObject([{ kind: 'online' }, { kind: 'world' }]);
    expect(
      history.observePipeline(
        { type: 'user-location', content: { location: 'private' } },
        [],
        self,
      ),
    ).toMatchObject([{ kind: 'world', after: 'private', location: 'private' }]);
    const offline = history.observePipeline(
      { type: 'user-location', content: { location: 'offline' } },
      [],
      self,
    );
    expect(offline).toMatchObject([{ kind: 'offline', userId: self.id }]);
    expect(
      history.observePipeline(
        { type: 'user-location', content: { location: 'offline' } },
        [],
        self,
      ),
    ).toEqual([]);
  });
  it('uses the known self snapshot when the first pipeline message beats the sampler', () => {
    expect(
      observer().observePipeline(
        { type: 'user-location', content: { location: 'wrld_b:2' } },
        [],
        self,
      ),
    ).toMatchObject([{ kind: 'world', before: 'wrld_a:1', after: 'wrld_b:2' }]);
  });
  it('records received self avatar/bio/status updates without inherited location or friend profile requests', () => {
    const history = observer();
    history.observeSelf(self);
    const changes = history.observePipeline(
      {
        type: 'user-update',
        content: { user: { currentAvatar: 'avtr_new', bio: 'New', status: 'ask me' } },
      },
      [],
      self,
    );
    expect(changes.map((event) => event.kind)).toEqual(['bio', 'avatar', 'status']);
    expect(changes.find((event) => event.kind === 'avatar')).toMatchObject({
      before: 'avtr_old',
      after: 'avtr_new',
      avatarEvidence: 'id',
    });
    expect(changes.every((event) => event.userId === self.id && event.source === 'pipeline')).toBe(
      true,
    );
    expect(
      history.observePipeline(
        {
          type: 'user-update',
          content: { user: { currentAvatar: 'avtr_new', bio: 'New', status: 'ask me' } },
        },
        [],
        self,
      ),
    ).toEqual([]);
  });
  it('does not let foreign self events or malformed updates pollute the journal', () => {
    const history = observer();
    history.observeSelf(self);
    expect(
      history.observePipeline(
        { type: 'user-update', content: { user: { id: friend.id, bio: 'Foreign' } } },
        [friend],
        self,
      ),
    ).toEqual([]);
    expect(
      history.observePipeline(
        { type: 'user-location', content: { userId: friend.id, location: 'wrld_b:2' } },
        [friend],
        self,
      ),
    ).toEqual([]);
    expect(history.observePipeline({ type: 'user-location', content: {} }, [], self)).toEqual([]);
  });
  it('labels API snapshot changes as observation rather than inventing past events', () => {
    const history = observer();
    history.observeSelf(self);
    expect(history.observeSelf({ ...self, currentLocation: 'wrld_b:2' }, 'sync')).toMatchObject([
      { kind: 'world', source: 'sync', before: 'wrld_a:1', after: 'wrld_b:2', time: at(0) },
    ]);
    history.pause();
    expect(history.observeSelf({ ...self, currentLocation: 'wrld_c:3' }, 'sync')).toEqual([]);
  });
  it('starts a silent baseline after suspension without erasing actual friend or own pipeline observations', () => {
    const history = observer();
    history.observeSelf(self);
    history.seedUsers([friend]);
    expect(
      history.observeSelf(
        {
          ...self,
          currentLocation: 'wrld_b:2',
          bio: 'Changed while suspended',
          currentAvatar: 'avtr_unobserved',
        },
        'sync',
        true,
      ),
    ).toEqual([]);
    expect(
      history.observePipeline(
        { type: 'user-location', content: { location: 'wrld_c:3' } },
        [],
        self,
      ),
    ).toMatchObject([{ kind: 'world', before: 'wrld_b:2', after: 'wrld_c:3' }]);
    expect(
      history.observePipeline(
        { type: 'friend-location', content: { userId: friend.id, location: 'wrld_a:2' } },
        [friend],
        self,
      ),
    ).toMatchObject([{ kind: 'instance', before: 'wrld_a:1', after: 'wrld_a:2' }]);
  });
});

describe('actual auth and own pipeline locations reach analytics storage', () => {
  it('records real visits, time and known encounters from the dedicated auth location', async () => {
    let seconds = 0,
      id = 0;
    const store = new MemoryHistoryStore();
    const game = new GameObserver(
      () => at(seconds),
      () => `game_${++id}`,
    );
    const journal = new HistoryJournal(self.id, store, game);
    journal.observeSession(normalizeSelfUser(self), [friend], 'api');
    seconds = 120;
    journal.observeSession(normalizeSelfUser(self), [friend], 'api');
    const own = selfUserUpdate(
      { type: 'user-location', content: { location: 'wrld_b:2' } },
      normalizeSelfUser(self),
    )!;
    seconds = 180;
    journal.observeSession(own.user, [friend], 'pipeline');
    await journal.flushGame();
    const data = await store.readGame(self.id);
    expect(data.visits).toHaveLength(2);
    const visited = data.visits.find((visit) => visit.location === 'wrld_a:1')!;
    expect(visited).toMatchObject({
      start: at(0),
      lastObserved: at(120),
      end: at(120),
      reason: 'location-change',
    });
    expect(intervalMs(visited)).toBe(120_000);
    expect(friendStatistics(data.visits, friend.id)).toEqual({
      encounters: 1,
      totalMs: 120_000,
      lastMeeting: at(120),
    });
    expect(data.visits.find((visit) => visit.location === 'wrld_b:2')?.participants).toEqual([]);
  });
  it('retains visits while never creating time or encounters from an app suspension', async () => {
    let seconds = 0,
      id = 0;
    const game = new GameObserver(
      () => at(seconds),
      () => `game_${++id}`,
    );
    const journal = new HistoryJournal(self.id, new MemoryHistoryStore(), game);
    journal.observeSession(normalizeSelfUser(self), [friend], 'api');
    seconds = 30;
    journal.pauseSession();
    seconds = 3600;
    journal.observeSession(normalizeSelfUser({ ...self, currentLocation: 'wrld_b:2' }), [], 'api');
    expect(journal.state.visits).toHaveLength(2);
    expect(journal.state.visits.every((visit) => intervalMs(visit) === 0)).toBe(true);
    expect(journal.state.visits.find((visit) => visit.location === 'wrld_b:2')?.start).toBe(
      at(3600),
    );
  });
});
