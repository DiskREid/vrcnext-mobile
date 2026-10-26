import { describe, expect, it, vi } from 'vitest';
import { boopPayload, defaultBoopChoices, fileBoopChoices, inventoryBoopChoices } from './boop';
import type { BoopSelection } from './boop';
import { createApi } from './index';
import type { NativeBridge } from './native';

describe('Boop selection contract', () => {
  it('keeps the selected default, custom version or inventory ID instead of silently sending a generic Boop', () => {
    expect(boopPayload()).toEqual({});
    expect(boopPayload({ emojiId: 'default_heart' })).toEqual({ emojiId: 'default_heart' });
    expect(boopPayload({ emojiId: 'file_owned', emojiVersion: 7 })).toEqual({ emojiId: 'file_owned', emojiVersion: 7 });
    expect(boopPayload({ inventoryItemId: 'inv_owned' })).toEqual({ inventoryItemId: 'inv_owned' });
    expect(defaultBoopChoices.every((choice) => choice.preview.startsWith('/boop/') && boopPayload(choice.selection).emojiId === choice.id)).toBe(true);
  });
  it('rejects incompatible IDs, mixed forms and nonpositive versions locally', () => {
    for (const choice of [
      { emojiId: 'sticker_owned' }, { inventoryItemId: 'file_owned' }, { emojiId: 'file_owned', inventoryItemId: 'inv_owned' },
      { emojiId: 'file_owned', emojiVersion: 0 }, { emojiId: 'file_owned', emojiVersion: 2.5 },
      { emojiId: 'default_heart', emojiVersion: 1 },
    ]) expect(() => boopPayload(choice as BoopSelection)).toThrow();
  });
  it('uses only available emoji inventory items and never ordinary stickers or expired items', () => {
    const rows = [
      { id: 'inv_good', name: 'Real collectible', itemType: 'emoji', imageUrl: 'https://example.test/emoji.png', metadata: { fileId: 'file_emote' } },
      { id: 'inv_sticker', itemType: 'sticker', imageUrl: 'https://example.test/sticker.png' },
      { id: 'inv_archived', itemType: 'emoji', imageUrl: 'https://example.test/archived.png', isArchived: true },
      { id: 'inv_expired', itemType: 'emoji', imageUrl: 'https://example.test/expired.png', expiryDate: '2020-01-01T00:00:00Z' },
      { id: 'inv_nopreview', itemType: 'emoji' },
    ];
    expect(inventoryBoopChoices(rows)).toEqual([{ id: 'inv_good', name: 'Real collectible', preview: rows[0].imageUrl, selection: { inventoryItemId: 'inv_good' } }]);
  });
  it('uses the highest complete uploaded emoji version and no unrelated file record', () => {
    expect(fileBoopChoices([
      { id: 'file_owned', name: 'My emoji', versions: [{ version: 7, status: 'complete', file: { url: 'https://example.test/7.png' } }, { version: 9, status: 'waiting', file: { url: 'https://example.test/9.png' } }, { version: 1, status: 'complete', file: { url: 'https://example.test/1.png' } }] },
      { id: 'avtr_wrong', imageUrl: 'https://example.test/not-emoji.png' },
    ])).toEqual([{ id: 'file_owned', name: 'My emoji', preview: 'https://example.test/7.png', selection: { emojiId: 'file_owned', emojiVersion: 7 } }]);
  });
  it('sends exact JSON to the documented endpoint and filters inventory to emoji items', async () => {
    const request = vi.fn(async (options: { path: string }) => options.path.startsWith('/inventory') ? { status: 200, data: { data: [], totalCount: 0 } } : { status: 200, data: { success: { status_code: 200, message: 'User booped!' } } });
    const client = createApi({ request } as unknown as NativeBridge);
    await client.boop('usr_friend', { emojiId: 'default_heart' });
    await client.boop('usr_friend', { emojiId: 'file_owned', emojiVersion: 3 });
    await client.boop('usr_friend', { inventoryItemId: 'inv_owned' });
    await client.boopInventory(100);
    expect(request.mock.calls).toEqual([
      [{ path: '/users/usr_friend/boop', method: 'POST', body: '{"emojiId":"default_heart"}' }],
      [{ path: '/users/usr_friend/boop', method: 'POST', body: '{"emojiId":"file_owned","emojiVersion":3}' }],
      [{ path: '/users/usr_friend/boop', method: 'POST', body: '{"inventoryItemId":"inv_owned"}' }],
      [{ path: '/inventory?types=emoji&archived=false&n=100&offset=100', method: 'GET' }],
    ]);
  });
  it('preserves 429 and does not resend or swap the selected emoji after a rejected request', async () => {
    const request = vi.fn(async () => ({ status: 429, data: {}, retryAfter: 90 }));
    const client = createApi({ request } as unknown as NativeBridge);
    await expect(client.boop('usr_friend', { emojiId: 'default_heart' })).rejects.toMatchObject({ status: 429, retryAfter: 90 });
    expect(request).toHaveBeenCalledOnce();
  });
});
