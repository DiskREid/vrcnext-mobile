import { describe, expect, it, vi } from 'vitest';
import { createApi } from './index';
import type { NativeBridge, NativeResponse } from './native';

const fileId = 'file_22222222-2222-4222-8222-222222222222';
const avatarId = 'avtr_22222222-2222-4222-8222-222222222222';
const matched = { vrc_id: avatarId, name: 'Лунный Лис', author: { name: 'Author', vrc_id: 'usr_author' }, image_url: 'https://api.vrchat.cloud/api/1/file/' + fileId + '/1/file' };
const icu = { id: avatarId, name: 'Лис из ICU', authorName: 'ICU Author', authorId: 'usr_icu', imageUrl: matched.image_url };
const miss = (): NativeResponse => ({ status: 200, data: {} });
function fixture(options: { db?: NativeResponse; icu?: NativeResponse; file?: NativeResponse; native?: boolean } = {}) {
  const bridge = {
    resolvePublicAvatar: vi.fn(async ({ source }: { fileId: string; source?: 'avtrdb' | 'icu' }) => source === 'icu' ? options.icu || miss() : options.db || { status: 200, data: { [fileId]: matched } }),
    request: vi.fn(async () => options.file || { status: 404, data: {} }),
    searchPublicAvatars: vi.fn(),
  };
  return { bridge, client: createApi(bridge as unknown as NativeBridge, () => options.native !== false) };
}

