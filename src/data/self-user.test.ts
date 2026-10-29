import { describe, expect, it } from 'vitest';
import type { User } from '../api';
import { normalizeSelfUser, selfUserUpdate, sameSelfPresence } from './self-user';
import { presenceIndicator } from './presence';

const self: User = {
  id: 'usr_self',
  displayName: 'Self',
  state: 'offline',
  status: 'ask me',
  currentLocation: 'wrld_a:1',
};

describe('signed-in game presence', () => {
  it('uses the actual auth currentLocation even though auth state and location say offline', () => {
    const raw = { ...self, location: 'offline' };
    expect(normalizeSelfUser(raw)).toMatchObject({
      location: 'wrld_a:1',
      state: 'online',
      worldId: 'wrld_a',
      instanceId: '1',
    });
    expect(presenceIndicator(normalizeSelfUser(raw))).toMatchObject({ mode: 'game', color: 'ask' });
    expect(raw.location).toBe('offline');
    expect(raw.state).toBe('offline');
  });
  it('preserves the full tagged instance identifier', () => {
    const currentLocation = 'wrld_a:42~hidden(usr_owner)~region(eu)~nonce(secret)';
    expect(normalizeSelfUser({ ...self, currentLocation })).toMatchObject({
      location: currentLocation,
      instanceId: currentLocation.split(':')[1],
    });
  });
  it('clears stale components when the actual snapshot reports offline or privacy', () => {
    for (const currentLocation of ['offline', 'private', 'traveling', '']) {
      const user = normalizeSelfUser({
        ...self,
        currentLocation,
        location: 'wrld_old:9',
        worldId: 'wrld_old',
        instanceId: '9',
      });
      expect(user.location).toBe(currentLocation);
      expect(user.worldId).toBeUndefined();
      expect(user.instanceId).toBeUndefined();
      expect(user.state).toBe(
        currentLocation === 'private' || currentLocation === 'traveling' ? 'online' : 'offline',
      );
    }
  });
  it('keeps compatible self responses without the dedicated field', () => {
    expect(
      normalizeSelfUser({
        id: self.id,
        displayName: self.displayName,
        location: 'wrld_a:1',
        state: 'offline',
      }).state,
    ).toBe('online');
    expect(normalizeSelfUser({ id: self.id, displayName: self.displayName })).toEqual({
      id: self.id,
      displayName: self.displayName,
    });
  });
});

describe('self REST and pipeline ordering', () => {
  it('rejects stale REST location evidence after a pipeline move or account change', () => {
    const before = normalizeSelfUser(self);
    const moved = selfUserUpdate(
      { type: 'user-location', content: { location: 'wrld_b:2' } },
      before,
    )!.user;
    expect(sameSelfPresence(before, moved)).toBe(false);
    expect(sameSelfPresence(before, { ...before, state: 'offline' })).toBe(false);
    expect(sameSelfPresence(before, { ...before, id: 'usr_other' })).toBe(false);
    expect(sameSelfPresence(before, null)).toBe(false);
    expect(
      sameSelfPresence(before, { ...before, bio: 'A profile change without a location change' }),
    ).toBe(true);
    expect(sameSelfPresence(before, { ...before })).toBe(true);
  });
});

describe('own pipeline payloads', () => {
  it('handles user-location without a user id and does not retain stale auth location', () => {
    const update = selfUserUpdate(
      { type: 'user-location', content: { location: 'wrld_b:2' } },
      self,
    )!;
    expect(update.locationChanged).toBe(true);
    expect(update.patch).toEqual({
      location: 'wrld_b:2',
      currentLocation: 'wrld_b:2',
      worldId: 'wrld_b',
      instanceId: '2',
      state: 'online',
    });
    expect(update.user).toMatchObject({
      id: self.id,
      displayName: self.displayName,
      status: 'ask me',
      location: 'wrld_b:2',
    });
    expect(normalizeSelfUser(update.user).location).toBe('wrld_b:2');
  });
  it('accepts nested and root own updates but marks absent locations as unobserved', () => {
    for (const content of [
      { user: { id: self.id, bio: 'New bio' } },
      { id: self.id, bio: 'New bio' },
      { user: { bio: 'New bio' } },
    ]) {
      const update = selfUserUpdate({ type: 'user-update', content }, self)!;
      expect(update.patch).toEqual({ bio: 'New bio' });
      expect(update.locationChanged).toBe(false);
      expect(update.user.currentLocation).toBe('wrld_a:1');
    }
  });
  it('prefers the protocol root location over a nested stale profile location', () => {
    const update = selfUserUpdate(
      {
        type: 'user-location',
        content: {
          location: 'wrld_new:2',
          user: { currentLocation: 'wrld_old:1', location: 'wrld_old:1' },
        },
      },
      self,
    )!;
    expect(update.patch.location).toBe('wrld_new:2');
    expect(update.patch.currentLocation).toBe('wrld_new:2');
  });
  it('composes only two fresh disclosed components and never uses old half-identifiers', () => {
    const previous = normalizeSelfUser(self);
    expect(
      selfUserUpdate({ type: 'user-update', content: { user: { instanceId: '2' } } }, previous)
        ?.locationChanged,
    ).toBe(false);
    expect(
      selfUserUpdate(
        { type: 'user-update', content: { user: { worldId: 'wrld_b', instanceId: '2' } } },
        previous,
      )?.patch.location,
    ).toBe('wrld_b:2');
    expect(
      selfUserUpdate(
        {
          type: 'user-update',
          content: { user: { location: 'private', worldId: 'wrld_b', instanceId: '2' } },
        },
        previous,
      )?.patch,
    ).toMatchObject({ location: 'private', worldId: undefined, instanceId: undefined });
  });
  it('ignores unrelated and conflicting identities without touching the signed-in user', () => {
    for (const content of [
      { userId: 'usr_foreign', location: 'wrld_b:2' },
      { userId: self.id, user: { id: 'usr_foreign', bio: 'Wrong' } },
    ])
      expect(selfUserUpdate({ type: 'user-location', content }, self)).toBeUndefined();
    expect(
      selfUserUpdate(
        { type: 'friend-location', content: { userId: self.id, location: 'wrld_b:2' } },
        self,
      ),
    ).toBeUndefined();
    expect(selfUserUpdate({ type: 'user-update', content: {} }, self)).toBeUndefined();
  });
  it('does not persist arbitrary auth data from a pipeline payload', () => {
    const update = selfUserUpdate(
      {
        type: 'user-update',
        content: {
          user: {
            id: self.id,
            displayName: 'Renamed',
            authToken: 'private-token',
            cookies: 'private-cookie',
          },
        },
      },
      self,
    )!;
    expect(update.patch).toEqual({ displayName: 'Renamed' });
    expect(JSON.stringify(update)).not.toContain('private-token');
    expect(JSON.stringify(update)).not.toContain('private-cookie');
  });
  it('treats repeated location as a fresh sample and clears stale data on real offline event', () => {
    const same = selfUserUpdate(
      { type: 'user-location', content: { location: 'wrld_a:1' } },
      self,
    )!;
    expect(same.locationChanged).toBe(true);
    const offline = selfUserUpdate(
      { type: 'user-location', content: { location: 'offline' } },
      same.user,
    )!;
    expect(offline.user).toMatchObject({
      state: 'offline',
      location: 'offline',
      currentLocation: 'offline',
      worldId: undefined,
      instanceId: undefined,
    });
  });
});
