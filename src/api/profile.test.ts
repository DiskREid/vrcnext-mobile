import { describe, expect, it } from 'vitest';
import { mergePublicProfile, readPublicProfile } from './profile';
import type { User } from './types';

const user: User = {
  id: 'usr_friend',
  displayName: 'Friend',
  location: 'wrld_current:1',
  status: 'busy',
  isFriend: true,
};

describe('split public profile response', () => {
  it('reads the real biography, links and avatar from the profile endpoint', () => {
    const profile = readPublicProfile(
      {
        id: user.id,
        bio: 'Настоящая биография\nSecond line',
        bioLinks: ['https://example.com/profile'],
        languages: ['rus'],
        currentAvatarThumbnailImageUrl: 'https://api.vrchat.cloud/api/1/image/file_photo/1/256',
        bannerUrl: 'https://api.vrchat.cloud/api/1/image/file_banner/1/1024',
      },
      user.id,
    );
    expect(mergePublicProfile(user, profile)).toMatchObject({
      bio: 'Настоящая биография\nSecond line',
      bioLinks: ['https://example.com/profile'],
      languages: ['rus'],
      profileBannerUrl: profile.bannerUrl,
      currentAvatarThumbnailImageUrl: profile.currentAvatarThumbnailImageUrl,
    });
    expect(user).not.toHaveProperty('bio');
  });

  it('preserves a genuinely empty biography instead of retaining an older value', () => {
    expect(mergePublicProfile({ ...user, bio: 'Old biography' }, { bio: '' }).bio).toBe('');
    expect(mergePublicProfile(user, {}).bio).toBeUndefined();
  });

  it('does not overwrite user identity, relationship, live state or arbitrary fields', () => {
    const result = mergePublicProfile(user, {
      id: 'usr_other',
      displayName: 'Wrong',
      location: 'private',
      status: 'offline',
      isFriend: false,
      authToken: 'must-not-merge',
      bio: 'Public biography',
    });
    expect(result).toMatchObject({ ...user, bio: 'Public biography' });
    expect(result).not.toHaveProperty('authToken');
  });

  it('rejects mismatched profile identifiers and malformed payloads', () => {
    expect(() => readPublicProfile({ id: 'usr_other', bio: 'Wrong' }, user.id)).toThrow(
      'другого пользователя',
    );
    for (const value of [null, [], 'not a profile'])
      expect(() => readPublicProfile(value, user.id)).toThrow('некорректный');
  });

  it('ignores invalid fields while allowing legacy user bio as a fallback', () => {
    const result = mergePublicProfile(
      { ...user, bio: 'Legacy biography' },
      { bio: null, bioLinks: ['https://example.com', 3, null], languages: 'rus' },
    );
    expect(result.bio).toBe('Legacy biography');
    expect(result.bioLinks).toEqual(['https://example.com']);
    expect(result.languages).toBeUndefined();
  });
});
