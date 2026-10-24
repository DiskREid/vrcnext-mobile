import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  basicAuthorization,
  checked,
  createApi,
  isTwoFactorChallenge,
  unwrapList,
} from './index';
import type { NativeBridge, NativeResponse } from './native';

function fixture(responses: NativeResponse[] = []) {
  const bridge = {
    request: vi.fn(async () => responses.shift() ?? { status: 200, data: {} }),
    clearSession: vi.fn(async () => {}),
    disconnectPipeline: vi.fn(async () => {}),
  } as unknown as NativeBridge;
  return { bridge, client: createApi(bridge) };
}
const success = (data: unknown): NativeResponse => ({ status: 200, data });

describe('native VRChat authentication', () => {
  it('percent-encodes unicode and punctuation before basic auth without storing credentials', async () => {
    const { bridge, client } = fixture([success({ id: 'usr_me', displayName: 'Me' })]);
    await client.login('имя:用户', 'p!a:ss/é');
    const request = vi.mocked(bridge.request).mock.calls[0][0];
    expect(request.path).toBe('/auth/user');
    expect(request.authorization).toBe(
      'Basic ' + btoa('%D0%B8%D0%BC%D1%8F%3A%E7%94%A8%E6%88%B7:p%21a%3Ass%2F%C3%A9'),
    );
    expect(request.body).toBeUndefined();
    expect(basicAuthorization("a'b", 'x(y)')).toBe('Basic ' + btoa('a%27b:x%28y%29'));
  });
  it('returns a 2FA challenge without treating it as a logged-in user', async () => {
    const { client } = fixture([success({ requiresTwoFactorAuth: ['totp', 'otp'] })]);
    expect(isTwoFactorChallenge(await client.login('u', 'p'))).toBe(true);
  });
  it('verifies email OTP then fetches the authenticated profile', async () => {
    const { bridge, client } = fixture([
      success({ verified: true }),
      success({ id: 'usr_me', displayName: 'Me' }),
    ]);
    expect((await client.verify2fa(' 123456 ', 'emailOtp')).id).toBe('usr_me');
    expect(bridge.request).toHaveBeenNthCalledWith(1, {
      path: '/auth/twofactorauth/emailotp/verify',
      method: 'POST',
      body: '{"code":"123456"}',
    });
    expect(bridge.request).toHaveBeenNthCalledWith(2, { path: '/auth/user', method: 'GET' });
  });
  it('does not fetch a profile after rejected 2FA', async () => {
    const { bridge, client } = fixture([success({ verified: false })]);
    await expect(client.verify2fa('123456', 'totp')).rejects.toThrow('Неверный');
    expect(bridge.request).toHaveBeenCalledTimes(1);
  });
  it('clears local credentials even if logout and websocket disconnect fail', async () => {
    const { bridge, client } = fixture([{ status: 503, data: {} }]);
    vi.mocked(bridge.disconnectPipeline).mockRejectedValue(new Error('offline'));
    await expect(client.logout()).resolves.toEqual({ serverLoggedOut: false });
    expect(bridge.clearSession).toHaveBeenCalledTimes(1);
  });
  it('reports secure storage cleanup failure instead of claiming the user is logged out', async () => {
    const { bridge, client } = fixture([success({})]);
    vi.mocked(bridge.clearSession).mockRejectedValue(new Error('Storage unavailable'));
    await expect(client.logout()).rejects.toThrow('Storage unavailable');
  });
  it('never transmits browser credentials', async () => {
    const { bridge } = fixture();
    const browserClient = createApi(bridge, () => false);
    await expect(browserClient.login('private', 'secret')).rejects.toThrow('Android APK');
    expect(bridge.request).not.toHaveBeenCalled();
  });
});

