/** Device-local calendar rules. Dates are compared as civil days, never UTC instants. */
export type HolidayId =
  | 'valentine'
  | 'womens-day'
  | 'st-patrick'
  | 'easter'
  | 'earth-day'
  | 'halloween'
  | 'christmas';

/** Inclusive dates at local noon; a window may cross the calendar-year boundary. */
export interface HolidayWindow {
  readonly id: HolidayId;
  readonly start: Date;
  readonly end: Date;
}

const priority: Record<HolidayId, number> = {
  // Easter can overlap Earth Day. Its complete merged window wins that overlap.
  easter: 100,
  christmas: 70,
  halloween: 60,
  valentine: 50,
  'womens-day': 40,
  'st-patrick': 30,
  'earth-day': 20,
};

function validYear(year: number): boolean {
  return Number.isInteger(year) && year >= 1 && year <= 9999;
}

function localDate(year: number, month: number, day: number): Date {
  // setFullYear also handles years 1–99 correctly (new Date(y, ...) means 1900+y).
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date;
}

function civilDay(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function shiftDays(date: Date, amount: number): Date {
  // Normalize Gregorian day arithmetic in UTC, then reconstruct the local date.
  // Adding 24h milliseconds to a local date would be wrong across DST changes.
  const normalized = new Date(0);
  normalized.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate() + amount);
  normalized.setUTCHours(12, 0, 0, 0);
  return localDate(
    normalized.getUTCFullYear(),
    normalized.getUTCMonth() + 1,
    normalized.getUTCDate(),
  );
}

/** Gregorian (Western) Easter, using the Meeus/Jones/Butcher computus. */
export function westernEaster(year: number): Date {
  if (!validYear(year)) return new Date(NaN);
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const value = h + l - 7 * m + 114;
  return localDate(year, Math.floor(value / 31), (value % 31) + 1);
}

/** Julian computus converted to the device's Gregorian civil calendar. */
export function orthodoxEaster(year: number): Date {
  if (!validYear(year)) return new Date(NaN);
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const value = d + e + 114;
  const julianMonth = Math.floor(value / 31);
  const julianDay = (value % 31) + 1;
  // Julian Easter is in March/April. The Gregorian difference there changes in
  // non-400-divisible century years: 13 days in 1900–2099, 14 in 2100–2199.
  const difference = Math.floor(year / 100) - Math.floor(year / 400) - 2;
  return shiftDays(localDate(year, julianMonth, julianDay), difference);
}

function easterWindows(year: number): HolidayWindow[] {
  const windows = [westernEaster(year), orthodoxEaster(year)]
    .map(
      (date): HolidayWindow => ({
        id: 'easter',
        start: shiftDays(date, -5),
        end: shiftDays(date, 2),
      }),
    )
    .sort((a, b) => civilDay(a.start) - civilDay(b.start));
  const result: HolidayWindow[] = [];
  for (const window of windows) {
    const previous = result.at(-1);
    if (previous && civilDay(window.start) <= civilDay(previous.end)) {
      result[result.length - 1] = {
        id: 'easter',
        start: previous.start,
        end: civilDay(window.end) > civilDay(previous.end) ? window.end : previous.end,
      };
    } else result.push(window);
  }
  return result;
}

/** All complete windows touching this year, including both neighboring Christmas seasons. */
export function holidayWindows(year: number): HolidayWindow[] {
  if (!validYear(year)) return [];
  return [
    { id: 'christmas' as const, start: localDate(year - 1, 12, 15), end: localDate(year, 1, 10) },
    { id: 'valentine' as const, start: localDate(year, 2, 10), end: localDate(year, 2, 15) },
    { id: 'womens-day' as const, start: localDate(year, 3, 5), end: localDate(year, 3, 9) },
    { id: 'st-patrick' as const, start: localDate(year, 3, 14), end: localDate(year, 3, 18) },
    ...easterWindows(year),
    { id: 'earth-day' as const, start: localDate(year, 4, 20), end: localDate(year, 4, 23) },
    { id: 'halloween' as const, start: localDate(year, 10, 15), end: localDate(year, 11, 2) },
    { id: 'christmas' as const, start: localDate(year, 12, 15), end: localDate(year + 1, 1, 10) },
  ].sort((a, b) => civilDay(a.start) - civilDay(b.start));
}

/** Select exactly one stable holiday for the device-local date; invalid dates have no theme. */
export function holidayForDate(date: Date): HolidayId | null {
  if (!Number.isFinite(date.getTime())) return null;
  const day = civilDay(date);
  const active = holidayWindows(date.getFullYear()).filter(
    (window) => day >= civilDay(window.start) && day <= civilDay(window.end),
  );
  active.sort((a, b) => priority[b.id] - priority[a.id]);
  return active[0]?.id || null;
}
