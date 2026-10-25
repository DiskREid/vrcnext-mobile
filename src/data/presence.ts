import type { User } from '../api/types';
import { disclosedUserLocation } from './locations';

export type PresenceMode = 'game' | 'website' | 'offline' | 'unknown';
/** Apply only fields changed after opening a profile; an older friend cache cannot overwrite a fresh REST response. */
export function overlayLiveUser(profile: User, baseline: User | undefined, current: User | undefined): User {
  if (!baseline || !current || baseline.id !== profile.id || current.id !== profile.id || current === baseline) return profile;
  const result = { ...profile };
  for (const key of ['state', 'status', 'statusDescription', 'location', 'worldId', 'instanceId', 'userIcon', 'profilePicOverride', 'profilePicOverrideThumbnail', 'currentAvatarImageUrl', 'currentAvatarThumbnailImageUrl'] as const)
    if (baseline[key] !== current[key]) result[key] = current[key];
  return result;
}
export function presenceMode(user: Pick<User, 'state' | 'status' | 'location' | 'worldId' | 'instanceId'>): PresenceMode {
  // /auth/user.state is always offline, including when a disclosed game location exists.
  if (disclosedUserLocation(user) || user.location === 'private' || user.location === 'traveling') return 'game';
  if (user.state === 'active') return 'website';
  if (user.state === 'online') return 'game';
  if (user.state === 'offline' || user.location === 'offline' || user.status === 'offline') return 'offline';
  return 'unknown';
}
export function presenceIndicator(user: Pick<User, 'state' | 'status' | 'location' | 'worldId' | 'instanceId'>) {
  const mode = presenceMode(user);
  const color = mode === 'offline' || mode === 'unknown' ? 'offline'
    : ({ 'join me': 'join', 'ask me': 'ask', busy: 'busy' } as Record<string, string>)[user.status || ''] || 'active';
  const label = mode === 'website' ? 'На сайте / в приложении' : mode === 'offline' ? 'Не в сети' : mode === 'unknown' ? 'Присутствие неизвестно'
    : ({ 'join me': 'В VRChat · Заходите', 'ask me': 'В VRChat · Спросите меня', busy: 'В VRChat · Не беспокоить' } as Record<string, string>)[user.status || ''] || 'В VRChat';
  return { mode, color, label };
}
