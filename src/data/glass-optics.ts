import type { GlassIntensity } from './appearance';

export interface GlassDisplacementOptions {
  width: number;
  height: number;
  radius: number;
  intensity: GlassIntensity;
}
export interface GlassDisplacementMap {
  width: number;
  height: number;
  radius: number;
  pixelWidth: number;
  pixelHeight: number;
  pixels: Uint8ClampedArray;
  /** SVG feDisplacementMap scale in CSS pixels; the maximum offset is half this. */
  scale: number;
  bevelCssPx: number;
}

const settings = {
  low: { scale: 12, bevel: 10 },
  medium: { scale: 24, bevel: 16 },
  high: { scale: 40, bevel: 22 },
} as const;
const finiteSize = (value: number) =>
  Number.isFinite(value) && value > 0 ? Math.min(value, 16384) : 0;

/**
 * A rounded-rectangle lens normal map. Red/green move background samples along
 * the local surface normal; the clear centre and everything outside stay neutral.
 * The broad outward bevel and smaller inward lip model the two sides of a thick
 * glass edge without distorting foreground content or using animated noise.
 * Generate only on geometry/intensity changes, never once per animation frame.
 */
export function createGlassDisplacementMap(
  options: GlassDisplacementOptions,
): GlassDisplacementMap {
  const width = finiteSize(options.width),
    height = finiteSize(options.height),
    shortEdge = Math.min(width, height),
    valid = width > 0 && height > 0,
    radius = Number.isFinite(options.radius)
      ? Math.max(0, Math.min(options.radius, shortEdge / 2))
      : 0,
    quality = settings[options.intensity] || settings.medium;
  // Each map has at most 65,536 pixels. A minimum short side preserves the bevel
  // on very wide navigation bars; feImage stretches it to the exact CSS bounds.
  const ratio = Math.min(1, 256 / Math.max(width, height, 1)),
    pixelWidth = Math.max(16, Math.round(width * ratio)),
    pixelHeight = Math.max(16, Math.round(height * ratio)),
    pixels = new Uint8ClampedArray(pixelWidth * pixelHeight * 4),
    bevelCssPx = valid ? Math.min(quality.bevel, shortEdge * 0.26) : 0,
    scale = valid ? Math.min(quality.scale, shortEdge * 0.6) : 0;

  for (let py = 0; py < pixelHeight; py++) {
    for (let px = 0; px < pixelWidth; px++) {
      const x = ((px + 0.5) / pixelWidth - 0.5) * width,
        y = ((py + 0.5) / pixelHeight - 0.5) * height,
        qx = Math.abs(x) - (width / 2 - radius),
        qy = Math.abs(y) - (height / 2 - radius),
        ox = Math.max(qx, 0),
        oy = Math.max(qy, 0),
        outside = Math.hypot(ox, oy),
        depth = radius - outside - Math.min(Math.max(qx, qy), 0);
      let nx = 0,
        ny = 0,
        amount = 0;
      if (valid && depth > 0 && depth < bevelCssPx) {
        if (outside > 0) {
          nx = (Math.sign(x) * ox) / outside;
          ny = (Math.sign(y) * oy) / outside;
        } else if (qx > qy) nx = Math.sign(x);
        else ny = Math.sign(y);
        const t = depth / bevelCssPx;
        amount =
          t < 0.72
            ? Math.sin((Math.PI * t) / 0.72) ** 2 * 0.94
            : -(Math.sin((Math.PI * (t - 0.72)) / 0.28) ** 2) * 0.2;
      }
      const index = (py * pixelWidth + px) * 4;
      pixels[index] = Math.round(128 + 127 * nx * amount);
      pixels[index + 1] = Math.round(128 + 127 * ny * amount);
      pixels[index + 2] = 128;
      pixels[index + 3] = 255;
    }
  }
  return { width, height, radius, pixelWidth, pixelHeight, pixels, scale, bevelCssPx };
}
