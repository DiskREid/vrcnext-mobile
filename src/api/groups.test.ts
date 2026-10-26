import { describe, expect, it } from 'vitest';
import { commonProfileGroups, groupMembership, normalizeGroups, profileGroupForViewer } from './groups';
import type { Group } from './types';

const group = (id: string, extra: Partial<Group> = {}): Group => ({ id, name: id, ...extra });

describe('group identifiers and membership evidence', () => {
  it('normalizes flat membership IDs and nested group wrappers without losing viewer evidence', () => {
    expect(normalizeGroups([
      { id: 'gmem_first', groupId: 'grp_first', name: 'First', mutualGroup: true },
      { id: 'gmem_second', membershipStatus: 'member', group: { id: 'grp_second', name: 'Second', iconUrl: 'https://example.test/icon.png' } },
    ])).toMatchObject([
      { id: 'grp_first', name: 'First', mutualGroup: true },
      { id: 'grp_second', name: 'Second', membershipStatus: 'member', iconUrl: 'https://example.test/icon.png' },
    ]);
  });

  it('deduplicates by real group ID and rejects a membership-only or contradictory identifier', () => {
    expect(normalizeGroups([{ id: 'grp_one', name: 'Old' }, { id: 'gmem_one', groupId: 'grp_one', name: 'Fresh' }])).toEqual([
      { id: 'grp_one', groupId: 'grp_one', name: 'Fresh' },
    ]);
    expect(() => normalizeGroups([{ id: 'gmem_only', name: 'Unknown group' }])).toThrow('идентификатора');
    expect(() => normalizeGroups([{ groupId: 'grp_one', group: { id: 'grp_other', name: 'Mismatch' } }])).toThrow('идентификатора');
  });

  it('unites own membership intersection, a mutualGroup flag and loaded mutual pages', () => {
    const target = [group('grp_own'), group('grp_flag', { mutualGroup: true }), group('grp_pending'), group('grp_other')];
    const own = [group('grp_own'), group('grp_pending', { membershipStatus: 'requested' }), group('grp_unrelated')];
    const mutual = [group('grp_private')];
    const result = commonProfileGroups(target, own, mutual);
    expect([...result.ids]).toEqual(['grp_private', 'grp_own', 'grp_flag']);
    expect(result.groups.map((item) => item.id)).toEqual(['grp_own', 'grp_flag', 'grp_private']);
    expect(result.groups.every((item) => item.mutualGroup)).toBe(true);
    expect(result.ids.has('grp_pending')).toBe(false);
  });

  it('keeps known common evidence when another list is absent and never infers shared membership from a target status alone', () => {
    const target = [group('grp_target', { membershipStatus: 'member' }), group('grp_common', { mutualGroup: true })];
    expect(commonProfileGroups(target, [], []).groups.map((item) => item.id)).toEqual(['grp_common']);
    expect(commonProfileGroups([], [], [group('grp_private')]).groups.map((item) => item.id)).toEqual(['grp_private']);
  });

  it('distinguishes unknown, member, absent, invited and requested states', () => {
    expect(groupMembership(group('grp_one'))).toBe('unknown');
    expect(groupMembership(group('grp_one', { mutualGroup: true }))).toBe('member');
    expect(groupMembership(group('grp_one', { myMember: { membershipStatus: 'member' } }))).toBe('member');
    expect(groupMembership(group('grp_one', { myMember: null, mutualGroup: true, membershipStatus: 'member' }))).toBe('not-member');
    expect(groupMembership(group('grp_one', { membershipStatus: 'inactive' }))).toBe('not-member');
    expect(groupMembership(group('grp_one', { membershipStatus: 'requested', myMember: { id: 'gmem_pending' } }))).toBe('requested');
    expect(groupMembership(group('grp_one', { membershipStatus: 'invited' }))).toBe('invited');
    expect(groupMembership(group('grp_one', { membershipStatus: 'banned' }))).toBe('blocked');
  });

  it('does not present a foreign target membership row as proof that the viewer joined', () => {
    const targetMembership = group('grp_target', { membershipStatus: 'member', isMember: true });
    expect(groupMembership(profileGroupForViewer(targetMembership, false, false))).toBe('unknown');
    expect(groupMembership(profileGroupForViewer(targetMembership, true, false))).toBe('member');
    expect(groupMembership(profileGroupForViewer(targetMembership, false, true))).toBe('member');
    expect(groupMembership(profileGroupForViewer({ ...targetMembership, myMember: { membershipStatus: 'requested' } }, false, false))).toBe('requested');
    expect(targetMembership.membershipStatus).toBe('member');
  });
});
