import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { native } from '../api/native';
import { recordWebFailure } from '../api/diagnostics';
import { appearanceStore } from './appearance';
import type { AppearanceSnapshot } from './appearance';
import type { HolidayId } from './holiday-calendar';

type Variant = HolidayId | 'standard';
interface AppearanceSource {
  getSnapshot(): AppearanceSnapshot;
  subscribe(listener: () => void): () => void;
}

/** Serialize alias changes; when settings change during a native call, the newest choice wins. */
export function startLauncherIconSync(
  source: AppearanceSource,
  apply: (holiday: HolidayId | null) => Promise<unknown>,
  onError: (error: unknown) => void = () => {},
) {
  let desired: Variant | undefined;
  let applied: Variant | undefined;
  let running = false;
  let stopped = false;
  const flush = async () => {
    running = true;
    try {
      while (!stopped && desired && applied !== desired) {
        const requested: Variant = desired;
        try {
          await apply(requested === 'standard' ? null : requested);
          applied = requested;
        } catch (error) {
          onError(error);
          if (desired === requested) break;
        }
      }
    } finally {
      running = false;
    }
  };
  const update = () => {
    const next = source.getSnapshot().activeHoliday || 'standard';
    if (next === desired) return;
    desired = next;
    if (!running) void flush();
  };
  const unsubscribe = source.subscribe(update);
  update();
  return () => {
    stopped = true;
    unsubscribe();
  };
}

export function useLauncherIconRuntime() {
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    return startLauncherIconSync(
      appearanceStore,
      (holiday) => native.setLauncherIcon({ holiday }),
      (error) => recordWebFailure('runtime', error),
    );
  }, []);
}
