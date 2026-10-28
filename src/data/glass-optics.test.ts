import { describe, expect, it } from 'vitest';
import { createGlassDisplacementMap } from './glass-optics';
import type { GlassDisplacementMap } from './glass-optics';

const make = (overrides = {}) =>
  createGlassDisplacementMap({
    width: 256,
    height: 160,
    radius: 32,
    intensity: 'medium',
    ...overrides,
  });
const pixel = (map: GlassDisplacementMap, x: number, y: number) => [
  ...map.pixels.slice((y * map.pixelWidth + x) * 4, (y * map.pixelWidth + x) * 4 + 4),
];
const offset = (map: GlassDisplacementMap, channel: number) => {
  let maximum = 0;
  for (let i = channel; i < map.pixels.length; i += 4)
    maximum = Math.max(maximum, (Math.abs(map.pixels[i] - 128) / 255) * map.scale);
  return maximum;
};

describe('bounded glass lens displacement maps', () => {
  it('keeps the clear centre and the exterior rounded corners neutral and opaque', () => {
    const map = make();
    for (const [x, y] of [
      [128, 80],
      [100, 70],
      [0, 0],
      [255, 0],
      [0, 159],
      [255, 159],
    ])
      expect(pixel(map, x, y)).toEqual([128, 128, 128, 255]);
    expect(
      map.pixels.every((value, index) =>
        index % 4 === 2 ? value === 128 : index % 4 === 3 ? value === 255 : true,
      ),
    ).toBe(true);
  });

  it('refracts horizontally and vertically along opposing boundary normals, including curved corners', () => {
    const map = make();
    expect(pixel(map, 5, 80)[0]).toBeLessThan(40);
    expect(pixel(map, 250, 80)[0]).toBeGreaterThan(216);
    expect(pixel(map, 128, 5)[1]).toBeLessThan(40);
    expect(pixel(map, 128, 154)[1]).toBeGreaterThan(216);
    expect(pixel(map, 12, 12)[0]).toBeLessThan(128);
    expect(pixel(map, 12, 12)[1]).toBeLessThan(128);
    // Tangential channels remain neutral along straight sides.
    expect(pixel(map, 5, 80)[1]).toBe(128);
    expect(pixel(map, 128, 5)[0]).toBe(128);
    for (let y = 0; y < map.pixelHeight; y += 7) {
      for (let x = 0; x < map.pixelWidth; x += 7) {
        const a = pixel(map, x, y),
          b = pixel(map, map.pixelWidth - x - 1, y);
        expect(Math.abs(a[0] + b[0] - 256)).toBeLessThanOrEqual(1);
        expect(a[1]).toBe(b[1]);
      }
    }
  });

  it('adds a smaller reversed inner lip and leaves the deeper interior undistorted', () => {
    const map = make();
    expect(pixel(map, 250, 80)[0]).toBeGreaterThan(128);
    expect(pixel(map, 242, 80)[0]).toBeLessThan(128);
    expect(pixel(map, 230, 80)).toEqual([128, 128, 128, 255]);
  });

  it('changes actual CSS-pixel displacement with intensity and keeps a tight raster budget', () => {
    const maps = (['low', 'medium', 'high'] as const).map((intensity) => make({ intensity }));
    expect(maps.map((map) => map.scale)).toEqual([12, 24, 40]);
    const peaks = maps.map((map) => offset(map, 0));
    expect(peaks[0]).toBeGreaterThan(5);
    expect(peaks[1]).toBeGreaterThan(peaks[0] * 1.8);
    expect(peaks[2]).toBeGreaterThan(peaks[1] * 1.5);
    for (const options of [
      { width: 390, height: 66 },
      { width: 4000, height: 50 },
      { width: 30, height: 5000 },
      { width: 16384, height: 16384 },
    ]) {
      const map = make(options);
      expect(map.pixelWidth).toBeLessThanOrEqual(256);
      expect(map.pixelHeight).toBeLessThanOrEqual(256);
      expect(map.pixelWidth).toBeGreaterThanOrEqual(16);
      expect(map.pixelHeight).toBeGreaterThanOrEqual(16);
      expect(map.pixels.length).toBeLessThanOrEqual(256 * 256 * 4);
      expect(map.scale / 2).toBeLessThanOrEqual(Math.min(map.width, map.height) * 0.3);
    }
    const ordinary = make({ width: 450, height: 210 });
    expect(Math.abs(ordinary.pixelWidth / ordinary.pixelHeight - 450 / 210)).toBeLessThan(0.02);
  });

  it('supports square corners, clamps oversized radii and returns safe neutral maps for missing geometry', () => {
    const square = make({ radius: 0 });
    expect(offset(square, 0)).toBeGreaterThan(10);
    expect(make({ radius: 1000 }).radius).toBe(80);
    expect(make({ radius: -5 }).radius).toBe(0);
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      for (const geometry of [
        { width: bad, height: 16384 },
        { width: 16384, height: bad },
      ]) {
        const map = make(geometry);
        expect(map.scale).toBe(0);
        expect(map.bevelCssPx).toBe(0);
        expect(map.pixels.length).toBeLessThanOrEqual(256 * 256 * 4);
        expect(map.pixels.every((value, index) => value === (index % 4 === 3 ? 255 : 128))).toBe(
          true,
        );
      }
    }
  });

  it('is deterministic without shared buffers or a changing random field', () => {
    const a = make(),
      b = make();
    expect(a.pixels.every((value, index) => value === b.pixels[index])).toBe(true);
    expect(a.pixels).not.toBe(b.pixels);
    a.pixels[0] = 0;
    expect(b.pixels[0]).toBe(128);
  });
});
