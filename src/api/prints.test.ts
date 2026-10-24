import { describe, expect, it } from 'vitest';
import { printDate, printMedia } from './prints';

describe('Print response media', () => {
  const image = 'https://api.vrchat.cloud/api/1/file/file_synthetic/3/file';
  it('loads the documented nested files.image response used by desktop VRCNext', () => {
    expect(
      printMedia({ id: 'prnt_synthetic', files: { fileId: 'file_synthetic', image } }),
    ).toEqual({ original: image, thumbnail: image });
  });
  it('uses a returned thumbnail for the grid and preserves the authenticated full image', () => {
    const thumbnail = 'https://file-variants.vrchat.com/synthetic.png?signature=synthetic';
    expect(
      printMedia({ id: 'prnt_synthetic', files: { image }, thumbnailImageUrl: thumbnail }),
    ).toEqual({ original: image, thumbnail });
  });
  it('supports flattened legacy responses and does not guess missing image versions', () => {
    expect(printMedia({ id: 'prnt_synthetic', imageUrl: image }).original).toBe(image);
    expect(printMedia({ id: 'prnt_synthetic', files: { fileId: 'file_synthetic' } })).toEqual({
      original: '',
      thumbnail: '',
    });
  });
  it('rejects foreign or credential-bearing media without losing a safe fallback', () => {
    for (const invalid of [
      'http://api.vrchat.cloud/a.png',
      'https://evil.example/a.png',
      'https://api.vrchat.cloud.evil.example/a.png',
      'https://user:pass@api.vrchat.cloud/a.png',
      'https://api.vrchat.cloud:8443/a.png',
      'javascript:alert(1)',
    ]) {
      expect(
        printMedia({ id: 'prnt_synthetic', files: { image: invalid }, imageUrl: image }).original,
      ).toBe(image);
    }
  });
  it('chooses a valid timestamp without creating fictitious dates', () => {
    expect(
      printDate({ id: 'prnt_synthetic', createdAt: 'invalid', timestamp: '2026-10-20T12:00:00Z' }),
    ).toBe('2026-10-20T12:00:00Z');
    expect(printDate({ id: 'prnt_synthetic' })).toBeUndefined();
  });
});
