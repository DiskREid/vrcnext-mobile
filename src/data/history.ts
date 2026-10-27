import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AvatarMetadata, PipelineEvent, User } from '../api';
import { IndexedHistoryStore, MemoryHistoryStore } from './history-storage';
import type { HistoryStore } from './history-storage';
import { closeInterrupted, friendStatistics, GameObserver } from './game-history';
import type { GameData, GameSession, GameVisit, ObservationSource } from './game-history';
import { presenceMode } from './presence';
import { observedTrustRank } from './trust-rank';
import { fileIdOfAvatarImage } from './avatar-history-resolver';

export type HistoryKind = 'online' | 'offline' | 'world' | 'instance' | 'status' | 'avatar' | 'bio'
  | 'friend-add' | 'friend-remove' | 'name' | 'trust' | 'profile' | 'moderation';
export interface HistoryEvent {
  id: string;
  time: string;
  kind: HistoryKind;
  userId: string;
  displayName: string;
  detail: string;
  before?: string;
  after?: string;
  location?: string;
  worldId?: string;
  source: 'pipeline' | 'profile' | 'refresh' | 'sync' | 'action';
  avatarUrl?: string;
  avatarId?: string;
  avatarName?: string;
  avatarAuthorName?: string;
  avatarFileId?: string;
  previousAvatarUrl?: string;
  previousAvatarId?: string;
  previousAvatarName?: string;
  previousAvatarAuthorName?: string;
  previousAvatarFileId?: string;
  avatarEvidence?: 'id' | 'image' | 'file' | 'candidate';
}
export const historyLabels: Record<HistoryKind, string> = {
  online: 'Зашёл в VRChat', offline: 'Вышел из VRChat', world: 'Местоположение', instance: 'Сменил инстанс',
  status: 'Изменил статус', avatar: 'Сменил аватар', bio: 'Изменил Bio', 'friend-add': 'Добавлен в друзья',
  'friend-remove': 'Удалён из друзей', name: 'Изменил имя', trust: 'Изменил Trust Rank',
  profile: 'Обновил профиль', moderation: 'Модерация',
};
type Snapshot = Partial<Pick<User, 'id'|'displayName'|'status'|'statusDescription'|'location'|'currentAvatar'|'currentAvatarName'|'currentAvatarAuthorName'|'currentAvatarImageUrl'|'currentAvatarThumbnailImageUrl'|'iconUrl'|'bio'|'pronouns'|'bioLinks'|'languages'|'tags'>>;
type AvatarImage = { url: string; identity: string; fileId?: string; icon: boolean };
type AvatarSnapshot = { id?: string; image?: AvatarImage; name?: string; authorName?: string; awaitingIdentity?: boolean };
type PendingAvatar = { event: HistoryEvent; beforeImage?: AvatarImage; afterImage?: AvatarImage; images: Set<string>; emitted?: HistoryEvent; requireBeforeProof?: boolean; beforeVerified?: boolean; afterVerified?: boolean };
const imageHosts = new Set(['api.vrchat.cloud','api.vrchat.com','files.vrchat.cloud','file-variants.vrchat.com','assets.vrchat.com','vrchat.com','cloud.vrchat.com']);
/** A file identifies an avatar image across full/thumbnail fields, versions and CDNs. */
function avatarImage(value: unknown, icon = false): AvatarImage | undefined {
  if (typeof value !== 'string' || !value || value.length > 4096) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !imageHosts.has(url.hostname)) return;
    url.search = ''; url.hash = '';
    const file = url.pathname.match(/(?:^|\/)(file_[A-Za-z0-9_-]+)(?=\/|\.|$)/);
    // VRChat's hidden/loading images do not identify the equipped avatar.
    // Keep the last real image baseline so A → placeholder → A is silent.
    if (file && !fileIdOfAvatarImage(url.href)) return;
    const fileId = fileIdOfAvatarImage(url.href);
    return { url:url.href, identity:fileId || `${url.hostname.replace('api.vrchat.com','api.vrchat.cloud')}${url.pathname}`, ...(fileId ? {fileId} : {}), icon };
  } catch { return; }
}
function avatarSnapshot(user: Snapshot): AvatarSnapshot {
  return {
    id: typeof user.currentAvatar === 'string' && /^avtr_[A-Za-z0-9_-]+$/.test(user.currentAvatar) ? user.currentAvatar : undefined,
    image:avatarImage(user.currentAvatarImageUrl) || avatarImage(user.currentAvatarThumbnailImageUrl) || avatarImage(user.iconUrl,true),
    name:user.currentAvatarName?.trim().slice(0,256) || undefined,
    authorName:user.currentAvatarAuthorName?.trim().slice(0,256) || undefined,
  };
}
function snapshot(user: Partial<User>): Snapshot {
  const result: Snapshot = {};
  // Never persist arbitrary server objects, credentials, cookies, or auth fields.
  for (const key of ['id','displayName','status','statusDescription','location','currentAvatar','currentAvatarName','currentAvatarAuthorName','bio','pronouns'] as const)
    if (typeof user[key] === 'string') result[key] = user[key].slice(0, key === 'bio' ? 8192 : 2048);
  for (const key of ['currentAvatarImageUrl','currentAvatarThumbnailImageUrl','iconUrl'] as const) {
    const image = avatarImage(user[key],key==='iconUrl');
    if (image) result[key] = image.url;
  }
  for (const key of ['bioLinks','languages','tags'] as const)
    if (Array.isArray(user[key])) result[key] = user[key].filter((v):v is string => typeof v === 'string').slice(0,100).map((s)=>s.slice(0,2048));
  return result;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function displayLocation(value: string) {
  return value === 'private' ? 'Приватный инстанс' : value === 'offline' ? 'Не в сети' : value || 'Местоположение скрыто';
}

/** Pure observation reducer. Unknown values establish a baseline, never a fabricated change. */
export class HistoryObserver {
  private known = new Map<string, Snapshot>();
  private presence = new Map<string, 'online'|'offline'|'website'>();
  private membership = new Map<string, boolean>();
  private avatars = new Map<string, AvatarSnapshot>();
  // Friend-list tags are currently always empty, while /profile returns only
  // trustTags. Their different tag sets are not proof of a rank transition.
  private trustRanks = new Map<string, string>();
  // Bind both sides to immutable event/file IDs, so a later swap cannot steal
  // an earlier event's correctly resolved metadata.
  private pendingAvatars = new Map<string, PendingAvatar>();
  private latestAvatar = new Map<string, string>();
  private fileMetadata = new Map<string, AvatarMetadata>();
  constructor(private readonly now: () => string = () => new Date().toISOString(), private readonly id: () => string = () => crypto.randomUUID()) {}
  pause() { this.known.clear(); this.presence.clear(); this.membership.clear(); this.avatars.clear(); this.trustRanks.clear(); this.pendingAvatars.clear(); this.latestAvatar.clear(); this.fileMetadata.clear(); }
  seedUsers(users: User[]) {
    for (const user of users) {
      const prior = this.known.get(user.id) || {};
      this.known.set(user.id, { ...snapshot(user), ...prior });
      const fresh = avatarSnapshot(this.known.get(user.id)!);
      const previous = this.avatars.get(user.id);
      // A status-only message may already have created an empty avatar entry.
      // Fill missing baseline fields, while keeping any newer observed image.
      this.avatars.set(user.id,previous ? {...fresh,...previous,image:previous.image || fresh.image,
        id:previous.id || (!previous.awaitingIdentity ? fresh.id : undefined),
        name:previous.name || (!previous.awaitingIdentity ? fresh.name : undefined),
        authorName:previous.authorName || (!previous.awaitingIdentity ? fresh.authorName : undefined)} : fresh);
      const rank = observedTrustRank(user.tags);
      if (rank && !this.trustRanks.has(user.id)) this.trustRanks.set(user.id, rank);
    }
  }
  observeUsers(users: User[], source: HistoryEvent['source'] = 'refresh'): HistoryEvent[] {
    return users.flatMap((user) => this.observeProfile(user, source));
  }
  private event(kind: HistoryKind, userId: string, user: Snapshot, source: HistoryEvent['source'], detail: string, extra: Partial<HistoryEvent> = {}): HistoryEvent {
    return { id:this.id(), time:this.now(), kind,userId,displayName:user.displayName || userId,detail,source,...extra };
  }
  private rememberPending(pending: PendingAvatar) {
    this.pendingAvatars.set(pending.event.id,pending);
    this.latestAvatar.set(pending.event.userId,pending.event.id);
    while (this.pendingAvatars.size>1000) this.pendingAvatars.delete(this.pendingAvatars.keys().next().value!);
    while (this.latestAvatar.size>1000) this.latestAvatar.delete(this.latestAvatar.keys().next().value!);
  }
  private publishAvatar(pending: PendingAvatar): HistoryEvent[] {
    if (pending.event.avatarEvidence==='candidate') {
      if (!pending.afterVerified || pending.requireBeforeProof && !pending.beforeVerified) return [];
      const before=pending.event.previousAvatarId,after=pending.event.avatarId;
      pending.event={...pending.event,avatarEvidence:before && after && before!==after ? 'id' : before && before===after ? 'image' : 'file',detail:before && before===after ? 'Обновилось изображение аватара' : 'Сменил аватар'};
      if (before && after && before!==after) {pending.event.before=before;pending.event.after=after;}
    }
    if (pending.emitted && JSON.stringify(pending.emitted)===JSON.stringify(pending.event)) return [];
    pending.emitted=pending.event;
    return [pending.event];
  }
  observeProfile(user: User, source: HistoryEvent['source'] = 'profile'): HistoryEvent[] {
    const old=this.known.get(user.id),incoming=snapshot(user);
    const previousRank=this.trustRanks.get(user.id),freshRank=observedTrustRank(incoming.tags);
    if(freshRank)this.trustRanks.set(user.id,freshRank);
    const previous=this.avatars.get(user.id) || (old ? avatarSnapshot(old) : undefined);
    const fresh=avatarSnapshot(incoming);
    const pending=this.pendingAvatars.get(this.latestAvatar.get(user.id)||'');
    const freshImages=[avatarImage(incoming.currentAvatarImageUrl),avatarImage(incoming.currentAvatarThumbnailImageUrl),avatarImage(incoming.iconUrl,true)].filter((value):value is AvatarImage=>!!value);
    if(previous?.awaitingIdentity && (source==='refresh' || !freshImages.length))fresh.id=undefined;
    const matchesImage=!!pending?.afterImage && fresh.image?.identity===pending.afterImage.identity;
    const matchesId=!!pending?.event.avatarId && fresh.id===pending.event.avatarId;
    const hydrating=!!pending && source!=='refresh' && (matchesImage || matchesId)
      && (!pending.event.avatarId || !fresh.id || pending.event.avatarId===fresh.id);
    const idChanged=!!previous?.id && !!fresh.id && previous.id!==fresh.id && !hydrating;
    const imageChanged=!!previous?.image && !!fresh.image && previous.image.identity!==fresh.image.identity && !hydrating;
    // A raw icon is only a candidate: it may be a custom user picture. Keep the
    // last real baseline until an exact file lookup verifies the new avatar.
    const returnFromCandidate=!!fresh.image?.icon && !!previous?.image && fresh.image.identity===previous.image.identity
      && !!pending?.afterImage && pending.afterImage.identity!==fresh.image.identity && pending.event.avatarEvidence==='candidate';
    const candidate=(imageChanged || returnFromCandidate) && !!fresh.image?.icon && !idChanged;
    this.known.set(user.id,{...old,...incoming});
    if(!candidate) {
      this.avatars.set(user.id,{
        id:fresh.id || (!idChanged && !imageChanged ? previous?.id : undefined),
        image:fresh.image || (!idChanged && !imageChanged ? previous?.image : undefined),
        name:source!=='refresh' && fresh.name || (!idChanged && !imageChanged ? previous?.name : undefined),
        authorName:source!=='refresh' && fresh.authorName || (!idChanged && !imageChanged ? previous?.authorName : undefined),
        awaitingIdentity:imageChanged && !fresh.id || !!previous?.awaitingIdentity && !fresh.id,
      });
    }
    if(!old)return [];
    const next={...old,...incoming},events:HistoryEvent[]=[];
    const change=(kind:HistoryKind,before:string|undefined,after:string|undefined,detail:string)=>{
      if(before!==undefined && after!==undefined && before!==after)events.push(this.event(kind,user.id,next,source,detail,{before,after}));
    };
    change('name',old.displayName,incoming.displayName,`${old.displayName} → ${incoming.displayName}`);
    change('bio',old.bio,incoming.bio,'Биография обновлена');
    if(idChanged || imageChanged || returnFromCandidate) {
      const beforeImage=candidate && pending?.event.avatarEvidence==='candidate' && pending.afterImage ? pending.afterImage : previous?.image;
      const sameBaseline=beforeImage?.identity===previous?.image?.identity;
      const previousInfo=beforeImage?.fileId ? this.fileMetadata.get(beforeImage.fileId) : undefined;
      const previousId=previousInfo?.id || (sameBaseline ? previous?.id : undefined);
      const previousName=previousInfo?.name || (sameBaseline ? previous?.name : undefined);
      const previousAuthor=previousInfo?.authorName || (sameBaseline ? previous?.authorName : undefined);
      // An icon-only old image can also be a user's custom photo. Retain its
      // file ID privately for lookup, but do not present that photo as the old
      // avatar until exact metadata verifies it.
      const unverifiedBefore=!!beforeImage?.icon && !previousInfo?.name;
      const afterInfo=fresh.image?.fileId ? this.fileMetadata.get(fresh.image.fileId) : undefined;
      const afterName=source!=='refresh' ? fresh.name || afterInfo?.name : undefined;
      const afterId=fresh.id || afterInfo?.id;
      const event=this.event('avatar',user.id,next,source,idChanged?'Сменил аватар':candidate?'Ожидает определения аватара':'Обновилось изображение аватара',{
        before:unverifiedBefore?undefined:idChanged?previousId:beforeImage?.url,after:idChanged?fresh.id:fresh.image?.url,
        avatarEvidence:idChanged?'id':candidate?'candidate':'image',
        ...(beforeImage && !unverifiedBefore ? {previousAvatarUrl:beforeImage.url} : {}),
        ...(beforeImage?.fileId ? {previousAvatarFileId:beforeImage.fileId} : {}),
        ...(previousId && !unverifiedBefore ? {previousAvatarId:previousId} : {}),
        ...(previousName && !unverifiedBefore ? {previousAvatarName:previousName} : {}),
        ...(previousAuthor && !unverifiedBefore ? {previousAvatarAuthorName:previousAuthor} : {}),
        ...(fresh.image ? {avatarUrl:fresh.image.url} : {}),
        ...(fresh.image?.fileId ? {avatarFileId:fresh.image.fileId} : {}),
        ...(afterId ? {avatarId:afterId} : {}),
        ...(afterName ? {avatarName:afterName} : {}),
        ...((source!=='refresh' && fresh.authorName || afterInfo?.authorName) ? {avatarAuthorName:source!=='refresh' && fresh.authorName || afterInfo?.authorName} : {}),
      });
      const record:PendingAvatar={event,beforeImage,afterImage:fresh.image,
        images:new Set(freshImages.map(image=>image.identity)),
        requireBeforeProof:returnFromCandidate,
        beforeVerified:!unverifiedBefore,
        afterVerified:!!afterInfo?.name || !!fresh.id && !!afterName,
        ...(candidate?{}:{emitted:event}),
      };
      this.rememberPending(record);
      if(candidate) {
        if(source==='pipeline')events.push(...(record.afterVerified && (!record.requireBeforeProof || record.beforeVerified) ? this.publishAvatar(record) : [event]));
      } else events.push(event);
    } else if(hydrating && pending) {
      if(!pending.afterImage && fresh.image) {
        pending.afterImage=fresh.image;pending.images.add(fresh.image.identity);
        pending.event={...pending.event,avatarUrl:fresh.image.url,...(fresh.image.fileId?{avatarFileId:fresh.image.fileId}:{})};
      }
      if(fresh.id && !pending.event.avatarId)pending.event={...pending.event,avatarId:fresh.id};
      if(fresh.name && !pending.event.avatarName)pending.event={...pending.event,avatarName:fresh.name};
      if(fresh.authorName && !pending.event.avatarAuthorName)pending.event={...pending.event,avatarAuthorName:fresh.authorName};
      if(fresh.id && pending.event.previousAvatarId && pending.event.previousAvatarId!==fresh.id)pending.event={...pending.event,avatarEvidence:'id',before:pending.event.previousAvatarId,after:fresh.id,detail:'Сменил аватар'};
      if(fresh.name && (fresh.id || fresh.image && !fresh.image.icon))pending.afterVerified=true;
      events.push(...this.publishAvatar(pending));
    }
    const statusChanged=old.status!==undefined && incoming.status!==undefined && old.status!==incoming.status;
    const descriptionChanged=old.statusDescription!==undefined && incoming.statusDescription!==undefined && old.statusDescription!==incoming.statusDescription;
    if(statusChanged || descriptionChanged)events.push(this.event('status',user.id,next,source,[next.status,next.statusDescription].filter(Boolean).join(' · '),
      {before:[old.status,old.statusDescription].filter(Boolean).join(' · '),after:[next.status,next.statusDescription].filter(Boolean).join(' · ')}));
    change('trust',previousRank,freshRank,`Trust Rank: ${previousRank} → ${freshRank}`);
    const oldFields={pronouns:old.pronouns,bioLinks:old.bioLinks,languages:old.languages};
    const changedFields=(Object.keys(oldFields) as (keyof typeof oldFields)[]).filter(key=>oldFields[key]!==undefined && incoming[key]!==undefined && JSON.stringify(oldFields[key])!==JSON.stringify(incoming[key]));
    if(changedFields.length)events.push(this.event('profile',user.id,next,source,`Обновлены: ${changedFields.map(key=>({pronouns:'местоимения',bioLinks:'ссылки',languages:'языки'})[key]).join(', ')}`));
    return events;
  }
  /** Exact file metadata may name an avatar without exposing its avatar ID. */
  enrichAvatar(eventId:string,fileId:string,avatar:AvatarMetadata,side:'before'|'after'='after'):HistoryEvent[] {
    const pending=this.pendingAvatars.get(eventId);
    if(!pending || !avatar.name?.trim() || avatar.id!==undefined && !/^avtr_[A-Za-z0-9_-]{1,120}$/.test(avatar.id))return [];
    const event=pending.event;
    const expected=side==='before' ? event.previousAvatarFileId || fileIdOfAvatarImage(event.previousAvatarUrl) || fileIdOfAvatarImage(event.before)
      : event.avatarFileId || fileIdOfAvatarImage(event.avatarUrl) || fileIdOfAvatarImage(event.after);
    const expectedId=side==='before'?event.previousAvatarId:event.avatarId;
    if(event.source!=='pipeline' || expected!==fileId || expectedId && avatar.id && expectedId!==avatar.id)return [];
    const metadata:AvatarMetadata={name:avatar.name.trim().slice(0,256),...(avatar.id?{id:avatar.id}:{}),...(avatar.authorName?.trim()?{authorName:avatar.authorName.trim().slice(0,256)}:{})};
    this.fileMetadata.delete(fileId);this.fileMetadata.set(fileId,metadata);
    while(this.fileMetadata.size>500)this.fileMetadata.delete(this.fileMetadata.keys().next().value!);
    const enriched={...event};
    if(side==='before') {
      if(!enriched.previousAvatarUrl && pending.beforeImage)enriched.previousAvatarUrl=pending.beforeImage.url;
      if(enriched.before===undefined)enriched.before=metadata.id || pending.beforeImage?.url;
      if(!enriched.previousAvatarId && metadata.id)enriched.previousAvatarId=metadata.id;
      if(!enriched.previousAvatarName)enriched.previousAvatarName=metadata.name;
      if(!enriched.previousAvatarAuthorName && metadata.authorName)enriched.previousAvatarAuthorName=metadata.authorName;
      pending.beforeVerified=true;
    } else {
      if(!enriched.avatarId && metadata.id)enriched.avatarId=metadata.id;
      if(!enriched.avatarName)enriched.avatarName=metadata.name;
      if(!enriched.avatarAuthorName && metadata.authorName)enriched.avatarAuthorName=metadata.authorName;
      pending.afterVerified=true;
      if(enriched.avatarEvidence!=='candidate' && enriched.previousAvatarId && enriched.avatarId && enriched.previousAvatarId!==enriched.avatarId) {
        enriched.avatarEvidence='id';enriched.before=enriched.previousAvatarId;enriched.after=enriched.avatarId;enriched.detail='Сменил аватар';
      } else if(enriched.avatarEvidence==='image' && !enriched.previousAvatarId) {
        enriched.avatarEvidence='file';enriched.detail='Сменил аватар';
      }
      // Historical metadata is safe for that event, but must not replace the
      // current avatar's state after a newer event has arrived.
      if(this.latestAvatar.get(event.userId)===eventId) {
        const current=this.avatars.get(event.userId);
        this.avatars.set(event.userId,{...current,image:pending.afterImage || current?.image,
          id:metadata.id || (current?.image?.identity===pending.afterImage?.identity ? current?.id : undefined),
          name:metadata.name,authorName:metadata.authorName,awaitingIdentity:true});
      }
    }
    if(enriched.avatarEvidence!=='candidate' && enriched.previousAvatarId && enriched.avatarId && enriched.previousAvatarId!==enriched.avatarId) {
      enriched.avatarEvidence='id';enriched.before=enriched.previousAvatarId;enriched.after=enriched.avatarId;enriched.detail='Сменил аватар';
    }
    pending.event=enriched;
    return this.publishAvatar(pending);
  }
  observePipeline(event:PipelineEvent, friends:User[], self:User): HistoryEvent[] {
    if (!event.type.startsWith('friend-') && event.type !== 'user-update') return [];
    const content = object(event.content);
    const partial = object(content.user) as Partial<User>;
    const userId = typeof content.userId === 'string' ? content.userId : typeof content.userid === 'string' ? content.userid : typeof partial.id === 'string' ? partial.id : undefined;
    if (!userId || !userId.startsWith('usr_')) return [];
    const current = friends.find((user) => user.id === userId) || (self.id === userId ? self : undefined);
    // A connection/game-observation pause must not turn the first real update
    // into an empty baseline when its previous friend row is already available.
    if(current && (!this.known.has(userId) || !this.avatars.get(userId)?.image)) {
      const {id,displayName,currentAvatar,currentAvatarName,currentAvatarAuthorName,currentAvatarImageUrl,currentAvatarThumbnailImageUrl,iconUrl}=current;
      this.seedUsers([{id,displayName,currentAvatar,currentAvatarName,currentAvatarAuthorName,currentAvatarImageUrl,currentAvatarThumbnailImageUrl,iconUrl}]);
    }
    const known = this.known.get(userId) || {};
    const next:User = {...known,...snapshot(partial),id:userId,displayName:typeof partial.displayName === 'string' ? partial.displayName : known.displayName || current?.displayName || userId};
    const output:HistoryEvent[] = [];
    if (event.type === 'friend-add' || event.type === 'friend-delete') {
      const added = event.type === 'friend-add';
      if (this.membership.get(userId) !== added) output.push(this.event(added?'friend-add':'friend-remove',userId,next,'pipeline',added?'VRChat сообщил о добавлении в друзья':'VRChat сообщил об удалении из друзей'));
      this.membership.set(userId,added);
    }
    if (event.type === 'friend-online' || event.type === 'friend-offline') {
      const online = event.type === 'friend-online';
      const previous = this.presence.get(userId);
      // Leaving the website is not proof of leaving the game. A game exit needs a known game presence.
      const wasInGame = previous === 'online' || previous === undefined && current && presenceMode(current) === 'game';
      if (previous !== (online?'online':'offline') && (online || wasInGame)) output.push(this.event(online?'online':'offline',userId,next,'pipeline',online?'Получено событие входа в VRChat':'Получено событие выхода из VRChat'));
      this.presence.set(userId,online?'online':'offline');
    }
    // Website activity resets the game-presence baseline without inventing a game-login/exit.
    // Otherwise a later genuine friend-online would be suppressed as a duplicate forever.
    if (event.type === 'friend-active') {
      next.location = typeof content.location === 'string' ? content.location : typeof partial.location === 'string' ? partial.location : '';
      this.presence.set(userId, presenceMode({ ...next, state: 'active' }) === 'game' ? 'online' : 'website');
    }
    if (event.type === 'friend-location' && typeof content.location === 'string') {
      const location = content.location;
      if (known.location !== location) {
        const oldWorld = known.location?.split(':')[0];
        const newWorld = location.split(':')[0];
        const instance = !!oldWorld?.startsWith('wrld_') && oldWorld === newWorld && location.includes(':');
        output.push(this.event(instance?'instance':'world',userId,next,'pipeline',
          known.location === undefined ? `Местоположение стало доступно: ${displayLocation(location)}` : `${displayLocation(known.location)} → ${displayLocation(location)}`,
          {before:known.location,after:location,location,...(newWorld.startsWith('wrld_')?{worldId:newWorld}:{})}));
      }
      next.location = location;
    } else if (event.type === 'friend-offline') next.location = 'offline';
    else if (typeof content.location === 'string') next.location = content.location;
    // Only compare fields actually present in an update; absent data never erases a known value.
    // Do not present inherited avatar IDs/URLs as fresh API evidence. A public
    // friend update often has only its new image, with no avatar ID or Bio.
    output.push(...this.observeProfile({...snapshot(partial),id:userId,displayName:next.displayName,
      ...(typeof next.location === 'string' ? {location:next.location} : {})},'pipeline'));
    return output;
  }
  recordModeration(userId:string,displayName:string,action:string):HistoryEvent {
    return this.event('moderation',userId,{displayName},'action',action.slice(0,200));
  }
  recordFriendAction(userId:string,displayName:string,kind:'friend-add'|'friend-remove'):HistoryEvent[] {
    const added=kind==='friend-add';
    if(this.membership.get(userId)===added)return [];
    this.membership.set(userId,added);
    return [this.event(kind,userId,{displayName},'action',added?'Добавление подтверждено VRChat':'Удаление из друзей подтверждено VRChat')];
  }
}

function sortEvents(events: HistoryEvent[]) {
  return [...new Map(events.map((event) => [event.id,event])).values()].sort((a,b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id));
}
type JournalState = { events:HistoryEvent[]; visits:GameVisit[]; sessions:GameSession[]; loading:boolean; error:string };
function mergeGame<T extends {id:string;start:string}>(...parts:T[][]):T[] {
  return [...new Map(parts.flat().map((value)=>[value.id,value])).values()].sort((a,b)=>b.start.localeCompare(a.start)||b.id.localeCompare(a.id));
}
/** Serial durable writes; live samples received while opening the DB are merged, never overwritten. */
export class HistoryJournal {
  readonly observer = new HistoryObserver();
  state:JournalState = {events:[],visits:[],sessions:[],loading:true,error:''};
  private listeners = new Set<(state:JournalState)=>void>();
  private queue:HistoryEvent[] = [];
  private gameQueue:GameData[] = [];
  private writing = false;
  private gameWriting = false;
  private clearing = false;
  private generation = 0;
  private readError='';
  private writeError='';
  private gameReadError='';
  private gameWriteError='';
  constructor(readonly account:string,private store:HistoryStore,readonly game = new GameObserver()) {}
  subscribe(listener:(state:JournalState)=>void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(change:Partial<JournalState>) { this.state={...this.state,...change};for(const listener of this.listeners) listener(this.state); }
  private errors() {return [this.readError,this.writeError,this.gameReadError,this.gameWriteError].filter(Boolean).join(' ');}
  async load() {
    if(this.clearing)return;
    const current = ++this.generation;
    this.readError='';this.gameReadError='';this.publish({loading:true,error:this.errors()});
    const [events,game]=await Promise.allSettled([this.store.read(this.account),this.store.readGame(this.account)]);
    if(current!==this.generation)return;
    if(events.status==='fulfilled')this.publish({events:sortEvents([...events.value,...this.state.events])});
    else this.readError=events.reason instanceof Error?events.reason.message:'Не удалось загрузить историю.';
    if(game.status==='fulfilled') {
      // A previous process cannot still be observing. Keep rows, close at their last sample and save the repair.
      const knownVisits=new Set(this.state.visits.map((visit)=>visit.id)),knownSessions=new Set(this.state.sessions.map((session)=>session.id));
      const interrupted=closeInterrupted({visits:game.value.visits.filter((visit)=>!knownVisits.has(visit.id)),sessions:game.value.sessions.filter((session)=>!knownSessions.has(session.id))},this.game.activeVisit,this.game.activeSession);
      this.publish({visits:mergeGame(game.value.visits,interrupted.visits,this.state.visits),sessions:mergeGame(game.value.sessions,interrupted.sessions,this.state.sessions)});
      if(interrupted.visits.length||interrupted.sessions.length){this.gameQueue.push(interrupted);void this.flushGame();}
    } else this.gameReadError=game.reason instanceof Error?game.reason.message:'Не удалось загрузить журнал посещений.';
    this.publish({loading:false,error:this.errors()});
  }
  append(events:HistoryEvent[]) {
    // An icon can be a custom profile picture. Its private candidate reaches
    // the resolver but is never displayed or persisted as an avatar change.
    events=events.filter(event=>event.avatarEvidence!=='candidate');
    if(!events.length)return;
    this.queue.push(...events);
    this.publish({events:sortEvents([...this.state.events,...events])});
    void this.flush();
  }
  observeSession(self:User,friends:User[],source:ObservationSource) {this.updateGame(this.game.observe(self,friends,source));}
  pause() {this.observer.pause();this.updateGame(this.game.pause());}
  pauseSession() {this.updateGame(this.game.pause());}
  private updateGame(data:GameData) {
    if(!data.visits.length&&!data.sessions.length)return;
    this.gameQueue.push(data);
    this.publish({visits:mergeGame(this.state.visits,data.visits),sessions:mergeGame(this.state.sessions,data.sessions)});
    void this.flushGame();
  }
  async flush() {
    if(this.writing||this.clearing)return;
    this.writing=true;
    try {
      while(this.queue.length) {
        const pending=this.queue.slice();
        await this.store.append(this.account,pending);
        this.queue.splice(0,pending.length);
      }
      this.writeError='';this.publish({error:this.errors()});
    } catch(error) {this.writeError=error instanceof Error?error.message:'События пока не сохранены. Повторите попытку.';this.publish({error:this.errors()});}
    finally {this.writing=false;}
  }
  async flushGame() {
    if(this.gameWriting||this.clearing)return;
    this.gameWriting=true;
    try {
      while(this.gameQueue.length) {
        const count=this.gameQueue.length;
        const pending=this.gameQueue.slice();
        await this.store.saveGame(this.account,{visits:mergeGame(...pending.map((data)=>data.visits)),sessions:mergeGame(...pending.map((data)=>data.sessions))});
        // Do not remove samples appended while the transaction was in progress, even for the same visit ID.
        this.gameQueue.splice(0,count);
      }
      this.gameWriteError='';this.publish({error:this.errors()});
    }catch(error){this.gameWriteError=error instanceof Error?error.message:'Посещения пока не сохранены. Повторите попытку.';this.publish({error:this.errors()});}
    finally{this.gameWriting=false;}
  }
  async clear() {
    if(this.writing||this.gameWriting||this.clearing)throw new Error('Дождитесь сохранения последних событий.');
    const oldEvents=new Set(this.state.events.map((event)=>event.id));
    const oldVisits=new Set(this.state.visits.map((visit)=>visit.id));
    const oldSessions=new Set(this.state.sessions.map((session)=>session.id));
    const previousQueue=this.queue,previousGameQueue=this.gameQueue;
    this.clearing=true;this.generation++;this.queue=[];this.gameQueue=[];
    // Future samples belong to a new observation period, even while the deletion is pending.
    this.observer.pause();const interrupted=this.game.pause();
    try {
      await this.store.clear(this.account);
      this.readError='';this.writeError='';this.gameReadError='';this.gameWriteError='';
      this.publish({
        events:this.state.events.filter((event)=>!oldEvents.has(event.id)),
        visits:this.state.visits.filter((visit)=>!oldVisits.has(visit.id)),
        sessions:this.state.sessions.filter((session)=>!oldSessions.has(session.id)),
        loading:false,error:'',
      });
    } catch(error) {
      this.queue=[...previousQueue,...this.queue];this.gameQueue=[...previousGameQueue,...this.gameQueue];
      this.updateGame(interrupted);
      this.publish({loading:false});
      throw error;
    } finally {
      this.clearing=false;
      void this.flush();void this.flushGame();
    }
  }
}
const realStorage = new IndexedHistoryStore();
export function useHistory(account:string|undefined,demo:boolean) {
  const journal = useMemo(() => account ? new HistoryJournal(account,demo?new MemoryHistoryStore():realStorage) : undefined,[account,demo]);
  const [state,setState] = useState<JournalState>({events:[],visits:[],sessions:[],loading:false,error:''});
  useEffect(() => {
    if(!journal) {setState({events:[],visits:[],sessions:[],loading:false,error:''});return;}
    setState(journal.state);
    const unsubscribe=journal.subscribe(setState);
    void journal.load();
    return () => { unsubscribe(); journal.pause(); };
  },[journal]);
  const observePipeline=useCallback((event:PipelineEvent,friends:User[],self:User) => { const events=journal?.observer.observePipeline(event,friends,self)||[];journal?.append(events);return events; },[journal]);
  const enrichAvatar=useCallback((eventId:string,fileId:string,avatar:AvatarMetadata,side:'before'|'after'='after') => { if(journal)journal.append(journal.observer.enrichAvatar(eventId,fileId,avatar,side)); },[journal]);
  const observeProfile=useCallback((user:User,source:HistoryEvent['source']='profile') => { if(journal)journal.append(journal.observer.observeProfile(user,source)); },[journal]);
  const observeUsers=useCallback((users:User[],source:HistoryEvent['source']='refresh') => { if(journal)journal.append(journal.observer.observeUsers(users,source)); },[journal]);
  const seedUsers=useCallback((users:User[])=>journal?.observer.seedUsers(users),[journal]);
  const recordModeration=useCallback((id:string,name:string,action:string)=>{if(journal)journal.append([journal.observer.recordModeration(id,name,action)]);},[journal]);
  const recordFriendAction=useCallback((id:string,name:string,kind:'friend-add'|'friend-remove')=>{if(journal)journal.append(journal.observer.recordFriendAction(id,name,kind));},[journal]);
  const retry=useCallback(()=>{if(journal){void journal.load();void journal.flush();void journal.flushGame();}},[journal]);
  const clear=useCallback(async()=>{await journal?.clear();},[journal]);
  const pause=useCallback(()=>journal?.pause(),[journal]);
  const pauseSession=useCallback(()=>journal?.pauseSession(),[journal]);
  const observeSession=useCallback((self:User,friends:User[],source:ObservationSource)=>journal?.observeSession(self,friends,source),[journal]);
  const friendStats=useCallback((id:string)=>friendStatistics(journal?.state.visits||[],id),[journal,state.visits]);
  // A synchronous account render gate prevents a previous account's history flashing before effects.
  const visible = journal && state===journal.state ? state : journal?.state || {events:[],visits:[],sessions:[],loading:false,error:''};
  return {...visible,observePipeline,enrichAvatar,observeProfile,observeUsers,seedUsers,recordModeration,recordFriendAction,retry,clear,pause,pauseSession,observeSession,friendStats};
}
export type HistoryState = ReturnType<typeof useHistory>;
