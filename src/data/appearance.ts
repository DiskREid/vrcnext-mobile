import { useEffect, useSyncExternalStore } from 'react';
import { App as AndroidApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { holidayForDate } from './holiday-calendar';
import type { HolidayId } from './holiday-calendar';

export type InterfaceTheme = 'standard-dark' | 'liquid-dark' | 'liquid-light';
export type GlassIntensity = 'low' | 'medium' | 'high';
export type EffectsLevel = 'full' | 'reduced';
export interface AppearanceSettings {
  theme: InterfaceTheme;
  glassIntensity: GlassIntensity;
  holidayEnabled: boolean;
  holidayMode: 'automatic' | 'manual';
  manualHoliday: HolidayId;
  holidayAnimations: boolean;
  accent: string;
}
export interface AppearanceSnapshot {
  settings: AppearanceSettings;
  activeHoliday: HolidayId | null;
  effects: EffectsLevel;
}
export const APPEARANCE_STORAGE_KEY = 'vrcnext.appearance.v1';
export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = Object.freeze({
  theme: 'standard-dark',
  glassIntensity: 'medium',
  holidayEnabled: true,
  holidayMode: 'automatic',
  manualHoliday: 'halloween',
  holidayAnimations: true,
  accent: '#a398ff',
});
const themes = ['standard-dark', 'liquid-dark', 'liquid-light'];
const intensities = ['low', 'medium', 'high'];
const holidays = [
  'valentine',
  'womens-day',
  'st-patrick',
  'easter',
  'earth-day',
  'halloween',
  'christmas',
];
const validColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;
function browserStorage(): StorageAccess | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
function cleanSettings(value: unknown, defaults: AppearanceSettings): AppearanceSettings {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    theme:
      typeof raw.theme === 'string' && themes.includes(raw.theme)
        ? (raw.theme as InterfaceTheme)
        : defaults.theme,
    glassIntensity:
      typeof raw.glassIntensity === 'string' && intensities.includes(raw.glassIntensity)
        ? (raw.glassIntensity as GlassIntensity)
        : defaults.glassIntensity,
    holidayEnabled:
      typeof raw.holidayEnabled === 'boolean' ? raw.holidayEnabled : defaults.holidayEnabled,
    holidayMode:
      raw.holidayMode === 'automatic' || raw.holidayMode === 'manual'
        ? raw.holidayMode
        : defaults.holidayMode,
    manualHoliday:
      typeof raw.manualHoliday === 'string' && holidays.includes(raw.manualHoliday)
        ? (raw.manualHoliday as HolidayId)
        : defaults.manualHoliday,
    holidayAnimations:
      typeof raw.holidayAnimations === 'boolean'
        ? raw.holidayAnimations
        : defaults.holidayAnimations,
    accent: validColor(raw.accent) ? raw.accent.toLowerCase() : defaults.accent,
  };
}
export function detectAppearanceEffects(): EffectsLevel {
  if (typeof navigator === 'undefined') return 'full';
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency;
  const blur =
    typeof CSS !== 'undefined' &&
    (CSS.supports('backdrop-filter', 'blur(1px)') ||
      CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));
  const transparency =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-transparency: reduce)').matches;
  return (memory && memory <= 4) || (cores && cores <= 4) || !blur || transparency
    ? 'reduced'
    : 'full';
}
export function createAppearanceStore(
  options: {
    storage?: StorageAccess;
    now?: () => Date;
    effects?: () => EffectsLevel;
    apply?: (snapshot: AppearanceSnapshot) => void;
  } = {},
) {
  const storage = options.storage || browserStorage(),
    now = options.now || (() => new Date()),
    effects = options.effects || detectAppearanceEffects;
  let defaults = { ...DEFAULT_APPEARANCE_SETTINGS };
  try {
    const legacy = storage?.getItem('accent');
    if (validColor(legacy)) defaults.accent = legacy.toLowerCase();
  } catch {
    /* Defaults work without storage. */
  }
  let settings = defaults;
  try {
    const saved = storage?.getItem(APPEARANCE_STORAGE_KEY);
    if (saved) settings = cleanSettings(JSON.parse(saved), defaults);
  } catch {
    /* Corrupt preferences do not affect account data. */
  }
  const holiday = (value: AppearanceSettings) =>
    !value.holidayEnabled
      ? null
      : value.holidayMode === 'manual'
        ? value.manualHoliday
        : holidayForDate(now());
  let snapshot: AppearanceSnapshot = {
    settings: Object.freeze(settings),
    activeHoliday: holiday(settings),
    effects: effects(),
  };
  const listeners = new Set<() => void>();
  const publish = (next: AppearanceSnapshot) => {
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
    snapshot = next;
    options.apply?.(snapshot);
    for (const listener of listeners) listener();
  };
  options.apply?.(snapshot);
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateSettings(patch: Partial<AppearanceSettings>) {
      const next = cleanSettings(patch, snapshot.settings);
      if (JSON.stringify(next) !== JSON.stringify(snapshot.settings)) {
        try {
          storage?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* Apply for the current session. */
        }
        if (next.accent !== snapshot.settings.accent)
          try {
            storage?.setItem('accent', next.accent);
          } catch {
            /* Legacy preference is optional. */
          }
      }
      publish({ settings: Object.freeze(next), activeHoliday: holiday(next), effects: effects() });
    },
    refreshDate() {
      publish({ ...snapshot, activeHoliday: holiday(snapshot.settings), effects: effects() });
    },
  };
}

