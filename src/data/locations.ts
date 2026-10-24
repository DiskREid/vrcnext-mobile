import type { User } from '../api';

export interface FriendLocation {
  key: string;
  location?: string;
  worldId?: string;
  friends: User[];
  private: boolean;
}

/** Only complete, disclosed instance locations prove that two friends share an instance. */
export function accessibleLocation(value?: string): value is string {
  return !!value && /^wrld_[a-zA-Z0-9-]+:[a-zA-Z0-9~_().+\-]+$/.test(value);
}

export function groupFriendLocations(friends: User[]): FriendLocation[] {
  const groups = new Map<string, FriendLocation>();
  for (const friend of friends) {
    const location = friend.location;
    const accessible = accessibleLocation(location);
    if (!accessible && location !== 'private') continue;
    // A hidden location is not a shared instance ID. Never infer a relationship from it.
    const key = accessible ? location : `hidden:${friend.id}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        location: accessible ? location : undefined,
        worldId: accessible ? location.split(':')[0] : undefined,
        friends: [],
        private: !accessible,
      };
      groups.set(key, group);
    }
    if (!group.friends.some((u) => u.id === friend.id)) group.friends.push(friend);
  }
  return [...groups.values()];
}

export function instanceType(
  location?: string,
  serverType?: string,
  groupAccessType?: string,
): string {
  if (serverType) {
    const names: Record<string, string> = {
      public: 'Public',
      friends: 'Friends',
      hidden: 'Friends+',
      private: 'Invite',
      group: 'Group',
    };
    const label = names[serverType] || serverType;
    return serverType === 'group' && groupAccessType ? `${label} · ${groupAccessType}` : label;
  }
  if (!location) return 'Скрытый инстанс';
  if (/~group\(/.test(location)) {
    const access = /~groupAccessType\(([^)]+)\)/.exec(location)?.[1];
    return access ? `Group · ${access}` : 'Group';
  }
  if (/~private\(/.test(location)) return /~canRequestInvite/.test(location) ? 'Invite+' : 'Invite';
  if (/~hidden\(/.test(location)) return 'Friends+';
  if (/~friends\(/.test(location)) return 'Friends';
  return 'Public';
}

export function presenceLabel(user: User): string {
  if (accessibleLocation(user.location)) return 'В VRChat';
  if (user.location === 'private') return 'В приватном мире';
  if (user.state === 'active' || user.state === 'online') return 'На сайте / в приложении';
  return 'Не в сети';
}
