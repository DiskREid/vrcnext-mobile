import { afterEach, describe, expect, it, vi } from 'vitest';
import { analytics, clippedInterval, dayBounds, localDayKey, timelineVisits } from './chart-data';
import type { GameParticipant, GameVisit } from './game-history';

const time = (hour: number, minute = 0) => `2026-10-25T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
const participant = (id: string, start = time(10), lastObserved = time(11)): GameParticipant => ({ userId: id, displayName: id, start, lastObserved });
function visit(id: string, start = time(10), lastObserved = time(11), extra: Partial<GameVisit> = {}): GameVisit {
  return { id, sessionId: 'session_fixture', location: 'wrld_a:1', worldId: 'wrld_a', start, lastObserved, source: 'api', reason: 'observation-gap', participants: [], ...extra };
}
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('local chart day boundaries', () => {
  it('uses calendar midnights for 23-hour and 25-hour DST days', () => {
    vi.stubEnv('TZ', 'Europe/Berlin');
    const spring = dayBounds('2026-03-29')!, autumn = dayBounds('2026-10-25')!;
    expect(spring.end - spring.start).toBe(23 * 3_600_000);
    expect(autumn.end - autumn.start).toBe(25 * 3_600_000);
    expect(new Date(spring.start).toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(new Date(autumn.end).toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('uses local dates rather than UTC day strings and rejects invalid dates', () => {
    vi.stubEnv('TZ', 'Europe/Moscow');
    expect(localDayKey(new Date('2026-10-24T22:30:00.000Z'))).toBe('2026-10-25');
    for (const value of ['2026-02-30', '2026-13-01', '2026-00-01', '25/10/2026', '']) expect(dayBounds(value)).toBeUndefined();
  });

  it('clips a crossing-midnight visit to the selected day', () => {
    vi.stubEnv('TZ', 'UTC');
    const rows = timelineVisits([visit('night', '2026-10-24T23:30:00.000Z', time(1))], '2026-10-25');
    expect(rows).toHaveLength(1);
    expect(rows[0].start).toBe(Date.parse(time(0)));
    expect(rows[0].end).toBe(Date.parse(time(1)));
    expect(rows[0].ms).toBe(3_600_000);
  });

  it('distinguishes a midnight observation from an interval ending at the preceding midnight', () => {
    vi.stubEnv('TZ', 'UTC');
    const rows = timelineVisits([
      visit('previous', '2026-10-24T23:00:00.000Z', time(0)),
      visit('point', time(0), time(0)),
      visit('tomorrow', '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
    ], '2026-10-25');
    expect(rows.map((row) => [row.visit.id, row.ms])).toEqual([['point', 0]]);
  });
});

describe('observed chart intervals', () => {
  it('never extends unfinished or explicitly closed intervals beyond lastObserved', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    expect(clippedInterval({ start: time(10), lastObserved: time(11) })?.ms).toBe(3_600_000);
    expect(clippedInterval({ start: time(10), end: time(12), lastObserved: time(11) })?.ms).toBe(3_600_000);
    expect(clippedInterval({ start: time(10), end: time(10, 30), lastObserved: time(11) })?.ms).toBe(1_800_000);
    expect(clippedInterval({ start: time(11), lastObserved: time(10) })).toBeUndefined();
    expect(clippedInterval({ start: 'invalid', lastObserved: time(10) })).toBeUndefined();
  });

  it('clips companions to the visit and deduplicates repeated observations of one interval', () => {
    vi.stubEnv('TZ', 'UTC');
    const early = participant('usr_one', time(9), time(10, 30));
    const later = { ...early, lastObserved: time(12) };
    const rows = timelineVisits([visit('a', time(10), time(11), { participants: [early, later, participant('usr_other_day', time(13), time(14))] })], '2026-10-25');
    expect(rows[0].participants).toHaveLength(1);
    expect(rows[0].participants[0]).toMatchObject({ start: Date.parse(time(10)), end: Date.parse(time(11)), ms: 3_600_000 });
    expect(rows[0].participants[0].participant.userId).toBe('usr_one');
  });

  it('keeps a co-presence point without inventing a minute of shared duration', () => {
    vi.stubEnv('TZ', 'UTC');
    const rows = timelineVisits([visit('point', time(10), time(10), { participants: [participant('usr_one', time(10), time(10))] })], '2026-10-25');
    expect(rows[0].ms).toBe(0);
    expect(rows[0].participants[0].ms).toBe(0);
    expect(analytics(rows.map((row) => row.visit)).friends[0]).toMatchObject({ encounters: 1, totalMs: 0 });
  });
});

describe('chart analytics from real recorded intervals', () => {
  it('preserves unobserved gaps and unions overlaps instead of summing duplicate time', () => {
    const visits = [
      visit('a', time(10), time(11)),
      visit('b', time(10, 30), time(11, 30), { location: 'wrld_a:2' }),
      visit('c', time(13), time(14), { worldId: 'wrld_b', location: 'wrld_b:3' }),
    ];
    const result = analytics(visits);
    expect(result).toMatchObject({ activeMs: 2.5 * 3_600_000, visitCount: 3, worldCount: 2, instanceCount: 3 });
    expect(result.worlds).toEqual([
      { id: 'wrld_a', visits: 2, totalMs: 1.5 * 3_600_000 },
      { id: 'wrld_b', visits: 1, totalMs: 3_600_000 },
    ]);
  });

  it('selects the latest snapshot per visit and counts each real encounter once', () => {
    const a = visit('same', time(10), time(10, 30), { participants: [participant('usr_one', time(10), time(10, 30))] });
    const b = visit('same', time(10), time(11), { participants: [participant('usr_one'), participant('usr_one')] });
    const c = visit('second', time(12), time(13), { participants: [participant('usr_one', time(12), time(13)), participant('usr_two', time(12), time(13))] });
    const result = analytics([a, b, c]);
    expect(result.visitCount).toBe(2);
    expect(result.activeMs).toBe(2 * 3_600_000);
    expect(result.friends).toEqual([
      { id: 'usr_one', displayName: 'usr_one', encounters: 2, totalMs: 2 * 3_600_000, lastMeeting: time(13) },
      { id: 'usr_two', displayName: 'usr_two', encounters: 1, totalMs: 3_600_000, lastMeeting: time(13) },
    ]);
  });

  it('unions shared time across overlapping visits without creating unknown friends', () => {
    const result = analytics([
      visit('a', time(10), time(11), { participants: [participant('usr_one')] }),
      visit('b', time(10, 30), time(11, 30), { participants: [participant('usr_one', time(10, 30), time(11, 30))] }),
    ]);
    expect(result.friends).toHaveLength(1);
    expect(result.friends[0]).toMatchObject({ encounters: 2, totalMs: 1.5 * 3_600_000 });
  });

  it('filters statistics by selected local day and returns actual empty states', () => {
    vi.stubEnv('TZ', 'UTC');
    const source = [visit('night', '2026-10-24T23:30:00.000Z', time(1)), visit('later', '2026-10-26T10:00:00.000Z', '2026-10-26T11:00:00.000Z')];
    expect(analytics(source, '2026-10-25')).toMatchObject({ activeMs: 3_600_000, visitCount: 1 });
    expect(analytics([], '2026-10-25')).toEqual({ activeMs: 0, visitCount: 0, worldCount: 0, instanceCount: 0, worlds: [], friends: [] });
    expect(analytics(source, 'bad')).toEqual(analytics([]));
  });

  it('limits the last meeting to the selected day and confirmed interval end while retaining the freshest name', () => {
    vi.stubEnv('TZ', 'UTC');
    const source = [visit('spans', '2026-10-24T22:00:00.000Z', '2026-10-26T02:00:00.000Z', {
      participants: [
        { ...participant('usr_closed', time(1), time(2)), displayName: 'Old name' },
        { ...participant('usr_closed', time(9), '2026-10-26T01:00:00.000Z'), displayName: 'Fresh name', end: time(10, 30) },
        participant('usr_crossing', '2026-10-24T23:00:00.000Z', '2026-10-26T01:00:00.000Z'),
      ],
    })];
    const result = analytics(source, '2026-10-25');
    expect(result.friends.find((friend) => friend.id === 'usr_closed')).toMatchObject({
      displayName: 'Fresh name', lastMeeting: time(10, 30),
    });
    expect(result.friends.find((friend) => friend.id === 'usr_crossing')?.lastMeeting).toBe('2026-10-26T00:00:00.000Z');
  });

});