describe('response and endpoint behavior', () => {
  it('preserves rate-limit status and delay without automatically retrying mutations', async () => {
    const { bridge, client } = fixture([{ status: 429, data: {}, retryAfter: 91 }]);
    await expect(client.friendRequest('usr_1')).rejects.toMatchObject({
      status: 429,
      retryAfter: 91,
    });
    expect(bridge.request).toHaveBeenCalledTimes(1);
  });
  it('normalizes known paged wrappers and rejects unexpected success shapes', () => {
    expect(unwrapList({ data: [{ id: '1' }], totalCount: 1 })).toEqual([{ id: '1' }]);
    expect(unwrapList({ events: [{ id: '2' }] })).toEqual([{ id: '2' }]);
    expect(() => unwrapList({ unexpected: [] })).toThrow(ApiError);
    expect(() => checked({ status: 401, data: {} })).toThrow('Сессия');
  });
  it('loads all pages for both online and offline friends and deduplicates IDs', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({
      id: 'usr_' + i,
      displayName: 'Friend ' + i,
    }));
    const { bridge, client } = fixture([
      success(page),
      success([{ id: 'usr_100', displayName: 'Last' }]),
      success([
        { id: 'usr_1', displayName: 'Friend 1' },
        { id: 'usr_101', displayName: 'Offline' },
      ]),
    ]);
    expect(await client.allFriends()).toHaveLength(102);
    expect(vi.mocked(bridge.request).mock.calls.map(([x]) => x.path)).toEqual([
      '/auth/user/friends?offline=false&n=100&offset=0',
      '/auth/user/friends?offline=false&n=100&offset=100',
      '/auth/user/friends?offline=true&n=100&offset=0',
    ]);
  });
  it('uses the current profile endpoint for bio and old endpoint only for user fields', async () => {
    const { bridge, client } = fixture([
      success({}),
      success({}),
      success({ id: 'usr_self', displayName: 'Me' }),
    ]);
    await client.updateProfile('usr_self', {
      status: 'active',
      pronouns: 'they/them',
      bio: 'Hello',
      languages: ['eng'],
    });
    expect(bridge.request).toHaveBeenNthCalledWith(1, {
      path: '/users/usr_self',
      method: 'PUT',
      body: '{"status":"active","pronouns":"they/them"}',
    });
    expect(bridge.request).toHaveBeenNthCalledWith(2, {
      path: '/profile/usr_self',
      method: 'PUT',
      body: '{"bio":"Hello","languages":["eng"]}',
    });
  });
  it('encodes search queries as data and normalizes membership identifiers', async () => {
    const { bridge, client } = fixture([
      success([]),
      success([{ groupId: 'grp_1', id: 'grpm_2', name: 'Community' }]),
    ]);
    await client.worlds('a&offset=999 #b');
    expect(vi.mocked(bridge.request).mock.calls[0][0].path).toContain(
      'search=a%26offset%3D999+%23b',
    );
    const groups = await client.groups('usr_1');
    expect(groups[0]).toMatchObject({ id: 'grp_1', membershipStatus: 'member' });
  });
  it('refuses locations not pointing to an accessible instance before sending', async () => {
    const { bridge, client } = fixture();
    expect(() => client.invite('usr_1', 'private')).toThrow('Нет доступного инстанса');
    expect(bridge.request).not.toHaveBeenCalled();
  });
});

