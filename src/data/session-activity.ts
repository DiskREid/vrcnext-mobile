import type { PipelineEvent, User } from '../api';
import type { Activity } from '../state';
import { accessibleLocation } from './locations';

/** Retain real navigation targets when recording a transient pipeline activity. */
export function pipelineActivity(event: PipelineEvent, friends: User[], self: User): Omit<Activity, 'id' | 'time'> | undefined {
  const labels: Record<string, string> = {
    'friend-online': 'Друг в VRChat',
    'friend-offline': 'Друг вышел',
    'friend-active': 'Друг на сайте',
    'friend-location': 'Местоположение друга обновлено',
    'friend-update': 'Профиль друга обновлён',
    notification: 'Новое уведомление',
  };
  let title = labels[event.type];
  if (!title) return undefined;
  if (event.type === 'notification') return { title, detail: '' };
  const partial = event.content.user && typeof event.content.user === 'object' ? event.content.user as Partial<User> : undefined;
  const rawId = event.content.userId ?? event.content.userid ?? partial?.id;
  const userId = typeof rawId === 'string' && /^usr_[a-zA-Z0-9-]+$/.test(rawId) ? rawId : undefined;
  if (!userId) return { title, detail: 'VRChat не передал пользователя события.' };
  const known = self.id === userId ? self : friends.find((friend) => friend.id === userId);
  const displayName = typeof partial?.displayName === 'string' ? partial.displayName : known?.displayName || userId;
  const result: Omit<Activity, 'id' | 'time'> = { title, detail: displayName, userId, displayName };
  if (event.type === 'friend-location' && typeof event.content.location === 'string') {
    const location = event.content.location;
    const beforeLocation = known?.location;
    result.location = location;
    if (typeof beforeLocation === 'string') result.beforeLocation = beforeLocation;
    if (accessibleLocation(location)) {
      result.worldId = location.split(':')[0];
      if (accessibleLocation(beforeLocation)) {
        title = beforeLocation.split(':')[0] === result.worldId ? 'Друг сменил инстанс' : 'Друг сменил мир';
        result.title = title;
      }
    }
  }
  return result;
}
