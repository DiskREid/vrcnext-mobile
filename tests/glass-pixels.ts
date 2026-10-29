import { expect } from '@playwright/test';
import { inflateSync } from 'node:zlib';

/** Decode Chromium's ordinary non-interlaced RGB/RGBA PNG without adding an app dependency. */
export function pngPixels(png: Buffer) {
  expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  let width = 0,
    height = 0,
    channels = 0;
  const chunks: Buffer[] = [];
  for (let position = 8; position < png.length; ) {
    const length = png.readUInt32BE(position),
      type = png.toString('ascii', position + 4, position + 8);
    const data = png.subarray(position + 8, position + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      expect(data[12]).toBe(0);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      expect(channels).toBeGreaterThan(0);
    }
    if (type === 'IDAT') chunks.push(data);
    position += length + 12;
  }
  const packed = inflateSync(Buffer.concat(chunks)),
    stride = width * channels;
  const pixels = new Uint8Array(width * height * channels);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1),
      filter = packed[start];
    expect(filter).toBeLessThanOrEqual(4);
    for (let x = 0; x < stride; x++) {
      const offset = y * stride + x,
        left = x >= channels ? pixels[offset - channels] : 0;
      const above = y ? pixels[offset - stride] : 0;
      const diagonal = y && x >= channels ? pixels[offset - stride - channels] : 0;
      const prediction =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : paeth(left, above, diagonal);
      pixels[offset] = (packed[start + 1 + x] + prediction) & 255;
    }
  }
  return { width, height, channels, pixels };
}
