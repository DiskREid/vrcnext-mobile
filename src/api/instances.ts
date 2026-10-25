import type { CreateInstanceOptions, Group, Instance } from './types';
import { accessibleLocation } from '../data/locations';

export const avatarPerformanceOptions = [
  { value: '', label: 'Без ограничений' },
  { value: 'Poor', label: 'Poor и лучше — без Very Poor' },
  { value: 'Medium', label: 'Medium и лучше' },
  { value: 'Good', label: 'Good и Excellent' },
] as const;
export function instanceCreationOptions(value: CreateInstanceOptions): CreateInstanceOptions {
  if (!/^wrld_[A-Za-z0-9-]+$/.test(value.worldId) || !['public','friends','hidden','private','group'].includes(value.type)
    || !['eu','us','use','jp'].includes(value.region)) throw new Error('Некорректные параметры инстанса.');
  const result: CreateInstanceOptions = { worldId: value.worldId, type: value.type, region: value.region };
  if (value.type !== 'public') {
    const prefix = value.type === 'group' ? 'grp_' : 'usr_';
    if (!value.ownerId || !new RegExp('^' + prefix + '[A-Za-z0-9-]+$').test(value.ownerId)) throw new Error('Выберите владельца инстанса.');
    result.ownerId = value.ownerId;
  }
  if (value.type === 'private') result.canRequestInvite = value.canRequestInvite === true;
  if (value.type === 'group') {
    if (!value.groupAccessType || !['members','plus','public'].includes(value.groupAccessType)) throw new Error('Выберите доступ группы.');
    result.groupAccessType = value.groupAccessType;
    result.queueEnabled = value.queueEnabled === true;
    if (value.minimumAvatarPerformance !== undefined) {
      if (!['Good','Medium','Poor'].includes(value.minimumAvatarPerformance)) throw new Error('Недопустимое ограничение аватара.');
      result.minimumAvatarPerformance = value.minimumAvatarPerformance;
    }
    if (value.roleIds?.length) {
      if (value.groupAccessType !== 'members' || value.roleIds.some((id) => !/^grol_[A-Za-z0-9-]+$/.test(id))) throw new Error('Проверьте роли доступа инстанса.');
      result.roleIds = [...new Set(value.roleIds)];
    }
    if (value.displayName?.trim()) result.displayName = value.displayName.trim().slice(0, 64);
  }
  return result;
}

/** Prefer the full returned instanceId over an abbreviated id; never synthesize group tags. */
export function createdInstanceLocation(instance: Instance, worldId: string): string {
  const invalid = () => new Error('Инстанс создан, но VRChat не передал его полный адрес. Обновите список инстансов.');
  if ((instance.worldId && instance.worldId !== worldId) || (instance.world?.id && instance.world.id !== worldId)) throw new Error('VRChat вернул инстанс другого мира.');
  const full = (raw: string) => raw.includes(':') ? raw : `${worldId}:${raw}`;
  if (instance.location != null) {
    const location = full(instance.location);
    if (!accessibleLocation(location) || location.split(':')[0] !== worldId) throw invalid();
    return location;
  }
  const candidates = [instance.instanceId, instance.id].filter((raw): raw is string => typeof raw === 'string' && !!raw).map(full);
  if (!candidates.length || candidates.some((location) => !accessibleLocation(location) || location.split(':')[0] !== worldId)) throw invalid();
  candidates.sort((a, b) => b.split('~').length - a.split('~').length);
  const selected = candidates[0], tags = new Set(selected.split('~'));
  if (candidates.some((location) => location.split('~').some((tag) => !tags.has(tag)))) throw invalid();
  return selected;
}

export function groupCreationPermissions(group: Group, userId: string): Set<string> | undefined {
  if (group.ownerId === userId) return new Set(['*']);
  if (Array.isArray(group.myMember?.permissions)) return new Set(group.myMember.permissions.map((p) => p.replaceAll('_', '-')));
  if (!Array.isArray(group.roles) || !group.myMember) return undefined;
  const roles = new Set([...(group.myMember.roleIds || []), ...(group.myMember.mRoleIds || [])]);
  return new Set(group.roles.filter((role) => role.defaultRole || roles.has(role.id)).flatMap((role) => role.permissions || []).map((p) => p.replaceAll('_','-')));
}
export function canCreateGroupInstance(permissions: Set<string> | undefined, access: 'members' | 'plus' | 'public', restricted = false): boolean {
  return permissions === undefined || permissions.has('*') || permissions.has(restricted ? 'group-instance-restricted-create'
    : ({ members: 'group-instance-open-create', plus: 'group-instance-plus-create', public: 'group-instance-public-create' })[access]);
}