const palette: Record<HolidayId, { dark: string; light: string }> = {
  valentine: { dark: '#f49db9', light: '#aa2357' },
  'womens-day': { dark: '#ecacd2', light: '#982b70' },
  'st-patrick': { dark: '#78dbaf', light: '#126e46' },
  easter: { dark: '#ceb4fc', light: '#7442a8' },
  'earth-day': { dark: '#71d4dc', light: '#13727c' },
  halloween: { dark: '#ffb575', light: '#9c450b' },
  christmas: { dark: '#a1d1ff', light: '#276caa' },
};
function rgbOf(color: string): number[] {
  return [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
}
function luminance(color: string): number {
  const [r, g, b] = rgbOf(color).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function readableAccent(color: string, light: boolean): string {
  const surface = light ? '#f4f6fb' : '#252a3c';
  let channels = rgbOf(color);
  const hex = () => `#${channels.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  for (let i = 0; i < 32 && contrast(hex(), surface) < 4.5; i++)
    channels = channels.map((c) => (light ? c * 0.9 : c + (255 - c) * 0.12));
  return hex();
}
export function appearanceAccent(snapshot: AppearanceSnapshot): {
  accent: string;
  ink: string;
  rgb: string;
} {
  const light = snapshot.settings.theme === 'liquid-light';
  const preferred = snapshot.activeHoliday
    ? palette[snapshot.activeHoliday][light ? 'light' : 'dark']
    : snapshot.settings.accent;
  const accent = readableAccent(preferred, light);
  return {
    accent,
    ink: contrast(accent, '#ffffff') > contrast(accent, '#101320') ? '#ffffff' : '#101320',
    rgb: rgbOf(accent).join(', '),
  };
}
function applyAppearance(snapshot: AppearanceSnapshot) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement,
    colors = appearanceAccent(snapshot);
  root.dataset.theme = snapshot.settings.theme;
  root.dataset.glassIntensity = snapshot.settings.glassIntensity;
  root.dataset.holiday = snapshot.activeHoliday || 'none';
  root.dataset.holidayAnimations = String(snapshot.settings.holidayAnimations);
  root.dataset.effects = snapshot.effects;
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--accent-ink', colors.ink);
  root.style.setProperty('--accent-rgb', colors.rgb);
  root.style.setProperty('--user-accent', snapshot.settings.accent);
  root.style.colorScheme = snapshot.settings.theme === 'liquid-light' ? 'light' : 'dark';
}
export const appearanceStore = createAppearanceStore({ apply: applyAppearance });
export function useAppearance() {
  const snapshot = useSyncExternalStore(
    appearanceStore.subscribe,
    appearanceStore.getSnapshot,
    appearanceStore.getSnapshot,
  );
  return { ...snapshot, updateSettings: appearanceStore.updateSettings };
}
/** At most one local-midnight timer, only while automatic holidays are enabled and foregrounded. */
export function startAppearanceRuntime(store = appearanceStore) {
  if (typeof window === 'undefined') return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined,
    stopped = false,
    nativeActive = true;
  let nativeHandle: { remove: () => Promise<void> } | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = undefined;
    const visible = document.visibilityState !== 'hidden' && nativeActive;
    document.documentElement.dataset.appActive = String(visible);
    const settings = store.getSnapshot().settings;
    if (stopped || !visible || !settings.holidayEnabled || settings.holidayMode !== 'automatic')
      return;
    const current = new Date(),
      next = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
    timer = setTimeout(
      () => {
        store.refreshDate();
        schedule();
      },
      Math.max(100, next.getTime() - current.getTime() + 50),
    );
  };
  const refresh = () => {
    if (document.visibilityState !== 'hidden' && nativeActive) store.refreshDate();
    schedule();
  };
  const unsubscribe = store.subscribe(schedule);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  const media = window.matchMedia?.('(prefers-reduced-transparency: reduce)');
  media?.addEventListener?.('change', refresh);
  if (Capacitor.isNativePlatform())
    void AndroidApp.addListener('appStateChange', ({ isActive }) => {
      nativeActive = isActive;
      refresh();
    })
      .then((handle) => {
        if (stopped) void handle.remove();
        else nativeHandle = handle;
      })
      .catch(() => {});
  refresh();
  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
    document.removeEventListener('visibilitychange', refresh);
    window.removeEventListener('focus', refresh);
    window.removeEventListener('pageshow', refresh);
    media?.removeEventListener?.('change', refresh);
    void nativeHandle?.remove();
  };
}
export function useAppearanceRuntime() {
  useEffect(() => startAppearanceRuntime(), []);
}