describe('invite-template messaging', () => {
  it('does not overwrite or send when every message template is cooling down', async () => {
    const { bridge, client } = fixture([
      success([{ slot: 0, message: 'old', canBeUpdated: false, remainingCooldownMinutes: 25 }]),
    ]);
    await expect(client.sendMessage('usr_me', 'usr_friend', 'Hello')).rejects.toThrow('на паузе');
    expect(bridge.request).toHaveBeenCalledTimes(1);
  });
  it('reuses an identical server template without editing it', async () => {
    const { bridge, client } = fixture([
      success([
        { slot: 3, message: 'msg Hello', canBeUpdated: false, remainingCooldownMinutes: 25 },
      ]),
      success({}),
    ]);
    await client.sendMessage('usr_me', 'usr_friend', 'Hello');
    expect(bridge.request).toHaveBeenCalledTimes(2);
    expect(bridge.request).toHaveBeenLastCalledWith({
      path: '/invite/usr_friend',
      method: 'POST',
      body: JSON.stringify({
        instanceId: 'wrld_4432ea9b-729c-46e3-8eaf-846aa0a37fdd:0~region(eu)',
        worldId: 'wrld_4432ea9b-729c-46e3-8eaf-846aa0a37fdd',
        messageSlot: 3,
      }),
    });
  });
  it('updates an editable slot before sending the invite message', async () => {
    const { bridge, client } = fixture([
      success([{ slot: 2, message: '', canBeUpdated: true, remainingCooldownMinutes: 0 }]),
      success({}),
      success({}),
    ]);
    await client.sendMessage('usr_me', 'usr_friend', 'Hey');
    expect(bridge.request).toHaveBeenNthCalledWith(2, {
      path: '/message/usr_me/message/2',
      method: 'PUT',
      body: '{"message":"msg Hey"}',
    });
    expect(vi.mocked(bridge.request).mock.calls[2][0].path).toBe('/invite/usr_friend');
  });
});

describe('public avatar database search', () => {
  it('uses the separate credential-free bridge and maps external database responses', async () => {
    const { bridge, client } = fixture();
    bridge.searchPublicAvatars = vi.fn(async () =>
      success({
        avatars: [
          {
            vrc_id: 'avtr_1',
            name: 'Cloud',
            image_url: 'https://example.org/image.png',
            author: { name: 'Creator', vrc_id: 'usr_creator' },
            compatibility: ['PC', 'Quest'],
            tags: { author_tags: ['cute'] },
          },
        ],
      }),
    );
    expect(await client.searchPublicAvatars('Cloud', 2)).toEqual([
      {
        id: 'avtr_1',
        name: 'Cloud',
        description: undefined,
        imageUrl: 'https://example.org/image.png',
        thumbnailImageUrl: 'https://example.org/image.png',
        authorId: 'usr_creator',
        authorName: 'Creator',
        releaseStatus: 'public',
        unityPackages: [{ platform: 'standalonewindows' }, { platform: 'android' }],
        compatibility: ['PC', 'Quest'],
        source: 'avtrdb',
        tags: ['author_tag_cute'],
      },
    ]);
    expect(bridge.searchPublicAvatars).toHaveBeenCalledWith({ query: 'Cloud', page: 2 });
    expect(bridge.request).not.toHaveBeenCalled();
  });
  it('rejects invalid queries without contacting either service', async () => {
    const { bridge, client } = fixture();
    bridge.searchPublicAvatars = vi.fn();
    await expect(client.searchPublicAvatars('', 0)).rejects.toThrow('запрос');
    await expect(client.searchPublicAvatars('x', -1)).rejects.toThrow('страница');
    expect(bridge.searchPublicAvatars).not.toHaveBeenCalled();
  });
});

