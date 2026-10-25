import { describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './index';
import {
  createProfileData,
  profileFriendAccess,
  redactProfileSecrets,
  safeProfileJson,
} from './profile-data';
import type { User } from './types';

function fixture(...responses: unknown[]) {
  const request = vi.fn(async () => responses.shift()) as unknown as typeof api.request;
  return { request, client: createProfileData(request) };
}

describe('profile tabs API privacy and contracts', () => {
  it('uses the author filter and only public worlds for a different user', async () => {
    const { request, client } = fixture([]);
    await client.authoredWorlds('usr_author', false, 50);
    const path = vi.mocked(request).mock.calls[0][0];
    const url = new URL(path, 'https://api.vrchat.cloud/api/1');
    expect(url.pathname).toBe('/worlds');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      userId: 'usr_author',
      releaseStatus: 'public',
      offset: '50',
    });
    expect(url.searchParams.has('user')).toBe(false);
  });

  it('loads public standard and VRC+ categories using their actual names', async () => {
    const { client, request } = fixture(
      {
        favoriteGroups: [
          { id: 'fvgrp_one', name: 'worlds2', displayName: 'Public', visibility: 'public' },
          { name: 'worlds3', visibility: 'private' },
        ],
      },
      {
        favoriteGroups: [
          { id: 'fvgrp_plus', name: 'vrcPlusWorlds4', displayName: 'Plus', visibility: 'public' },
          { name: 'vrcPlusWorlds1', visibility: 'friends' },
        ],
      },
      {
        favorites: [
          {
            type: 'vrcPlusWorld',
            world: { id: 'wrld_real', name: 'Real world', authorId: 'usr_author' },
          },
        ],
      },
    );
    const groups = await client.favoriteGroups('usr_author', false);
    expect(groups.map((group) => [group.type, group.name])).toEqual([
      ['world', 'worlds2'],
      ['vrcPlusWorld', 'vrcPlusWorlds4'],
    ]);
    expect(await client.favoriteWorlds('usr_author', groups[1], false)).toMatchObject([
      { id: 'wrld_real', name: 'Real world' },
    ]);
    expect(request).toHaveBeenLastCalledWith(
      '/favorites/groups/vrcPlusWorld/vrcPlusWorlds4?ownerId=usr_author',
    );
  });

  it('refuses a foreign private category before making any request', async () => {
    const { client, request } = fixture();
    await expect(
      client.favoriteWorlds(
        'usr_other',
        {
          id: 'private',
          name: 'worlds1',
          type: 'world',
          visibility: 'private',
          displayName: 'Private',
        },
        false,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(request).not.toHaveBeenCalled();
  });

  it('uses the current account-relative relationship rather than treating a stale key as friendship', () => {
    expect(profileFriendAccess({ isFriend: true })).toBe(true);
    expect(profileFriendAccess({ friendKey: 'server-friend-key' })).toBe(true);
    expect(profileFriendAccess({ isFriend: false, friendKey: 'old-friend-key' })).toBe(false);
    expect(profileFriendAccess({ friendKey: '  ' })).toBe(false);
    expect(profileFriendAccess({})).toBe(false);
  });

  it('loads friends-only standard and VRC+ categories for a confirmed friend without exposing private categories', async () => {
    const { client, request } = fixture(
      {
        favoriteGroups: [
          { id: 'public', name: 'worlds1', visibility: 'public' },
          { id: 'friends', name: 'worlds2', visibility: 'friends' },
          { id: 'private', name: 'worlds3', visibility: 'private' },
        ],
      },
      {
        favoriteGroups: [
          { id: 'plus', name: 'vrcPlusWorlds1', visibility: 'friends' },
          { id: 'plus-private', name: 'vrcPlusWorlds2', visibility: 'private' },
        ],
      },
      { favorites: [{ world: { id: 'wrld_friend', name: 'Shared with friends' } }] },
    );
    const groups = await client.favoriteGroups('usr_friend', false, true);
    expect(groups.map((group) => group.id)).toEqual(['public', 'friends', 'plus']);
    expect(await client.favoriteWorlds('usr_friend', groups[2], false, true)).toMatchObject([
      { id: 'wrld_friend', name: 'Shared with friends' },
    ]);
    expect(request).toHaveBeenLastCalledWith(
      '/favorites/groups/vrcPlusWorld/vrcPlusWorlds1?ownerId=usr_friend',
    );
  });

  it('never probes a friends-only collection without confirmed access or a private collection even for a friend', async () => {
    const { client, request } = fixture();
    const group = {
      id: 'hidden',
      name: 'worlds1',
      type: 'world' as const,
      displayName: 'Hidden',
      visibility: 'friends',
    };
    await expect(client.favoriteWorlds('usr_other', group, false)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      client.favoriteWorlds('usr_friend', { ...group, visibility: 'private' }, false, true),
    ).rejects.toMatchObject({ status: 403 });
    expect(request).not.toHaveBeenCalled();
  });

  it('propagates a server denial of a friend-visible collection instead of reporting a successful empty result', async () => {
    const request = vi.fn().mockRejectedValue(new ApiError('Forbidden', 403));
    const client = createProfileData(request as typeof api.request);
    await expect(
      client.favoriteWorlds(
        'usr_friend',
        {
          id: 'friends',
          name: 'worlds2',
          type: 'world',
          displayName: 'Friends',
          visibility: 'friends',
        },
        false,
        true,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('lets the owner read their private categories', async () => {
    const { client } = fixture(
      {
        favoriteGroups: [
          { id: 'mine', name: 'worlds1', displayName: 'Mine', visibility: 'private' },
        ],
      },
      { favoriteGroups: [] },
    );
    expect(await client.favoriteGroups('usr_self', true)).toMatchObject([
      { name: 'worlds1', visibility: 'private' },
    ]);
  });

  it('does not turn malformed favorite responses or unavailable worlds into successful fake cards', async () => {
    const { client } = fixture({ wrong: [] });
    await expect(client.favoriteGroups('usr_author', false)).rejects.toThrow('категорий');
    const contents = fixture({
      favorites: [
        { world: { id: 'wrld_deleted', unavailable: true } },
        { world: { id: 'wrld_available', name: 'Available' } },
      ],
    });
    await expect(
      contents.client.favoriteWorlds(
        'usr_author',
        {
          id: 'group',
          name: 'worlds1',
          displayName: 'Public',
          type: 'world',
          visibility: 'public',
        },
        false,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('resolves actual base-only VRC+ favorite entries by favoriteId and deduplicates metadata requests', async () => {
    const { client, request } = fixture(
      {
        favorites: [
          {
            id: 'fvrt_first',
            favoriteId: 'wrld_first',
            type: 'vrcPlusWorld',
            tags: ['vrcPlusWorlds1'],
          },
          {
            id: 'fvrt_second',
            favoriteId: 'wrld_second',
            type: 'vrcPlusWorld',
            tags: ['vrcPlusWorlds1'],
          },
          {
            id: 'fvrt_duplicate',
            favoriteId: 'wrld_first',
            type: 'vrcPlusWorld',
            tags: ['vrcPlusWorlds1'],
          },
        ],
      },
      { id: 'wrld_first', name: 'First real world', authorId: 'usr_author' },
      { id: 'wrld_second', name: 'Second real world', authorId: 'usr_author' },
    );
    const worlds = await client.favoriteWorlds(
      'usr_author',
      {
        id: 'fvgrp_plus',
        name: 'vrcPlusWorlds1',
        type: 'vrcPlusWorld',
        displayName: 'Public VRC+',
        visibility: 'public',
      },
      false,
    );
    expect(worlds.map((world) => world.id)).toEqual(['wrld_first', 'wrld_second']);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(2, '/worlds/wrld_first');
    expect(request).toHaveBeenNthCalledWith(3, '/worlds/wrld_second');
  });

  it('surfaces unavailable VRC+ metadata errors and never invents an empty collection', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        favorites: [
          {
            id: 'fvrt_real',
            favoriteId: 'wrld_unavailable',
            type: 'vrcPlusWorld',
            tags: ['vrcPlusWorlds1'],
          },
        ],
      })
      .mockRejectedValueOnce(new ApiError('World is not accessible', 403));
    await expect(
      createProfileData(request as typeof api.request).favoriteWorlds(
        'usr_author',
        {
          id: 'fvgrp_plus',
          name: 'vrcPlusWorlds1',
          type: 'vrcPlusWorld',
          displayName: 'Public VRC+',
          visibility: 'public',
        },
        false,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not fetch contents or world metadata for foreign private VRC+ categories', async () => {
    const { client, request } = fixture();
    await expect(
      client.favoriteWorlds(
        'usr_author',
        {
          id: 'fvgrp_private',
          name: 'vrcPlusWorlds1',
          type: 'vrcPlusWorld',
          displayName: 'Private VRC+',
          visibility: 'private',
        },
        false,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(request).not.toHaveBeenCalled();
  });

  it('bounds metadata resolution and rejects malformed favorite IDs before following any URL', async () => {
    const { client, request } = fixture({
      favorites: [
        {
          id: 'fvrt_bad',
          favoriteId: 'https://untrusted.example/world',
          type: 'vrcPlusWorld',
          tags: [],
        },
      ],
    });
    const group = {
      id: 'fvgrp_plus',
      name: 'vrcPlusWorlds1',
      type: 'vrcPlusWorld' as const,
      displayName: 'Public',
      visibility: 'public',
    };
    await expect(client.favoriteWorlds('usr_author', group, false)).rejects.toThrow(
      'без доступных данных',
    );
    expect(request).toHaveBeenCalledTimes(1);
    const bounded = fixture({
      favorites: Array.from({ length: 501 }, (_, index) => ({
        id: `fvrt_${index}`,
        favoriteId: `wrld_${index}`,
        type: 'vrcPlusWorld',
        tags: [],
      })),
    });
    await expect(bounded.client.favoriteWorlds('usr_author', group, false)).rejects.toThrow(
      'слишком большую',
    );
    expect(bounded.request).toHaveBeenCalledTimes(1);
  });

  it('propagates rate limits rather than hiding unavailable VRC+ loading as empty', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ favoriteGroups: [] })
      .mockRejectedValueOnce(new ApiError('Rate limit', 429));
    await expect(
      createProfileData(request as typeof api.request).favoriteGroups('usr_author', false),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('uses paged mutual endpoints and canonical group identifiers', async () => {
    const { client, request } = fixture(
      [{ id: 'usr_shared', displayName: 'Shared' }],
      [{ id: 'gmem_member', groupId: 'grp_real', name: 'Real group' }],
    );
    await client.mutualFriends('usr_target', 100);
    expect(await client.mutualGroups('usr_target', 200)).toMatchObject([{ id: 'grp_real' }]);
    expect(request).toHaveBeenNthCalledWith(
      1,
      '/users/usr_target/mutuals/friends?n=100&offset=100',
    );
    expect(request).toHaveBeenNthCalledWith(2, '/users/usr_target/mutuals/groups?n=100&offset=200');
  });
});

describe('safe user JSON viewing, copy and export payload', () => {
  it('removes unknown top-level fields and nested authorization while preserving real author and age metadata', () => {
    const user = {
      id: 'usr_test',
      displayName: 'Test',
      ageVerificationStatus: 'verified',
      auth: 'hidden-cookie',
      token: 'hidden-token',
      email: 'not-exported@example.com',
    } as User;
    const result = safeProfileJson(user, {
      id: user.id,
      bio: 'Biography',
      badges: [
        { badgeName: 'Real badge', authToken: 'hidden-nested', token: 'hidden-nested-token' },
      ],
      publicWorlds: [{ id: 'wrld_test', authorId: 'usr_author', authorName: 'Real author' }],
      secret: 'hidden-secret',
    });
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/hidden-|not-exported/);
    expect(result).toMatchObject({
      user: { id: user.id, ageVerificationStatus: 'verified' },
      publicProfile: {
        bio: 'Biography',
        publicWorlds: [{ authorId: 'usr_author', authorName: 'Real author' }],
      },
    });
  });

  it('scrubs credentials and sensitive query parameters from exported nested image URLs', () => {
    const output = redactProfileSecrets({
      imageUrl: 'https://login:password@api.vrchat.cloud/image?token=secret&v=3&authToken=hidden',
      nested: {
        Cookie: 'hidden',
        authorization: 'hidden',
        password: 'hidden',
        displayName: 'Visible',
      },
    });
    expect(output).toEqual({
      imageUrl: 'https://api.vrchat.cloud/image?v=3',
      nested: { displayName: 'Visible' },
    });
  });
});
