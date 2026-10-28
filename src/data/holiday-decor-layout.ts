import type { HolidayId } from './holiday-calendar';

export type DecorArea = 'ambient' | 'hero';
export interface DecorPlacement {
  x: number;
  y: number;
  size: number;
  rotation: number;
  opacity: number;
  duration: number;
  delay: number;
  drift: number;
}

/** A small seeded layout: no timers or fresh randomness while React renders. */
export function holidayDecorLayout(
  holiday: HolidayId,
  area: DecorArea,
  sessionSeed: number,
): readonly DecorPlacement[] {
  let state = sessionSeed >>> 0;
  for (const character of `${holiday}:${area}`)
    state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const ambient = area === 'ambient';
  const count = ambient ? 8 : 4;
  return Array.from({ length: count }, (_, index) => {
    // Alternating size bands keep the composition visibly varied even in the
    // two-piece fallback. Grid cells prevent all ornaments gathering in a corner.
    const small = index % 2 === 0;
    const size = ambient
      ? small
        ? 16 + random() * 16
        : 38 + random() * 24
      : small
        ? 16 + random() * 12
        : 30 + random() * 18;
    const column = index % 2;
    const row = Math.floor(index / 2);
    return Object.freeze({
      x:
        Math.round(
          (ambient ? 7 + column * 48 + random() * 34 : 18 + column * 52 + random() * 16) * 100,
        ) / 100,
      y:
        Math.round(
          (ambient ? 10 + row * 23 + random() * 12 : 18 + row * 43 + random() * 15) * 100,
        ) / 100,
      size: Math.round(size * 100) / 100,
      rotation: Math.round(-28 + random() * 56),
      opacity: Math.round((0.62 + random() * 0.38) * 100) / 100,
      duration: Math.round(17 + random() * 13),
      delay: -Math.round(random() * 25),
      drift: Math.round(4 + random() * 7),
    });
  });
}
