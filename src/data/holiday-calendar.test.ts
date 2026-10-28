import { afterEach, describe, expect, it, vi } from 'vitest';
import { holidayForDate, holidayWindows, orthodoxEaster, westernEaster } from './holiday-calendar';
import type { HolidayId } from './holiday-calendar';

function local(year: number, month: number, day: number, end = false): Date {
  return new Date(year, month - 1, day, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
}
const stamp = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
afterEach(() => vi.unstubAllEnvs());

describe('inclusive device-local holiday calendar', () => {
  it.each([
    ['valentine', 2, 10, 2, 15],
    ['womens-day', 3, 5, 3, 9],
    ['st-patrick', 3, 14, 3, 18],
    ['earth-day', 4, 20, 4, 23],
    ['halloween', 10, 15, 11, 2],
  ] as const)(
    'keeps %s active for both entire boundary dates only',
    (id, startMonth, startDay, endMonth, endDay) => {
      expect(holidayForDate(local(2026, startMonth, startDay - 1, true))).not.toBe(id);
      expect(holidayForDate(local(2026, startMonth, startDay))).toBe(id);
      expect(holidayForDate(local(2026, endMonth, endDay, true))).toBe(id);
      expect(holidayForDate(local(2026, endMonth, endDay + 1))).not.toBe(id);
    },
  );

  it('covers Christmas across December and January without keeping it after January 10', () => {
    for (const date of [
      local(2025, 12, 15),
      local(2025, 12, 31, true),
      local(2026, 1, 1),
      local(2026, 1, 10, true),
      local(2026, 12, 15),
    ]) {
      expect(holidayForDate(date)).toBe('christmas');
    }
    expect(holidayForDate(local(2025, 12, 14, true))).toBeNull();
    expect(holidayForDate(local(2026, 1, 11))).toBeNull();
    const seasons = holidayWindows(2026).filter((window) => window.id === 'christmas');
    expect(seasons.map(({ start, end }) => [stamp(start), stamp(end)])).toEqual([
      ['2025-12-15', '2026-01-10'],
      ['2026-12-15', '2027-01-10'],
    ]);
  });

  it.each([
    [2024, '2024-03-31', '2024-05-05'],
    [2025, '2025-04-20', '2025-04-20'],
    [2026, '2026-04-05', '2026-04-12'],
    [2027, '2027-03-28', '2027-05-02'],
    [1900, '1900-04-15', '1900-04-22'],
    [2100, '2100-03-28', '2100-05-02'],
  ] as const)(
    'computes real Western and Orthodox Easter dates in %s',
    (year, western, orthodox) => {
      expect(stamp(westernEaster(year))).toBe(western);
      expect(stamp(orthodoxEaster(year))).toBe(orthodox);
      expect(westernEaster(year).getDay()).toBe(0);
      expect(orthodoxEaster(year).getDay()).toBe(0);
    },
  );

  it('keeps separate Easter windows when far apart and includes -5 through +2 days', () => {
    const windows = holidayWindows(2024).filter((window) => window.id === 'easter');
    expect(windows.map(({ start, end }) => [stamp(start), stamp(end)])).toEqual([
      ['2024-03-26', '2024-04-02'],
      ['2024-04-30', '2024-05-07'],
    ]);
    for (const [startMonth, startDay, endMonth, endDay] of [
      [3, 26, 4, 2],
      [4, 30, 5, 7],
    ]) {
      expect(holidayForDate(local(2024, startMonth, startDay - 1, true))).not.toBe('easter');
      expect(holidayForDate(local(2024, startMonth, startDay))).toBe('easter');
      expect(holidayForDate(local(2024, endMonth, endDay, true))).toBe('easter');
      expect(holidayForDate(local(2024, endMonth, endDay + 1))).not.toBe('easter');
    }
  });

  it('merges equal and overlapping Western/Orthodox windows without gaps or alternating themes', () => {
    const same = holidayWindows(2025).filter((window) => window.id === 'easter');
    expect(same.map(({ start, end }) => [stamp(start), stamp(end)])).toEqual([
      ['2025-04-15', '2025-04-22'],
    ]);
    const overlapping = holidayWindows(2026).filter((window) => window.id === 'easter');
    expect(overlapping.map(({ start, end }) => [stamp(start), stamp(end)])).toEqual([
      ['2026-03-31', '2026-04-14'],
    ]);
    for (let day = 31; day <= 45; day++) expect(holidayForDate(local(2026, 3, day))).toBe('easter');
    expect(holidayForDate(local(2026, 3, 30, true))).toBeNull();
    expect(holidayForDate(local(2026, 4, 15))).toBeNull();
  });

  it('gives Easter stable priority on Earth Day overlap and lets Earth Day finish afterward', () => {
    expect(holidayForDate(local(2025, 4, 19))).toBe('easter');
    expect(holidayForDate(local(2025, 4, 20))).toBe('easter');
    expect(holidayForDate(local(2025, 4, 22, true))).toBe('easter');
    expect(holidayForDate(local(2025, 4, 23))).toBe('earth-day');
    expect(holidayForDate(local(2025, 4, 24))).toBeNull();
  });

  it('uses device-local day boundaries instead of the instant’s UTC date', () => {
    vi.stubEnv('TZ', 'Pacific/Kiritimati');
    expect(holidayForDate(new Date('2026-02-09T12:30:00Z'))).toBe('valentine');
    expect(holidayForDate(new Date('2026-02-16T02:00:00Z'))).toBeNull();
    vi.stubEnv('TZ', 'America/Los_Angeles');
    expect(holidayForDate(new Date('2026-02-09T12:30:00Z'))).toBeNull();
    expect(holidayForDate(new Date('2026-02-16T02:00:00Z'))).toBe('valentine');
  });

  it('keeps civil dates across DST without adding 24-hour durations', () => {
    vi.stubEnv('TZ', 'Europe/Berlin');
    const easter = holidayWindows(2024).find((window) => window.id === 'easter')!;
    expect(stamp(easter.start)).toBe('2024-03-26');
    expect(stamp(easter.end)).toBe('2024-04-02');
    expect((easter.end.getTime() - easter.start.getTime()) / 3_600_000).toBe(7 * 24 - 1);
    expect(holidayForDate(local(2024, 4, 2, true))).toBe('easter');
    expect(holidayForDate(local(2024, 4, 3))).toBeNull();
  });

  it('never adds other holidays and returns no holiday for invalid or unsupported years', () => {
    const found = new Set<HolidayId>();
    for (let day = 1; day <= 365; day++) {
      const id = holidayForDate(local(2026, 1, day));
      if (id) found.add(id);
    }
    expect([...found].sort()).toEqual(
      [
        'christmas',
        'earth-day',
        'easter',
        'halloween',
        'st-patrick',
        'valentine',
        'womens-day',
      ].sort(),
    );
    for (const [month, day] of [
      [2, 23],
      [5, 9],
      [5, 25],
      [6, 12],
      [7, 4],
      [11, 26],
    ])
      expect(holidayForDate(local(2026, month, day))).toBeNull();
    expect(holidayForDate(new Date(NaN))).toBeNull();
    for (const year of [NaN, Infinity, 0, -1, 2026.5, 10000]) {
      expect(holidayWindows(year)).toEqual([]);
      expect(Number.isNaN(westernEaster(year).getTime())).toBe(true);
      expect(Number.isNaN(orthodoxEaster(year).getTime())).toBe(true);
    }
  });

  it('does not expose shared mutable cached date objects', () => {
    const first = holidayWindows(2026);
    first[0].start.setFullYear(1900);
    expect(stamp(holidayWindows(2026)[0].start)).toBe('2025-12-15');
  });
});