describe('exact avatar metadata from an observed file ID', () => {
  it('uses the separate native resolve transport and only the exact keyed AvatarDB match', async () => {
    const { bridge, client } = fixture({ db: { status: 200, data: { file_other: { ...matched, name: 'Unrelated' }, [fileId]: matched } } });
    expect(await client.resolvePublicAvatar(fileId)).toEqual({ id: avatarId, name: 'Лунный Лис', authorName: 'Author', authorId: 'usr_author', imageUrl: matched.image_url, thumbnailImageUrl: matched.image_url, source: 'avtrdb' });
    expect(bridge.resolvePublicAvatar).toHaveBeenCalledExactlyOnceWith({ fileId });
    expect(bridge.request).not.toHaveBeenCalled();
    expect(bridge.searchPublicAvatars).not.toHaveBeenCalled();
  });

  it('falls back to the exact ICU file mapping before reading the official file', async () => {
    const { bridge, client } = fixture({ db: miss(), icu: { status: 200, data: { file_unrelated: { ...icu, name: 'Wrong mapping' }, [fileId]: icu } } });
    expect(await client.resolvePublicAvatar(fileId)).toMatchObject({ id: avatarId, name: 'Лис из ICU', authorName: 'ICU Author', authorId: 'usr_icu', source: 'icu' });
    expect(bridge.resolvePublicAvatar.mock.calls).toEqual([[{ fileId }], [{ fileId, source: 'icu' }]]);
    expect(bridge.request).not.toHaveBeenCalled();
    expect(bridge.searchPublicAvatars).not.toHaveBeenCalled();
  });

  it('obtains the official avatar-file name without inventing an unavailable avtr ID', async () => {
    for (const type of ['Image', 'Asset bundle', 'Unity package']) {
      const { bridge, client } = fixture({ db: miss(), file: { status: 200, data: { id: fileId, name: `Avatar - Лис - Moon - ${type} - 2026`, ownerId: 'usr_creator' } } });
      const result = await client.resolvePublicAvatar(fileId);
      expect(result).toEqual({ name: 'Лис - Moon', authorId: 'usr_creator', source: 'vrchat-file' });
      expect(result).not.toHaveProperty('id');
      expect(bridge.request).toHaveBeenCalledExactlyOnceWith({ path: '/file/' + fileId, method: 'GET' });
      expect(bridge.searchPublicAvatars).not.toHaveBeenCalled();
    }
  });

  it('does not turn user icons, gallery files, empty names or another official file into avatar metadata', async () => {
    for (const data of [
      { id: fileId, name: 'User Icon - Portrait - 2026' },
      { id: fileId, name: 'Gallery - Avatar - False - Image - 2026' },
      { id: fileId, name: 'Avatar -   - Image - 2026' },
      { id: 'file_other', name: 'Avatar - Wrong file - Image - 2026' },
      { id: fileId, name: null },
    ]) {
      const { bridge, client } = fixture({ db: miss(), file: { status: 200, data } });
      expect(await client.resolvePublicAvatar(fileId)).toBeUndefined();
      expect(bridge.searchPublicAvatars).not.toHaveBeenCalled();
    }
  });

  it('does not borrow unrelated, malformed, unnamed or non-avatar public mappings', async () => {
    for (const data of [{}, { file_other: matched }, { [fileId]: null }, { [fileId]: {} }, { [fileId]: { ...matched, name: '  ' } }, { [fileId]: { ...matched, vrc_id: 'usr_wrong' } }]) {
      const { bridge, client } = fixture({ db: { status: 200, data } });
      expect(await client.resolvePublicAvatar(fileId)).toBeUndefined();
      expect(bridge.resolvePublicAvatar).toHaveBeenCalledTimes(2);
      expect(bridge.request).toHaveBeenCalledExactlyOnceWith({ path: '/file/' + fileId, method: 'GET' });
      expect(bridge.searchPublicAvatars).not.toHaveBeenCalled();
    }
    expect(await fixture({ db: miss(), icu: { status: 200, data: { [fileId]: { ...icu, id: 'usr_wrong' } } } }).client.resolvePublicAvatar(fileId)).toBeUndefined();
  });

  it('treats hidden/loading files and Robot fallbacks as unavailable metadata', async () => {
    const { bridge, client } = fixture();
    for (const id of ['file_0e8c4e32-7444-44ea-ade4-313c010d4bae', 'file_31255e6b-696e-4c11-b007-595fa1142467'])
      expect(await client.resolvePublicAvatar(id)).toBeUndefined();
    expect(bridge.resolvePublicAvatar).not.toHaveBeenCalled();
    expect(bridge.request).not.toHaveBeenCalled();
    expect(await fixture({ db: { status: 200, data: { [fileId]: { ...matched, vrc_id: 'avtr_c38a1615-5bf5-42b4-84eb-a8b6c37cbd11' } } } }).client.resolvePublicAvatar(fileId)).toBeUndefined();
  });

  it('validates the bounded ID before contacting any transport', async () => {
    const { bridge, client } = fixture();
    for (const invalid of ['', 'file_', 'file_../auth', 'https://api.avtrdb.com', 'file_x?auth=secret', 'file_x"}', 'file_x\n', 'file_' + 'x'.repeat(121)])
      await expect(client.resolvePublicAvatar(invalid)).rejects.toThrow('идентификатор');
    expect(bridge.resolvePublicAvatar).not.toHaveBeenCalled();
    expect(bridge.request).not.toHaveBeenCalled();
  });

  it('propagates public-database rate limits without hammering the next transport', async () => {
    const { bridge, client } = fixture({ db: { status: 429, retryAfter: 90, data: {} } });
    await expect(client.resolvePublicAvatar(fileId)).rejects.toMatchObject({ status: 429, retryAfter: 90 });
    expect(bridge.resolvePublicAvatar).toHaveBeenCalledOnce();
    expect(bridge.request).not.toHaveBeenCalled();
    const limitedIcu = fixture({ db: miss(), icu: { status: 429, retryAfter: 45, data: {} } });
    await expect(limitedIcu.client.resolvePublicAvatar(fileId)).rejects.toMatchObject({ status: 429, retryAfter: 45 });
    expect(limitedIcu.bridge.request).not.toHaveBeenCalled();
  });

  it('continues after unavailable or malformed public services and accepts only a real official file name', async () => {
    for (const db of [{ status: 503, data: {} }, { status: 200, data: null }, { status: 200, data: [] }, { status: 200, data: 'not a map' }]) {
      const { client } = fixture({ db, file: { status: 200, data: { id: fileId, name: 'Avatar - Official - Image - 2026' } } });
      expect(await client.resolvePublicAvatar(fileId)).toEqual({ name: 'Official', source: 'vrchat-file' });
    }
    const { bridge, client } = fixture({ file: { status: 200, data: { id: fileId, name: 'Avatar - Recovered - Image - 2026' } } });
    bridge.resolvePublicAvatar.mockRejectedValue(new Error('transport internals'));
    expect(await client.resolvePublicAvatar(fileId)).toEqual({ name: 'Recovered', source: 'vrchat-file' });
  });

  it('keeps official authorization/rate-limit errors visible and treats forbidden or missing files as unknown', async () => {
    for (const status of [401, 429]) {
      const { client } = fixture({ db: miss(), file: { status, retryAfter: 30, data: {} } });
      await expect(client.resolvePublicAvatar(fileId)).rejects.toMatchObject({ status });
    }
    for (const status of [403, 404]) {
      const { client } = fixture({ db: miss(), file: { status, data: {} } });
      expect(await client.resolvePublicAvatar(fileId)).toBeUndefined();
    }
  });

  it('does not send public lookup requests from the browser demo', async () => {
    const { bridge, client } = fixture({ native: false });
    await expect(client.resolvePublicAvatar(fileId)).rejects.toThrow('Android APK');
    expect(bridge.resolvePublicAvatar).not.toHaveBeenCalled();
    expect(bridge.request).not.toHaveBeenCalled();
  });
});
