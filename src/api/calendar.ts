import type { CalendarEvent, Group } from './types';

export type CalendarRequest = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
export interface CalendarPageData {
  events: CalendarEvent[];
  hasNext: boolean;
  nextOffset: number;
  totalCount?: number;
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value : undefined;

/** Calendar interest and ownership are nested/renamed in current API responses. */
export function normalizeCalendarEvent(value: unknown, followingFallback?: boolean): CalendarEvent {
  const raw = object(value);
  if (typeof raw.id !== 'string' || !raw.id) throw new Error('VRChat вернул событие без идентификатора.');
  const interest = object(raw.userInterest), group = object(raw.group);
  const groupId = [raw.groupId, group.groupId, group.id, raw.ownerId].find((v): v is string => typeof v === 'string' && v.startsWith('grp_'));
  const following = typeof interest.isFollowing === 'boolean' ? interest.isFollowing : typeof raw.isFollowing === 'boolean' ? raw.isFollowing : followingFallback;
  return {
    id: raw.id,
    groupId,
    ownerId: text(raw.ownerId),
    title: text(raw.title) || text(raw.name),
    name: text(raw.name),
    description: text(raw.description),
    startsAt: text(raw.startsAt) || text(raw.startDate),
    endsAt: text(raw.endsAt) || text(raw.endDate),
    imageUrl: text(raw.imageUrl),
    worldId: text(raw.worldId),
    category: text(raw.category),
    featured: raw.featured === true,
    ...(following !== undefined ? { isFollowing: following, userInterest: { isFollowing: following } } : {}),
    ...(groupId && typeof group.name === 'string' ? { group: { id: groupId, name: group.name, iconUrl: text(group.iconUrl) } } : {}),
  };
}

export function normalizeCalendarPage(value: unknown, offset = 0, following = false): CalendarPageData {
  const raw = object(value);
  const entries = Array.isArray(value) ? value : ['results', 'events', 'data', 'items'].map((key) => raw[key]).find(Array.isArray);
  if (!Array.isArray(entries)) throw new Error('VRChat вернул некорректный список событий.');
  const events = entries.map((entry) => normalizeCalendarEvent(entry, following ? true : undefined));
  const totalCount = typeof raw.totalCount === 'number' && Number.isFinite(raw.totalCount) && raw.totalCount >= 0 ? raw.totalCount : undefined;
  const nextOffset = offset + entries.length;
  const hasNext = typeof raw.hasNext === 'boolean' ? raw.hasNext : totalCount !== undefined ? nextOffset < totalCount : entries.length >= 100;
  if (hasNext && !entries.length) throw new Error('VRChat сообщил о следующей странице без результатов. Повторите загрузку.');
  return { events, hasNext, nextOffset, ...(totalCount !== undefined ? { totalCount } : {}) };
}

export function parseCalendarLink(value: string | undefined): { groupId: string; eventId: string } | undefined {
  const match = /^event:(grp_[a-zA-Z0-9-]+),(cal_[a-zA-Z0-9-]+)$/.exec(value || '');
  return match ? { groupId: match[1], eventId: match[2] } : undefined;
}

export function createCalendarClient(request: CalendarRequest) {
  const groupCache = new Map<string, { expires: number; data: Group[] }>();
  const groupPending = new Map<string, Promise<Group[]>>();
  async function groups(account: string, force = false): Promise<Group[]> {
    const cached = groupCache.get(account);
    if (!force && cached && cached.expires > Date.now()) return cached.data;
    const pending = groupPending.get(account);
    if (pending) return pending;
    const operation = request<unknown>('/users/' + encodeURIComponent(account) + '/groups').then((value) => {
      if (!Array.isArray(value)) throw new Error('VRChat не передал названия групп календаря.');
      const data = value.map((entry) => {
        const raw = object(entry), id = text(raw.groupId) || text(raw.id);
        if (!id?.startsWith('grp_') || typeof raw.name !== 'string') throw new Error('VRChat вернул некорректную группу календаря.');
        return { id, name: raw.name, iconUrl: text(raw.iconUrl) };
      });
      groupCache.set(account, { expires: Date.now() + 5 * 60_000, data });
      if (groupCache.size > 3) groupCache.delete(groupCache.keys().next().value!);
      return data;
    }).finally(() => { groupPending.delete(account); });
    groupPending.set(account, operation);
    return operation;
  }
  const month = async (date: Date, filter: 'all' | 'following' = 'all', offset = 0) => {
    const query = new URLSearchParams({ date: new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1)).toISOString(), n: '100', offset: String(offset) });
    return normalizeCalendarPage(await request<unknown>('/calendar' + (filter === 'following' ? '/following' : '') + '?' + query), offset, filter === 'following');
  };
  const detail = async (groupId: string, id: string) => normalizeCalendarEvent(await request<unknown>('/calendar/' + encodeURIComponent(groupId) + '/' + encodeURIComponent(id)));
  async function allMonth(date: Date, filter: 'all' | 'following', maxPages = 4, isCurrent: () => boolean = () => true) {
    const records = new Map<string, CalendarEvent>();
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      // Native REST cannot cancel an already dispatched request. Stop before the
      // next page when its foreground/account observation has become obsolete.
      if (!isCurrent()) return { events: [...records.values()], complete: false };
      const current = await month(date, filter, offset);
      let added = 0;
      for (const event of current.events) { if (!records.has(event.id)) added++; records.set(event.id, event); }
      if (!current.hasNext) return { events: [...records.values()], complete: true };
      if (!added || current.nextOffset <= offset) throw new Error('VRChat повторил страницу календаря. Синхронизация прервана.');
      offset = current.nextOffset;
    }
    return { events: [...records.values()], complete: false };
  }
  return { groups, month, allMonth, detail };
}

export function withCalendarGroups(events: CalendarEvent[], groups: Group[]): CalendarEvent[] {
  const names = new Map(groups.map((group) => [group.id, group]));
  return events.map((event) => event.groupId && names.has(event.groupId) ? { ...event, group: names.get(event.groupId) } : event);
}
