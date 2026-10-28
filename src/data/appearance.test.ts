import { describe, expect, it, vi } from 'vitest';
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_SETTINGS,
  appearanceAccent,
  createAppearanceStore,
} from './appearance';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}
const date = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12);

// Independent WCAG calculation checks the actual text/fill colors, not the implementation's helper.
function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((part) => parseInt(part, 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(a: string, b: string): number {
  const [bright, dark] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

describe('persistent appearance preferences', () => {
  it('starts with the existing dark theme and automatic holiday layer, migrating a legacy accent', () => {
    const storage = memoryStorage({ accent: '#82c9b3', 'session-marker': 'kept' });
    const store = createAppearanceStore({
      storage,
      now: () => date(2026, 10, 28),
      effects: () => 'full',
    });
    expect(store.getSnapshot()).toMatchObject({
      settings: { ...DEFAULT_APPEARANCE_SETTINGS, accent: '#82c9b3' },
      activeHoliday: 'halloween',
      effects: 'full',
    });
    expect(storage.values.get('session-marker')).toBe('kept');
  });

  it('restores all independent controls on a fresh instance without changing account or history storage', () => {
    const storage = memoryStorage({
      'session-marker': 'auth-kept',
      'history-account': 'history-kept',
    });
    const original = createAppearanceStore({
      storage,
      now: () => date(2026, 7, 3),
      effects: () => 'full',
    });
    original.updateSettings({
      theme: 'liquid-light',
      glassIntensity: 'high',
      holidayEnabled: true,
      holidayMode: 'manual',
      manualHoliday: 'christmas',
      holidayAnimations: false,
      accent: '#83bbef',
    });
    const restored = createAppearanceStore({
      storage,
      now: () => date(2026, 7, 3),
      effects: () => 'full',
    });
    expect(restored.getSnapshot().settings).toEqual(original.getSnapshot().settings);
    expect(restored.getSnapshot().activeHoliday).toBe('christmas');
    expect(storage.values.get('session-marker')).toBe('auth-kept');
    expect(storage.values.get('history-account')).toBe('history-kept');
    expect(
      storage.setItem.mock.calls.every(
        ([key]) => key === APPEARANCE_STORAGE_KEY || key === 'accent',
      ),
    ).toBe(true);
  });

  it('ignores corrupt stored fields individually and rejects strings that could become CSS', () => {
    const storage = memoryStorage({
      accent: '#82c9b3',
      [APPEARANCE_STORAGE_KEY]: JSON.stringify({
        theme: 'liquid-dark',
        glassIntensity: 'infinite',
        holidayEnabled: 'false',
        holidayMode: 'manual',
        manualHoliday: 'independence-day',
        holidayAnimations: 0,
        accent: 'red; background:url(https://invalid.example)',
        extra: 'not-a-setting',
      }),
    });
    const store = createAppearanceStore({
      storage,
      now: () => date(2026, 7, 3),
      effects: () => 'full',
    });
    const settings = store.getSnapshot().settings;
    expect(settings).toMatchObject({
      theme: 'liquid-dark',
      glassIntensity: DEFAULT_APPEARANCE_SETTINGS.glassIntensity,
      holidayEnabled: DEFAULT_APPEARANCE_SETTINGS.holidayEnabled,
      holidayMode: 'manual',
      manualHoliday: DEFAULT_APPEARANCE_SETTINGS.manualHoliday,
      holidayAnimations: DEFAULT_APPEARANCE_SETTINGS.holidayAnimations,
      accent: '#82c9b3',
    });
    expect(settings).not.toHaveProperty('extra');
    for (const invalid of ['{bad json', '[]', 'null', '42']) {
      const fresh = createAppearanceStore({
        storage: memoryStorage({ [APPEARANCE_STORAGE_KEY]: invalid }),
        now: () => date(2026, 7, 3),
        effects: () => 'full',
      });
      expect(fresh.getSnapshot().settings).toMatchObject(DEFAULT_APPEARANCE_SETTINGS);
    }
  });

  it('ignores invalid update values and never persists unexpected fields', () => {
    const storage = memoryStorage();
    const store = createAppearanceStore({
      storage,
      now: () => date(2026, 7, 3),
      effects: () => 'full',
    });
    store.updateSettings({ theme: 'liquid-light', holidayEnabled: false, accent: '#83bbef' });
    const before = store.getSnapshot().settings;
    store.updateSettings({
      theme: 'not-a-theme',
      holidayEnabled: 'true',
      accent: 'url(https://invalid.example)',
      unsafe: 'extra',
    } as never);
    expect(store.getSnapshot().settings).toEqual(before);
    const saved = storage.values.get(APPEARANCE_STORAGE_KEY)!;
    expect(saved).not.toContain('invalid.example');
    expect(saved).not.toContain('unsafe');
    expect(saved).not.toContain('not-a-theme');
  });

  it('still applies changes in the current session when storage access fails', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(() => {
      const store = createAppearanceStore({
        storage: blocked,
        now: () => date(2026, 7, 3),
        effects: () => 'full',
      });
      store.updateSettings({ theme: 'liquid-dark', holidayEnabled: false });
      expect(store.getSnapshot()).toMatchObject({
        settings: { theme: 'liquid-dark', holidayEnabled: false },
        activeHoliday: null,
      });
    }).not.toThrow();
  });

  it('does not notify or write for a no-op and unsubscribes cleanly', () => {
    const storage = memoryStorage();
    const store = createAppearanceStore({
      storage,
      now: () => date(2026, 7, 3),
      effects: () => 'full',
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const before = store.getSnapshot();
    store.updateSettings({ theme: before.settings.theme });
    store.refreshDate();
    expect(store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    store.updateSettings({ theme: 'liquid-dark' });
    expect(listener).toHaveBeenCalledTimes(1);
    const writes = storage.setItem.mock.calls.length;
    unsubscribe();
    store.updateSettings({ theme: 'liquid-light' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storage.setItem.mock.calls.length).toBeGreaterThan(writes);
  });
});

describe('holiday layer independent of the permanent theme', () => {
  it('removes and restores decorations immediately while keeping the manual choice and base theme', () => {
    const store = createAppearanceStore({
      storage: memoryStorage(),
      now: () => date(2026, 7, 3),
      effects: () => 'full',
    });
    store.updateSettings({
      theme: 'liquid-light',
      holidayMode: 'manual',
      manualHoliday: 'halloween',
      holidayAnimations: false,
    });
    expect(store.getSnapshot().activeHoliday).toBe('halloween');
    store.updateSettings({ holidayEnabled: false });
    expect(store.getSnapshot()).toMatchObject({
      settings: { theme: 'liquid-light', manualHoliday: 'halloween', holidayAnimations: false },
      activeHoliday: null,
    });
    store.updateSettings({ holidayEnabled: true });
    expect(store.getSnapshot()).toMatchObject({
      settings: { theme: 'liquid-light', manualHoliday: 'halloween', holidayAnimations: false },
      activeHoliday: 'halloween',
    });
  });

  it('returns to the selected glass theme after a holiday ends without resetting preferences', () => {
    let today = date(2026, 11, 2);
    const storage = memoryStorage();
    const store = createAppearanceStore({ storage, now: () => today, effects: () => 'full' });
    store.updateSettings({ theme: 'liquid-dark', glassIntensity: 'high', accent: '#e4a3c0' });
    expect(store.getSnapshot().activeHoliday).toBe('halloween');
    const preferences = store.getSnapshot().settings;
    storage.setItem.mockClear();
    today = date(2026, 11, 3);
    store.refreshDate();
    expect(store.getSnapshot()).toMatchObject({ settings: preferences, activeHoliday: null });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps Christmas across New Year and selects a stable Easter priority on overlap', () => {
    let today = date(2026, 12, 31);
    const store = createAppearanceStore({
      storage: memoryStorage(),
      now: () => today,
      effects: () => 'full',
    });
    expect(store.getSnapshot().activeHoliday).toBe('christmas');
    today = date(2027, 1, 1);
    store.refreshDate();
    expect(store.getSnapshot().activeHoliday).toBe('christmas');
    today = date(2027, 1, 11);
    store.refreshDate();
    expect(store.getSnapshot().activeHoliday).toBeNull();
    today = date(2025, 4, 20);
    store.refreshDate();
    expect(store.getSnapshot().activeHoliday).toBe('easter');
    today = date(2025, 4, 23);
    store.refreshDate();
    expect(store.getSnapshot().activeHoliday).toBe('earth-day');
  });

  it('does not let date or capability changes override a disabled or manually selected holiday', () => {
    let today = date(2026, 7, 3);
    let effects: 'full' | 'reduced' = 'full';
    const storage = memoryStorage();
    const store = createAppearanceStore({ storage, now: () => today, effects: () => effects });
    store.updateSettings({ holidayMode: 'manual', manualHoliday: 'valentine' });
    storage.setItem.mockClear();
    today = date(2026, 12, 25);
    effects = 'reduced';
    store.refreshDate();
    expect(store.getSnapshot()).toMatchObject({ activeHoliday: 'valentine', effects: 'reduced' });
    expect(storage.setItem).not.toHaveBeenCalled();
    store.updateSettings({ holidayEnabled: false });
    today = date(2027, 2, 14);
    store.refreshDate();
    expect(store.getSnapshot().activeHoliday).toBeNull();
  });

  it('temporarily derives the holiday accent without overwriting the saved accent', () => {
    const store = createAppearanceStore({
      storage: memoryStorage(),
      now: () => date(2026, 10, 28),
      effects: () => 'full',
    });
    store.updateSettings({ accent: '#83bbef' });
    const festive = appearanceAccent(store.getSnapshot());
    expect(festive.accent).not.toBe('#83bbef');
    expect(store.getSnapshot().settings.accent).toBe('#83bbef');
    store.updateSettings({ holidayEnabled: false });
    expect(appearanceAccent(store.getSnapshot()).accent.toLowerCase()).toBe('#83bbef');
  });
});

describe('readable accent colors in the light theme', () => {
  it('keeps light-surface text and filled-button text readable for pale and dark user colors', () => {
    const store = createAppearanceStore({
      storage: memoryStorage(),
      now: () => date(2026, 7, 3),
      effects: () => 'full',
    });
    for (const accent of [
      '#ffffff',
      '#eeeeee',
      '#a398ff',
      '#82c9b3',
      '#e6ae85',
      '#e4a3c0',
      '#83bbef',
      '#000000',
    ]) {
      store.updateSettings({ theme: 'liquid-light', holidayEnabled: false, accent });
      const actual = appearanceAccent(store.getSnapshot());
      expect(actual.accent).toMatch(/^#[\da-f]{6}$/i);
      expect(actual.ink).toMatch(/^#[\da-f]{6}$/i);
      expect(contrast(actual.accent, '#f4f6fb'), accent).toBeGreaterThanOrEqual(4.5);
      expect(contrast(actual.accent, actual.ink), accent).toBeGreaterThanOrEqual(4.5);
      expect(store.getSnapshot().settings.accent).toBe(accent);
    }
  });
});
