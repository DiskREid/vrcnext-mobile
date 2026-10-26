import type { Notification } from '../api/types';
import { parseCalendarLink } from '../api/calendar';

export type NotificationCategory = 'all' | 'invites' | 'friends' | 'groups' | 'calendar';
export type NotificationDestination = { type: 'event'; groupId: string; eventId: string } | { type: 'group'; id: string } | { type: 'user'; id: string };
const id = (value: unknown, prefix: string): value is string => typeof value === 'string' && new RegExp('^' + prefix + '_[a-zA-Z0-9-]+$').test(value);
export function notificationDestination(n: Notification): NotificationDestination | undefined {
  const d = n.details || {};
  const event = parseCalendarLink(n._link || n.link);
  if (event) return { type: 'event', ...event };
  const groupId = [d.groupId, n.senderUserId, /^group:(grp_[a-zA-Z0-9-]+)$/.exec(n._link || n.link || '')?.[1], /\/groups\/(grp_[a-zA-Z0-9-]+)(?:[/?#]|$)/.exec(n._link || n.link || '')?.[1]].find(value => id(value, 'grp'));
  const eventId = [d.eventId, d.calendarId].find(value => id(value, 'cal'));
  if (groupId && eventId) return { type: 'event', groupId, eventId };
  if (groupId) return { type: 'group', id: groupId };
  if (id(n.senderUserId, 'usr')) return { type: 'user', id: n.senderUserId };
}
export function notificationCategory(n: Notification): Exclude<NotificationCategory, 'all'> | 'other' {
  if (notificationDestination(n)?.type === 'event' || /^(?:event\.|group\.event\.|calendar\.)/.test(n.type)) return 'calendar';
  if (n.type === 'friendRequest') return 'friends';
  if (['invite', 'requestInvite', 'inviteResponse', 'requestInviteResponse', 'group.invite', 'group.joinRequest'].includes(n.type)) return 'invites';
  if (n.type.startsWith('group.') || n.type === 'groupAnnouncement') return 'groups';
  return 'other';
}
export function sortNotifications(items: Notification[]): Notification[] {
  const date = (n: Notification) => { const value = Date.parse(n.created_at || n.createdAt || ''); return Number.isFinite(value) ? value : 0; };
  return [...items].sort((a, b) => date(b) - date(a) || a.id.localeCompare(b.id));
}
