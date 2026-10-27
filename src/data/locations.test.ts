import { describe, expect, it } from 'vitest';
import { accessibleLocation, groupFriendLocations, instanceType, presenceLabel } from './locations';
import type { User } from '../api';
const friend = (id: string, location: string): User => ({ id, displayName: id, location });
describe('disclosed friend locations', () => {
  it('groups only exact instance locations, not just a world', () => {
    const groups = groupFriendLocations([
      friend('1', 'wrld_a:1'),
      friend('2', 'wrld_a:1'),
      friend('3', 'wrld_a:2'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].friends.map((u) => u.id)).toEqual(['1', '2']);
  });
  it('does not infer co-presence among users with private/unknown locations', () => {
    const groups = groupFriendLocations([
      friend('1', 'private'),
      friend('2', 'private'),
      friend('3', 'offline'),
      friend('4', ''),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.friends.length === 1 && !g.location)).toBe(true);
  });
  it('preserves first-seen order and de-duplicates the same friend', () => {
    const users = [friend('1', 'wrld_a:1'), friend('2', 'wrld_b:1'), friend('1', 'wrld_a:1')];
    expect(groupFriendLocations(users).map((g) => g.key)).toEqual(['wrld_a:1', 'wrld_b:1']);
    expect(groupFriendLocations(users)[0].friends).toHaveLength(1);
  });
  it('rejects incomplete locations and external URL syntax', () => {
    for (const invalid of [
      'private',
      'offline',
      'wrld_a',
      'https://a:123',
      'wrld_a:../x',
      'wrld_a:1?auth=x',
    ])
      expect(accessibleLocation(invalid)).toBe(false);
    expect(accessibleLocation('wrld_a:1~friends(usr_a)~region(eu)')).toBe(true);
  });
  it('labels observed access types and website presence without inventing a login', () => {
    expect(instanceType('wrld_a:1~hidden(usr_a)')).toBe('Friends+');
    expect(instanceType('wrld_a:1~private(usr_a)~canRequestInvite')).toBe('Invite+');
    expect(instanceType('wrld_a:1~group(grp_a)~groupAccessType(members)')).toBe('Group · members');
    expect(instanceType(undefined, 'group', 'public')).toBe('Group · public');
    expect(presenceLabel({ ...friend('1', 'offline'), state: 'active' })).toBe(
      'На сайте / в приложении',
    );
  });
  it('keeps private, traveling and undisclosed online friends in the game, regardless of preferred status', () => {
    for (const status of ['active', 'join me', 'ask me', 'busy']) {
      expect(presenceLabel({ ...friend('1', 'private'), status })).toBe('В приватном мире');
      expect(presenceLabel({ ...friend('1', 'traveling'), status })).toBe('В VRChat');
      expect(presenceLabel({ id: '1', displayName: 'Friend', state: 'online', status })).toBe('В VRChat');
      expect(presenceLabel({ ...friend('1', 'offline'), state: 'active', status })).toBe('На сайте / в приложении');
      expect(presenceLabel({ ...friend('1', 'offline'), state: 'offline', status })).toBe('Не в сети');
    }
  });
});
