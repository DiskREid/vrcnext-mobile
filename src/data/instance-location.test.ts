import { describe, expect, it } from 'vitest';
import type { User } from '../api';
import { disclosedUserLocation, groupFriendLocations } from './locations';
import { friendsInInstance, instanceCount, instanceCreator, instanceGroup } from './instance-location';

const location = 'wrld_test:123~hidden(usr_host)~region(eu)';
const friend = (id: string, place = location): User => ({ id, displayName: id, location: place });

describe('disclosed instance information', () => {
  it('uses fresh worldId and instanceId only when location is absent', () => {
    const fields = { worldId: 'wrld_test', instanceId: '123~hidden(usr_host)~region(eu)' };
    expect(disclosedUserLocation(fields)).toBe(location);
    for (const hidden of ['private', 'offline', 'traveling', '', 'wrld_test:private'])
      expect(disclosedUserLocation({ ...fields, location: hidden })).toBeUndefined();
    expect(disclosedUserLocation({ worldId: 'wrld_test', instanceId: 'private' })).toBeUndefined();
    expect(disclosedUserLocation({ worldId: 'wrld_test', instanceId: 'offline' })).toBeUndefined();
    expect(groupFriendLocations([{ id: 'usr_a', displayName: 'A', ...fields }])[0].location).toBe(location);
  });
  it('uses the actual creator or documented owner tags and does not treat group ownership as a creator', () => {
    expect(instanceCreator(location)).toBe('usr_host');
    expect(instanceCreator('wrld_test:1~friends(usr_friend)')).toBe('usr_friend');
    expect(instanceCreator('wrld_test:1~private(usr_private)~canRequestInvite')).toBe('usr_private');
    expect(instanceCreator(location, { creatorId: 'usr_actual', ownerId: 'usr_other' })).toBe('usr_actual');
    expect(instanceCreator(location, { hidden: 'usr_response' })).toBe('usr_response');
    expect(instanceCreator('wrld_test:1~group(grp_a)', { ownerId: 'grp_a' })).toBeUndefined();
    expect(instanceGroup('wrld_test:1~group(grp_a)')).toBe('grp_a');
    expect(instanceGroup(location, { ownerId: 'grp_owner' })).toBe('grp_owner');
    expect(instanceCreator('https://invalid/~hidden(usr_x)')).toBeUndefined();
  });
  it('lists only known same-instance friends, honoring the fresh viewed profile over an older friend row', () => {
    const users = [friend('usr_viewed'), friend('usr_same'), friend('usr_other', 'wrld_test:124'), friend('usr_private', 'private')];
    expect(friendsInInstance(location, users).map((user) => user.id)).toEqual(['usr_viewed', 'usr_same']);
    expect(friendsInInstance(location, users, { ...friend('usr_viewed', 'private'), isFriend: true }).map((user) => user.id)).toEqual(['usr_same']);
    expect(friendsInInstance(location, users, { ...friend('usr_viewed'), isFriend: false }).map((user) => user.id)).toEqual(['usr_same']);
    expect(friendsInInstance(location, users, { ...friend('usr_viewed'), isFriend: false }, { users: [{ id: 'usr_viewed', displayName: 'Old friend', isFriend: true }] }).map((user) => user.id)).toEqual(['usr_same']);
    expect(friendsInInstance(location, [], { ...friend('usr_viewed'), isFriend: true }).map((user) => user.id)).toEqual(['usr_viewed']);
    expect(friendsInInstance('private', users)).toEqual([]);
  });
  it('accepts a real roster as presence evidence without calling unknown players friends', () => {
    const users = [friend('usr_known', 'offline')];
    const roster = { users: [{ id: 'usr_known' }, { id: 'usr_unknown', displayName: 'Unknown', isFriend: false }, { id: 'usr_confirmed', displayName: 'Confirmed', isFriend: true }] };
    expect(friendsInInstance(location, users, undefined, roster).map((user) => user.id)).toEqual(['usr_known', 'usr_confirmed']);
  });
  it('does not manufacture or coerce counts', () => {
    expect(instanceCount(0)).toBe(0); expect(instanceCount(12)).toBe(12);
    for (const unknown of [null, undefined, '', '12', -1, NaN, Infinity, 1.5]) expect(instanceCount(unknown)).toBeUndefined();
  });
});
