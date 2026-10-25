import type { User } from './types';
import { disclosedUserLocation } from '../data/locations';

/** LimitedUserFriend omits state; offline=false includes both game and website users. */
export function normalizeFriendPresence(user: User, offline: boolean): User {
  if (offline) {
    const next = { ...user, state: 'offline', location: 'offline' };
    delete next.worldId;
    delete next.instanceId;
    return next;
  }
  const inGame = disclosedUserLocation(user) || user.location === 'private' || user.location === 'traveling';
  const next = { ...user, state: inGame ? 'online' : 'active' };
  if (!inGame) {
    // No game location was disclosed by this snapshot. Never reuse an old instance.
    delete next.worldId;
    delete next.instanceId;
  }
  return next;
}
