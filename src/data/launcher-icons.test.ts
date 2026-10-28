import { describe, expect, it, vi } from 'vitest';
import { createAppearanceStore } from './appearance';
import type { HolidayId } from './holiday-calendar';
import { startLauncherIconSync } from './launcher-icons';

const makeStore = (now = () => new Date(2026, 5, 20, 12)) =>
  createAppearanceStore({
    now,
    effects: () => 'full',
    storage: { getItem: () => null, setItem: () => {} },
  });
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const settle = (assertion: () => void) => vi.waitFor(assertion, { interval: 5, timeout: 500 });

describe('launcher icon synchronization', () => {
  it('applies the initial standard icon once and ignores unrelated appearance changes', async () => {
    const store = makeStore();
    const apply = vi.fn(async (_holiday: HolidayId | null) => {});
    const stop = startLauncherIconSync(store, apply);
    await settle(() => expect(apply).toHaveBeenCalledExactlyOnceWith(null));
    store.updateSettings({ theme: 'liquid-light' });
    store.updateSettings({ glassIntensity: 'high' });
    store.updateSettings({ accent: '#82c9b3', holidayAnimations: false });
    store.refreshDate();
    expect(apply).toHaveBeenCalledTimes(1);
    stop();
  });

  it('uses every manual holiday and restores standard when decorations are disabled', async () => {
    const store = makeStore();
    const apply = vi.fn(async (_holiday: HolidayId | null) => {});
    const stop = startLauncherIconSync(store, apply);
    await settle(() => expect(apply).toHaveBeenCalledTimes(1));
    const holidays: HolidayId[] = [
      'valentine',
      'womens-day',
      'st-patrick',
      'easter',
      'earth-day',
      'halloween',
      'christmas',
    ];
    for (const [index, holiday] of holidays.entries()) {
      store.updateSettings({ holidayMode: 'manual', manualHoliday: holiday });
      await settle(() => {
        expect(apply).toHaveBeenCalledTimes(index + 2);
        expect(apply).toHaveBeenLastCalledWith(holiday);
      });
    }
    store.updateSettings({ holidayEnabled: false });
    await settle(() => expect(apply).toHaveBeenLastCalledWith(null));
    store.updateSettings({ holidayEnabled: true });
    await settle(() => expect(apply).toHaveBeenLastCalledWith('christmas'));
    stop();
  });

  it('serializes native work and skips obsolete intermediate choices', async () => {
    const store = makeStore();
    const first = deferred();
    const apply = vi
      .fn<(holiday: HolidayId | null) => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const stop = startLauncherIconSync(store, apply);
    store.updateSettings({ holidayMode: 'manual', manualHoliday: 'valentine' });
    store.updateSettings({ manualHoliday: 'halloween' });
    store.updateSettings({ manualHoliday: 'christmas' });
    expect(apply.mock.calls).toEqual([[null]]);
    first.resolve();
    await settle(() => expect(apply.mock.calls).toEqual([[null], ['christmas']]));
    stop();
  });

  it('restores the selected standard icon after an older holiday finishes late', async () => {
    const store = makeStore();
    const older = deferred();
    const apply = vi
      .fn<(holiday: HolidayId | null) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => older.promise)
      .mockResolvedValue(undefined);
    const stop = startLauncherIconSync(store, apply);
    await settle(() => expect(apply).toHaveBeenCalledTimes(1));
    store.updateSettings({ holidayMode: 'manual', manualHoliday: 'halloween' });
    await settle(() => expect(apply).toHaveBeenCalledTimes(2));
    store.updateSettings({ holidayEnabled: false });
    expect(apply).toHaveBeenCalledTimes(2);
    older.resolve();
    await settle(() => expect(apply.mock.calls).toEqual([[null], ['halloween'], [null]]));
    stop();
  });

  it('reports a native failure once without retrying it on unrelated settings updates', async () => {
    const store = makeStore();
    const failure = new Error('synthetic launcher failure');
    const apply = vi
      .fn<(holiday: HolidayId | null) => Promise<void>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const stop = startLauncherIconSync(store, apply, onError);
    await settle(() => expect(onError).toHaveBeenCalledExactlyOnceWith(failure));
    store.updateSettings({ theme: 'liquid-dark', glassIntensity: 'high' });
    store.updateSettings({ holidayAnimations: false });
    expect(apply).toHaveBeenCalledTimes(1);
    store.updateSettings({ holidayMode: 'manual', manualHoliday: 'easter' });
    await settle(() => expect(apply.mock.calls).toEqual([[null], ['easter']]));
    expect(onError).toHaveBeenCalledTimes(1);
    stop();
  });

  it('continues to the latest queued choice when an obsolete request fails', async () => {
    const store = makeStore();
    const first = deferred();
    const apply = vi
      .fn<(holiday: HolidayId | null) => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const stop = startLauncherIconSync(store, apply, onError);
    store.updateSettings({ holidayMode: 'manual', manualHoliday: 'earth-day' });
    first.reject(new Error('obsolete request failed'));
    await settle(() => expect(apply.mock.calls).toEqual([[null], ['earth-day']]));
    expect(onError).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not apply queued or subsequent changes after disposal', async () => {
    const store = makeStore();
    const first = deferred();
    const apply = vi.fn(() => first.promise);
    const stop = startLauncherIconSync(store, apply);
    store.updateSettings({ holidayMode: 'manual', manualHoliday: 'valentine' });
    stop();
    first.resolve();
    await first.promise;
    store.updateSettings({ manualHoliday: 'easter' });
    await Promise.resolve();
    expect(apply.mock.calls).toEqual([[null]]);
  });

  it('tracks calendar boundaries and keeps a manual icon independent of later dates', async () => {
    let now = new Date(2026, 11, 14, 12);
    const store = makeStore(() => now);
    const apply = vi.fn(async (_holiday: HolidayId | null) => {});
    const stop = startLauncherIconSync(store, apply);
    await settle(() => expect(apply).toHaveBeenLastCalledWith(null));
    now = new Date(2026, 11, 15, 12);
    store.refreshDate();
    await settle(() => expect(apply).toHaveBeenLastCalledWith('christmas'));
    const count = apply.mock.calls.length;
    now = new Date(2027, 0, 10, 12);
    store.refreshDate();
    expect(apply).toHaveBeenCalledTimes(count);
    now = new Date(2027, 0, 11, 12);
    store.refreshDate();
    await settle(() => expect(apply).toHaveBeenLastCalledWith(null));
    store.updateSettings({ holidayMode: 'manual', manualHoliday: 'valentine' });
    await settle(() => expect(apply).toHaveBeenLastCalledWith('valentine'));
    const manualCount = apply.mock.calls.length;
    now = new Date(2027, 10, 1, 12);
    store.refreshDate();
    expect(apply).toHaveBeenCalledTimes(manualCount);
    stop();
  });
});
