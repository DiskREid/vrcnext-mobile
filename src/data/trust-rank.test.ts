import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from './history';
import { MemoryHistoryStore } from './history-storage';
import { isUnverifiedLegacyTrustEvent, observedTrustRank } from './trust-rank';

const legacy = (before = '', after = 'system_trust_known', change: Partial<HistoryEvent> = {}): HistoryEvent => ({
  id: 'event_legacy', time: '2026-10-27T09:00:00.000Z', kind: 'trust', userId: 'usr_friend',
  displayName: 'Friend', detail: 'Изменились доступные Trust Rank теги', source: 'sync', before, after, ...change,
});

describe('explicit trust rank evidence', () => {
  it('requires an exact positive rank tag and uses the highest known rank', () => {
    expect(observedTrustRank(undefined)).toBeUndefined();
    expect(observedTrustRank([])).toBeUndefined();
    expect(observedTrustRank(['system_probable_troll', 'system_trust_legend', 'system_trust_veteran_hidden'])).toBeUndefined();
    expect(observedTrustRank(['system_trust_basic'])).toBe('New User');
    expect(observedTrustRank(['system_trust_known'])).toBe('User');
    expect(observedTrustRank(['system_trust_trusted'])).toBe('Known');
    expect(observedTrustRank(['system_trust_basic', 'system_trust_known', 'system_trust_veteran'])).toBe('Trusted');
  });
});

describe('legacy trust event read filtering', () => {
  it('hides empty evidence comparisons and equivalent cumulative versus single-rank lists', () => {
    for (const source of ['sync', 'profile', 'refresh', 'pipeline'] as const) {
      expect(isUnverifiedLegacyTrustEvent(legacy('', 'system_trust_known', { source }))).toBe(true);
      expect(isUnverifiedLegacyTrustEvent(legacy('system_trust_known', '', { source }))).toBe(true);
      expect(isUnverifiedLegacyTrustEvent(legacy('system_trust_basic,system_trust_known', 'system_trust_known', { source }))).toBe(true);
    }
  });

  it('keeps observed rank transitions, unknown evidence and unrelated or newer events', () => {
    for (const event of [
      legacy('system_trust_basic', 'system_trust_known'),
      legacy('system_trust_veteran', 'system_trust_trusted'),
      legacy('system_trust_legend', 'system_trust_known'),
      legacy('system_troll', 'system_probable_troll'),
      legacy('New User', 'User'),
      legacy('', 'system_trust_known', { before: undefined }),
      legacy('', 'system_trust_known', { after: undefined }),
      legacy('', 'system_trust_known', { kind: 'bio' }),
      legacy('', 'system_trust_known', { detail: 'New User → User' }),
    ]) expect(isUnverifiedLegacyTrustEvent(event)).toBe(false);
  });

  it('read filters are idempotent and account-scoped while append inputs stay unchanged', async () => {
    const store = new MemoryHistoryStore();
    const bad = legacy();
    const rank = legacy('system_trust_basic', 'system_trust_known', { id: 'event_rank' });
    const bio = legacy('Old Bio', 'New Bio', { id: 'event_bio', kind: 'bio', detail: 'Биография обновлена' });
    await store.append('usr_me', [bad, rank, bio]);
    await store.append('usr_other', [rank]);
    expect(await store.read('usr_me')).toEqual([rank, bio]);
    expect(await store.read('usr_me')).toEqual([rank, bio]);
    expect(await store.read('usr_other')).toEqual([rank]);
    expect(bad).toEqual(legacy());
  });
});
