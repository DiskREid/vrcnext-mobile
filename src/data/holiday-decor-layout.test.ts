import { describe, expect, it } from 'vitest';
import { holidayDecorLayout } from './holiday-decor-layout';
import type { HolidayId } from './holiday-calendar';

const holidays: HolidayId[] = [
  'valentine',
  'womens-day',
  'st-patrick',
  'easter',
  'earth-day',
  'halloween',
  'christmas',
];

describe('stable holiday ornament layout', () => {
  it('preserves placement and size through repeated renders and holiday round trips', () => {
    const initial = holidayDecorLayout('halloween', 'ambient', 123);
    holidayDecorLayout('christmas', 'ambient', 123);
    expect(holidayDecorLayout('halloween', 'ambient', 123)).toEqual(initial);
    expect(holidayDecorLayout('halloween', 'ambient', 124)).not.toEqual(initial);
    expect(holidayDecorLayout('christmas', 'ambient', 123)).not.toEqual(initial);
    expect(holidayDecorLayout('halloween', 'hero', 123)).not.toEqual(initial);
  });

  it('keeps every holiday within the viewport and supplies varied sizes without clustering', () => {
    for (const holiday of holidays) {
      for (const seed of [0, 123, 4294967295]) {
        const placements = holidayDecorLayout(holiday, 'ambient', seed);
        expect(placements).toHaveLength(8);
        expect(
          new Set(
            placements.map(
              (piece) => `${Math.floor(piece.x / 50)}:${Math.floor((piece.y - 10) / 23)}`,
            ),
          ).size,
        ).toBe(8);
        for (const piece of placements) {
          expect(piece.x).toBeGreaterThanOrEqual(7);
          expect(piece.x).toBeLessThanOrEqual(89);
          expect(piece.y).toBeGreaterThanOrEqual(10);
          expect(piece.y).toBeLessThanOrEqual(91);
          expect(piece.size).toBeGreaterThanOrEqual(16);
          expect(piece.size).toBeLessThanOrEqual(62);
          expect(piece.rotation).toBeGreaterThanOrEqual(-28);
          expect(piece.rotation).toBeLessThanOrEqual(28);
          expect(piece.duration).toBeGreaterThanOrEqual(17);
          expect(piece.duration).toBeLessThanOrEqual(30);
        }
        const fallback = placements.slice(0, 2);
        expect(fallback[1].size - fallback[0].size).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('bounds hero decorations to four pieces with distinct small and large ornaments', () => {
    for (const holiday of holidays) {
      const placements = holidayDecorLayout(holiday, 'hero', 513);
      expect(placements).toHaveLength(4);
      for (const piece of placements) {
        expect(piece.x).toBeGreaterThanOrEqual(18);
        expect(piece.x).toBeLessThanOrEqual(86);
        expect(piece.y).toBeGreaterThanOrEqual(18);
        expect(piece.y).toBeLessThanOrEqual(76);
        expect(piece.size).toBeGreaterThanOrEqual(16);
        expect(piece.size).toBeLessThanOrEqual(48);
      }
      expect(placements[0].size).toBeLessThan(placements[1].size);
    }
  });
});
