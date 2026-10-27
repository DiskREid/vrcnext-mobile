import type { HistoryEvent } from './history';

/** Only explicit rank tags are evidence. An empty/limited list does not prove Visitor. */
export function observedTrustRank(tags: readonly string[] | undefined): 'New User' | 'User' | 'Known' | 'Trusted' | undefined {
  if (tags?.includes('system_trust_veteran')) return 'Trusted';
  if (tags?.includes('system_trust_trusted')) return 'Known';
  if (tags?.includes('system_trust_known')) return 'User';
  if (tags?.includes('system_trust_basic')) return 'New User';
  return undefined;
}

/**
 * Older observers compared serialized tag lists, including the always-empty
 * LimitedUserFriend.tags. Keep those original records in storage, but do not
 * present missing rank evidence or an equivalent rank as a confirmed change.
 * Exact wording and valid old serialization restrict this to affected rows.
 */
export function isUnverifiedLegacyTrustEvent(event: HistoryEvent): boolean {
  if (event.kind !== 'trust' || event.detail !== 'Изменились доступные Trust Rank теги'
    || typeof event.before !== 'string' || typeof event.after !== 'string') return false;
  const parse = (value: string): string[] | undefined => {
    if (value === '') return [];
    const tags = value.split(',');
    return tags.every(tag => /^system_(?:trust_[A-Za-z0-9_]+|probable_troll[A-Za-z0-9_]*|troll[A-Za-z0-9_]*)$/.test(tag))
      ? tags : undefined;
  };
  const before = parse(event.before), after = parse(event.after);
  if (!before || !after) return false;
  if (!before.length || !after.length) return true;
  const beforeRank = observedTrustRank(before), afterRank = observedTrustRank(after);
  return beforeRank !== undefined && beforeRank === afterRank;
}