describe('v2 notifications and group actions', () => {
  it('merges notification versions, parses encoded payloads, and retains v1 action IDs', async () => {
    const { client } = fixture([
      success([
        {
          id: 'not_1',
          type: 'invite',
          created_at: '2026-01-01',
          details: '{"worldId":"wrld_1:0","inviteMessage":"Hi"}',
        },
      ]),
      success([
        {
          id: 'not_2',
          type: 'group.invite',
          senderDisplayName: 'Group',
          createdAt: '2026-01-02',
          data: '{"groupId":"grp_2"}',
        },
        { id: 'not_1', type: 'invite', senderDisplayName: 'Duplicate' },
      ]),
    ]);
    const result = await client.notifications();
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'not_2',
      senderUsername: 'Group',
      created_at: '2026-01-02',
      details: { groupId: 'grp_2' },
      _v2: true,
    });
    expect(result[1]).toMatchObject({
      id: 'not_1',
      message: 'Hi',
      details: { worldId: 'wrld_1:0' },
      _v2: false,
    });
  });
  it('treats only endpoint 404 as unsupported v2, not network or permission failures', async () => {
    const { bridge, client } = fixture([{ status: 404, data: {} }]);
    expect(await client.notificationsV2()).toEqual([]);
    expect(await client.notificationsV2()).toEqual([]);
    expect(bridge.request).toHaveBeenCalledTimes(1);
    const other = fixture([{ status: 403, data: {} }]);
    await expect(other.client.notificationsV2()).rejects.toMatchObject({ status: 403 });
  });
  it('accepts group invites through join, then hides only after join succeeded', async () => {
    const { bridge, client } = fixture([success({}), success({})]);
    await client.acceptNotification({
      id: 'not_group',
      type: 'group.invite',
      details: { groupId: 'grp_2' },
    });
    expect(vi.mocked(bridge.request).mock.calls.map(([r]) => [r.path, r.method])).toEqual([
      ['/groups/grp_2/join', 'POST'],
      ['/auth/user/notifications/not_group/hide', 'PUT'],
    ]);
  });
  it('keeps a failed group join visible rather than hiding it', async () => {
    const { bridge, client } = fixture([{ status: 403, data: {} }]);
    await expect(
      client.acceptNotification({
        id: 'not_group',
        type: 'group.invite',
        details: { groupId: 'grp_2' },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(bridge.request).toHaveBeenCalledTimes(1);
  });
  it('accepts group membership requests through the group request API', async () => {
    const { bridge, client } = fixture([success({}), success({})]);
    await client.acceptNotification({
      id: 'not_group',
      type: 'group.joinRequest',
      details: { groupId: 'grp_2', requestUserId: 'usr_requester' },
    });
    expect(bridge.request).toHaveBeenNthCalledWith(1, {
      path: '/groups/grp_2/requests/usr_requester',
      method: 'PUT',
      body: '{"action":"accept"}',
    });
  });
  it('invites the sender to the current location for requestInvite notifications', async () => {
    const { bridge, client } = fixture([success({}), success({})]);
    await client.acceptNotification(
      { id: 'not_request', type: 'requestInvite', senderUserId: 'usr_friend' },
      'wrld_123:0~region(eu)',
    );
    expect(bridge.request).toHaveBeenNthCalledWith(1, {
      path: '/invite/usr_friend',
      method: 'POST',
      body: '{"instanceId":"wrld_123:0~region(eu)","worldId":"wrld_123"}',
    });
  });
  it('resolves group request short codes against the current user memberships', async () => {
    const { bridge, client } = fixture([
      success({ id: 'usr_me', displayName: 'Me' }),
      success([{ groupId: 'grp_2', name: 'My Group', shortCode: 'SOCIAL' }]),
      success({}),
      success({}),
    ]);
    await client.acceptNotification({
      id: 'not_group',
      type: 'group.joinRequest',
      senderUserId: 'usr_requester',
      details: { groupName: 'SOCIAL' },
    });
    expect(bridge.request).toHaveBeenNthCalledWith(2, {
      path: '/users/usr_me/groups',
      method: 'GET',
    });
    expect(bridge.request).toHaveBeenNthCalledWith(3, {
      path: '/groups/grp_2/requests/usr_requester',
      method: 'PUT',
      body: '{"action":"accept"}',
    });
  });
  it('rejects group invites through the invite API, then hides the notification', async () => {
    const { bridge, client } = fixture([success({}), success({})]);
    await client.dismissNotification({
      id: 'not_group',
      type: 'group.invite',
      details: { groupId: 'grp_2' },
    });
    expect(bridge.request).toHaveBeenNthCalledWith(1, {
      path: '/groups/grp_2/invites',
      method: 'PUT',
      body: '{}',
    });
  });
});
