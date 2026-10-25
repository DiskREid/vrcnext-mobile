import type { User } from '../api';
import { accessibleLocation, disclosedUserLocation } from './locations';

type Details = Record<string, unknown>;
const userId = (value: unknown): value is string => typeof value === 'string' && /^usr_[a-zA-Z0-9-]+$/.test(value);
const groupId = (value: unknown): value is string => typeof value === 'string' && /^grp_[a-zA-Z0-9-]+$/.test(value);

/** Group ownership is not evidence that the group's owner created this instance. */
export function instanceCreator(location: string, details: Details = {}): string | undefined {
  for (const field of ['creatorId', 'private', 'friends', 'hidden', 'ownerId'])
    if (userId(details[field])) return details[field] as string;
  if (!accessibleLocation(location)) return;
  const disclosed = /~(?:hidden|friends|private)\((usr_[a-zA-Z0-9-]+)\)(?:~|$)/.exec(location)?.[1];
  return userId(disclosed) ? disclosed : undefined;
}

export function instanceGroup(location: string, details: Details = {}): string | undefined {
  if (groupId(details.ownerId)) return details.ownerId;
  if (!accessibleLocation(location)) return;
  const disclosed = /~group\((grp_[a-zA-Z0-9-]+)\)(?:~|$)/.exec(location)?.[1];
  return groupId(disclosed) ? disclosed : undefined;
}

export function instanceCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Exact locations or an actual instance roster prove presence; hidden values never group people. */
export function friendsInInstance(location: string, friends: User[], viewed?: User, details: Details = {}): User[] {
  if (!accessibleLocation(location)) return [];
  const known = new Map(friends.map((friend) => [friend.id, friend]));
  if (viewed) {
    if (viewed.isFriend === false) known.delete(viewed.id);
    else if (viewed.isFriend === true || known.has(viewed.id)) known.set(viewed.id, { ...known.get(viewed.id), ...viewed });
  }
  const roster = new Set<string>();
  if (Array.isArray(details.users)) for (const value of details.users) {
    if (!value || typeof value !== 'object') continue;
    const person = value as Record<string, unknown>;
    if (!userId(person.id)) continue;
    if (person.id === viewed?.id && viewed.isFriend === false) continue;
    roster.add(person.id);
    if (!known.has(person.id) && person.isFriend === true && typeof person.displayName === 'string')
      known.set(person.id, person as unknown as User);
  }
  return [...known.values()].filter((friend) => disclosedUserLocation(friend) === location || roster.has(friend.id));
}
