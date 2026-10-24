import type { User } from './types';

/** Public profile fields moved out of /users/{id} in newer VRChat responses. */
export function readPublicProfile(value: unknown, expectedId: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('VRChat вернул некорректный публичный профиль.');
  const profile = value as Record<string, unknown>;
  if (profile.id !== undefined && profile.id !== expectedId)
    throw new Error('VRChat вернул публичный профиль другого пользователя. Повторите загрузку.');
  return profile;
}

/** Merge known public fields only; a profile must not overwrite live location or relationship. */
export function mergePublicProfile(user: User, profile?: Record<string, unknown>): User {
  if (!profile) return user;
  const result = { ...user };
  for (const key of [
    'bio',
    'pronouns',
    'userIcon',
    'iconUrl',
    'currentAvatar',
    'currentAvatarImageUrl',
    'currentAvatarThumbnailImageUrl',
    'ageVerificationStatus',
  ] as const) {
    if (typeof profile[key] === 'string') result[key] = profile[key];
  }
  for (const key of ['bioLinks', 'languages', 'currentAvatarTags'] as const) {
    if (Array.isArray(profile[key]))
      result[key] = profile[key].filter((item): item is string => typeof item === 'string');
  }
  const banner =
    typeof profile.bannerUrl === 'string'
      ? profile.bannerUrl
      : typeof profile.bannerCustomUrl === 'string'
        ? profile.bannerCustomUrl
        : undefined;
  if (banner !== undefined) result.profileBannerUrl = banner;
  if (!result.tags?.length && Array.isArray(profile.trustTags))
    result.tags = profile.trustTags.filter((item): item is string => typeof item === 'string');
  return result;
}
