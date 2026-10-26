import type { Group } from './types';

type RecordData = Record<string, unknown>;
const record = (value: unknown): RecordData => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : {};
const groupId = (value: unknown): value is string => typeof value === 'string' && /^grp_[a-zA-Z0-9-]+$/.test(value);

/** Membership rows use gmem IDs; navigation and intersections must use the actual grp ID. */
export function normalizeGroups(values: unknown[]): Group[] {
  const groups = new Map<string, Group>();
  for (const value of values) {
    const row = record(value), nested = record(row.group);
    const ids = [row.groupId, nested.groupId, nested.id, row.id].filter(groupId);
    const id = ids[0];
    if (!id || ids.some((candidate) => candidate !== id)) throw new Error('VRChat вернул группу без согласованного идентификатора. Обновите список.');
    const source = { ...row, ...nested };
    const name = typeof source.name === 'string' && source.name.trim() ? source.name : id;
    const group = { ...source, id, groupId: id, name } as Group;
    // Wrappers describe membership, while the nested object describes the group.
    for (const key of ['mutualGroup', 'membershipStatus', 'myMember', 'isMember'] as const)
      if (Object.hasOwn(row, key)) (group as unknown as RecordData)[key] = row[key];
    groups.set(id, { ...groups.get(id), ...group });
  }
  return [...groups.values()];
}

export type GroupMembership = 'member' | 'not-member' | 'requested' | 'invited' | 'blocked' | 'unknown';
const statusMembership = (value: unknown): GroupMembership => {
  if (value === 'member') return 'member';
  if (value === 'requested') return 'requested';
  if (value === 'invited') return 'invited';
  if (value === 'banned' || value === 'userblocked') return 'blocked';
  if (value === 'inactive') return 'not-member';
  return 'unknown';
};

/** Missing membership is unknown; a full response's explicit null/member state is authoritative. */
export function groupMembership(value: Group): GroupMembership {
  const raw = value as unknown as RecordData;
  if (Object.hasOwn(raw, 'myMember') && raw.myMember === null) return 'not-member';
  const member = record(raw.myMember);
  const ownStatus = statusMembership(member.membershipStatus);
  if (ownStatus !== 'unknown') return ownStatus;
  const status = statusMembership(raw.membershipStatus);
  if (status !== 'unknown') return status;
  if (typeof raw.isMember === 'boolean') return raw.isMember ? 'member' : 'not-member';
  if (typeof member.id === 'string' && member.id.startsWith('gmem_')) return 'member';
  if (raw.mutualGroup === true) return 'member';
  return 'unknown';
}

/** Positive evidence is additive; an absent/failed mutual page is not proof of nonmembership. */
export function commonProfileGroups(target: Group[], own: Group[], mutual: Group[]) {
  const ownIds = new Set(own.filter((group) => ['member', 'unknown'].includes(groupMembership(group))).map((group) => group.id));
  const commonIds = new Set(mutual.map((group) => group.id));
  for (const group of target) if (group.mutualGroup === true || ownIds.has(group.id)) commonIds.add(group.id);
  const common = new Map<string, Group>();
  for (const group of [...target, ...mutual]) if (commonIds.has(group.id))
    common.set(group.id, { ...common.get(group.id), ...group, mutualGroup: true });
  return { ids: commonIds, groups: [...common.values()] };
}

/** A foreign user's membership row is about that user; only myMember/common evidence describes the viewer. */
export function profileGroupForViewer(group: Group, common: boolean, ownProfile: boolean): Group {
  const next = { ...group };
  if (!ownProfile) {
    delete next.membershipStatus;
    delete next.isMember;
  }
  if (common) next.mutualGroup = true;
  return next;
}
