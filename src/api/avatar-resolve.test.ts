import { describe, expect, it, vi } from 'vitest';
import { createApi } from './index';
import type { NativeBridge, NativeResponse } from './native';

const fileId = 'file_22222222-2222-4222-8222-222222222222';
const avatarId = 'avtr_22222222-2222-4222-8222-222222222222';
const matched = { vrc_id: avatarId, name: 'Лунный Лис', author: { name: 'Author', vrc_id: 'usr_author' }, image_url: 'https://api.vrchat.cloud/api/1/file/' + fileId + '/1/file' };
function fixture(response: NativeResponse = { status: 200, data: { [fileId]: matched } }, native = true) {
  const bridge = { resolvePublicAvatar: vi.fn(async () => response), request: vi.fn(), searchPublicAvatars: vi.fn() };
  return { bridge, client: createApi(bridge as unknown as NativeBridge, () => native) };
}

describe('exact avatar metadata from an observed file ID', () => {
  it('uses the separate native resolve transport and only the exact keyed match', async () => {
    const { bridge, client } = fixture({ status: 200, data: { file_other: { ...matched, name: 'Unrelated' }, [fileId]: matched } });
    expect(await client.resolvePublicAvatar(fileId)).toMatchObject({ id: avatarId, name: 'Лунный Лис', authorName: 'Author', authorId: 'usr_author', imageUrl: matched.image_url, source: 'avtrdb', releaseStatus: undefined });
    expect(bridge.resolvePublicAvatar).toHaveBeenCalledExactlyOnceWith({ fileId });
    expect(bridge.request).not.toHaveBeenCalled();
    expect(bridge.searchPublicAvatars).not.toHaveBeenCalled();
  });

  it('leaves missing, unindexed or unnamed avatars unresolved without a fuzzy search', async () => {
    for (const data of [{}, { file_other: matched }, { [fileId]: null }, { [fileId]: {} }, { [fileId]: { ...matched, name: '  ' } }, { [fileId]: { ...matched, vrc_id: 'usr_wrong' } }]) {
      const { bridge, client } = fixture({ status: 200, data });
      expect(await client.resolvePublicAvatar(fileId)).toBeUndefined();
      expect(bridge.resolvePublicAvatar).toHaveBeenCalledOnce();
      expect(bridge.searchPublicAvatars).not.toHaveBeenCalled();
      expect(bridge.request).not.toHaveBeenCalled();
    }
  });

  it('does not treat a placeholder file or the resolver Robot fallback as a real selection', async () => {
    const { bridge, client } = fixture();
    for (const id of ['file_0e8c4e32-7444-44ea-ade4-313c010d4bae', 'file_31255e6b-696e-4c11-b007-595fa1142467'])
      expect(await client.resolvePublicAvatar(id)).toBeUndefined();
    expect(bridge.resolvePublicAvatar).not.toHaveBeenCalled();
    expect(await fixture({ status: 200, data: { [fileId]: { ...matched, vrc_id: 'avtr_c38a1615-5bf5-42b4-84eb-a8b6c37cbd11' } } }).client.resolvePublicAvatar(fileId)).toBeUndefined();
  });

  it('validates the bounded ID before contacting any transport', async () => {
    const { bridge, client } = fixture();
    for (const invalid of ['', 'file_', 'file_../auth', 'https://api.avtrdb.com', 'file_x?auth=secret', 'file_x"}', 'file_x\n', 'file_' + 'x'.repeat(121)])
      await expect(client.resolvePublicAvatar(invalid)).rejects.toThrow('идентификатор');
    expect(bridge.resolvePublicAvatar).not.toHaveBeenCalled();
  });

  it('propagates database rate limits without replaying the request or querying profiles', async () => {
    const { bridge, client } = fixture({ status: 429, retryAfter: 90, data: {} });
    await expect(client.resolvePublicAvatar(fileId)).rejects.toMatchObject({ status: 429, retryAfter: 90 });
    expect(bridge.resolvePublicAvatar).toHaveBeenCalledOnce();
    expect(bridge.request).not.toHaveBeenCalled();
  });

  it('does not turn failures or malformed replies into fictional avatar metadata', async () => {
    await expect(fixture({ status: 503, data: {} }).client.resolvePublicAvatar(fileId)).rejects.toMatchObject({ status: 503 });
    for (const data of [null, [], 'not a map'])
      await expect(fixture({ status: 200, data }).client.resolvePublicAvatar(fileId)).rejects.toThrow('некорректный');
    const { bridge, client } = fixture();
    bridge.resolvePublicAvatar.mockRejectedValue(new Error('transport details must remain internal'));
    await expect(client.resolvePublicAvatar(fileId)).rejects.toThrow('Не удалось получить');
  });

  it('does not send public lookup requests from the browser demo', async () => {
    const { bridge, client } = fixture(undefined, false);
    await expect(client.resolvePublicAvatar(fileId)).rejects.toThrow('Android APK');
    expect(bridge.resolvePublicAvatar).not.toHaveBeenCalled();
  });
});
