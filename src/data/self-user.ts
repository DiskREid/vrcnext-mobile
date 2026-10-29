import type { PipelineEvent, User } from '../api';
import { disclosedUserLocation } from './locations';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Only use this for the signed-in account: /auth/user.state is not game presence. */
export function normalizeSelfUser(user: User): User {
  const location = typeof user.currentLocation === 'string' ? user.currentLocation : user.location;
  if (location === undefined) return user;
  const result = { ...user, location, currentLocation: location };
  // An explicit privacy/offline value must also erase stale instance components.
  delete result.worldId;
  delete result.instanceId;
  const disclosed = disclosedUserLocation({ location });
  if (disclosed) {
    const separator = disclosed.indexOf(':');
    result.worldId = disclosed.slice(0, separator);
    result.instanceId = disclosed.slice(separator + 1);
    result.state = 'online';
  } else if (location === 'private' || location === 'traveling') result.state = 'online';
  else if (location === 'offline') result.state = 'offline';
  return result;
}

/** An older in-flight REST response must not roll back a newer pipeline location. */
export function sameSelfPresence(before: User | null, after: User | null): boolean {
  return (
    !!before &&
    !!after &&
    before.id === after.id &&
    (['location', 'currentLocation', 'worldId', 'instanceId', 'state'] as const).every(
      (key) => before[key] === after[key],
    )
  );
}

const stringFields = [
  'displayName',
  'username',
  'status',
  'statusDescription',
  'bio',
  'pronouns',
  'location',
  'currentLocation',
  'worldId',
  'instanceId',
  'state',
  'last_login',
  'last_activity',
  'userIcon',
  'iconUrl',
  'profilePicOverride',
  'profilePicOverrideThumbnail',
  'currentAvatarImageUrl',
  'currentAvatarThumbnailImageUrl',
  'currentAvatar',
  'currentAvatarName',
  'currentAvatarAuthorName',
  'profileBannerUrl',
  'friendKey',
  'note',
  'homeLocation',
  'ageVerificationStatus',
  'date_joined',
  'friendRequestStatus',
  'avatarImage',
] as const;
const arrayFields = [
  'bioLinks',
  'languages',
  'tags',
  'currentAvatarTags',
  'onlineFriends',
  'offlineFriends',
  'activeFriends',
  'friends',
] as const;

export interface SelfUserUpdate {
  user: User;
  /** Received fields plus canonical location fields derived from this same event. */
  patch: Partial<User>;
  /** Fresh location evidence, including a repeated location used as a real sample. */
  locationChanged: boolean;
}

/** Own pipeline messages differ from friend-location: user-location may omit userId. */
export function selfUserUpdate(event: PipelineEvent, self: User): SelfUserUpdate | undefined {
  if (event.type !== 'user-location' && event.type !== 'user-update') return;
  const content = object(event.content),
    nested = object(content.user);
  const identities = [content.userId, content.userid, content.id, nested.id].filter(
    (value): value is string => typeof value === 'string' && !!value,
  );
  if (identities.some((id) => id !== self.id)) return;
  const incoming = { ...content, ...nested };
  const patch: Partial<User> = {};
  for (const key of stringFields) if (typeof incoming[key] === 'string') patch[key] = incoming[key];
  for (const key of arrayFields)
    if (Array.isArray(incoming[key]))
      patch[key] = incoming[key].filter(
        (item: unknown): item is string => typeof item === 'string',
      );
  if (typeof incoming.isFriend === 'boolean') patch.isFriend = incoming.isFriend;
  // Root location is the protocol's own location field. Never let an inherited
  // currentLocation or a nested stale profile field overwrite that newer event.
  if (typeof content.location === 'string') patch.location = content.location;
  const location =
    typeof content.location === 'string'
      ? content.location
      : typeof patch.currentLocation === 'string'
        ? patch.currentLocation
        : typeof patch.location === 'string'
          ? patch.location
          : disclosedUserLocation(patch);
  const locationChanged = location !== undefined;
  if (locationChanged) {
    patch.location = location;
    patch.currentLocation = location;
    const normalized = normalizeSelfUser({ id: self.id, displayName: self.displayName, ...patch });
    patch.worldId = normalized.worldId;
    patch.instanceId = normalized.instanceId;
    if (normalized.state !== undefined) patch.state = normalized.state;
  }
  if (!Object.keys(patch).length) return;
  return {
    user: { ...self, ...patch, id: self.id, displayName: patch.displayName || self.displayName },
    patch,
    locationChanged,
  };
}
