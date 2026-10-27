import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Avatar, PipelineEvent, User } from '../api';
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
  avatarEvidence?: 'id' | 'image';
}
export const historyLabels: Record<HistoryKind, string> = {
  online: 'Зашёл в VRChat', offline: 'Вышел из VRChat', world: 'Местоположение', instance: 'Сменил инстанс',
  status: 'Изменил статус', avatar: 'Сменил аватар', bio: 'Изменил Bio', 'friend-add': 'Добавлен в друзья',
  'friend-remove': 'Удалён из друзей', name: 'Изменил имя', trust: 'Изменил Trust Rank',
  profile: 'Обновил профиль', moderation: 'Модерация',
};
type Snapshot = Partial<Pick<User, 'id'|'displayName'|'status'|'statusDescription'|'location'|'currentAvatar'|'currentAvatarName'|'currentAvatarAuthorName'|'currentAvatarImageUrl'|'currentAvatarThumbnailImageUrl'|'bio'|'pronouns'|'bioLinks'|'languages'|'tags'>>;
type AvatarImage = { url: string; identity: string };
type AvatarSnapshot = { id?: string; full?: AvatarImage; thumbnail?: AvatarImage; awaitingIdentity?: boolean };
type PendingAvatar = { event: HistoryEvent; beforeId?: string; images: Set<string> };
const imageHosts = new Set(['api.vrchat.cloud','api.vrchat.com','files.vrchat.cloud','file-variants.vrchat.com','assets.vrchat.com','vrchat.com','cloud.vrchat.com']);
/** Compare file/version, not auth queries, thumbnail resolution, or the chosen VRChat CDN. */
function avatarImage(value: unknown): AvatarImage | undefined {
  if (typeof value !== 'string' || !value || value.length > 4096) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !imageHosts.has(url.hostname)) return;
    url.search = ''; url.hash = '';
    const file = url.pathname.match(/\/(file_[A-Za-z0-9_-]+)\/(\d{1,9})(?:\/|$)/);
    // VRChat's hidden/loading images do not identify the equipped avatar.
    // Keep the last real image baseline so A → placeholder → A is silent.
    if (file && !fileIdOfAvatarImage(url.href)) return;
    return { url:url.href, identity:file ? `${file[1]}:${Number(file[2])}` : `${url.hostname.replace('api.vrchat.com','api.vrchat.cloud')}${url.pathname}` };
  } catch { return; }
}
function avatarSnapshot(user: Snapshot): AvatarSnapshot {
  return {
    id: typeof user.currentAvatar === 'string' && /^avtr_[A-Za-z0-9_-]+$/.test(user.currentAvatar) ? user.currentAvatar : undefined,
    full: avatarImage(user.currentAvatarImageUrl), thumbnail:avatarImage(user.currentAvatarThumbnailImageUrl),
  };
}
function snapshot(user: Partial<User>): Snapshot {
  const result: Snapshot = {};
  // Never persist arbitrary server objects, credentials, cookies, or auth fields.
  for (const key of ['id','displayName','status','statusDescription','location','currentAvatar','currentAvatarName','currentAvatarAuthorName','bio','pronouns'] as const)
    if (typeof user[key] === 'string') result[key] = user[key].slice(0, key === 'bio' ? 8192 : 2048);
  for (const key of ['currentAvatarImageUrl','currentAvatarThumbnailImageUrl'] as const) {
    const image = avatarImage(user[key]);
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
  // One recent event per user can await exact file or viewed-profile metadata. Older,
  // already superseded images must never receive a later avatar's name.
  private pendingAvatars = new Map<string, PendingAvatar>();
  constructor(private readonly now: () => string = () => new Date().toISOString(), private readonly id: () => string = () => crypto.randomUUID()) {}
  pause() { this.known.clear(); this.presence.clear(); this.membership.clear(); this.avatars.clear(); this.trustRanks.clear(); this.pendingAvatars.clear(); }
  seedUsers(users: User[]) {
    for (const user of users) {
      const prior = this.known.get(user.id) || {};
      this.known.set(user.id, { ...snapshot(user), ...prior });
      if (!this.avatars.has(user.id)) this.avatars.set(user.id, avatarSnapshot(this.known.get(user.id)!));
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
  observeProfile(user: User, source: HistoryEvent['source'] = 'profile'): HistoryEvent[] {
    const old = this.known.get(user.id);
    const incoming = snapshot(user);
    const previousRank = this.trustRanks.get(user.id);
    const freshRank = observedTrustRank(incoming.tags);
    if (freshRank) this.trustRanks.set(user.id, freshRank);
    const previousAvatar = this.avatars.get(user.id) || (old ? avatarSnapshot(old) : undefined);
    const freshAvatar = avatarSnapshot(incoming);
    const pendingAvatar = this.pendingAvatars.get(user.id);
    const freshImages = [freshAvatar.full, freshAvatar.thumbnail].filter((image): image is AvatarImage => !!image);
    const matchesPendingImage = !!pendingAvatar && freshImages.some(image => pendingAvatar.images.has(image.identity));
    // A refreshed friend row can still carry an older merged ID. Once the image
    // changes, resolve its identity only from a fresh profile or pipeline field.
    if (previousAvatar?.awaitingIdentity && source === 'refresh') freshAvatar.id = undefined;
    // An ID arriving without its image cannot resolve an earlier image-only
    // event: the user may already have switched again during that request.
    if (previousAvatar?.awaitingIdentity && !freshImages.length) freshAvatar.id = undefined;
    const idChanged = !!previousAvatar?.id && !!freshAvatar.id && previousAvatar.id !== freshAvatar.id;
    const fullChanged = !!previousAvatar?.full && !!freshAvatar.full && previousAvatar.full.identity !== freshAvatar.full.identity;
    const thumbnailChanged = !!previousAvatar?.thumbnail && !!freshAvatar.thumbnail && previousAvatar.thumbnail.identity !== freshAvatar.thumbnail.identity;
    const imageChanged = fullChanged || thumbnailChanged;
    this.avatars.set(user.id, {
      id:freshAvatar.id || (!idChanged && !imageChanged ? previousAvatar?.id : undefined),
      full:freshAvatar.full || (!idChanged && !imageChanged ? previousAvatar?.full : undefined),
      thumbnail:freshAvatar.thumbnail || (!idChanged && !imageChanged ? previousAvatar?.thumbnail : undefined),
      awaitingIdentity: imageChanged && !freshAvatar.id || !!previousAvatar?.awaitingIdentity && !freshAvatar.id,
    });
    this.known.set(user.id, {...old,...incoming});
    if (!old) return [];
    const events: HistoryEvent[] = [];
    const next = {...old,...incoming};
    const change = (kind:HistoryKind, before:string|undefined, after:string|undefined, detail:string) => {
      if (before !== undefined && after !== undefined && before !== after)
        events.push(this.event(kind,user.id,next,source,detail,{before,after}));
    };
    change('name',old.displayName,incoming.displayName,`${old.displayName} → ${incoming.displayName}`);
    change('bio',old.bio,incoming.bio,'Биография обновлена');
    if (idChanged || imageChanged) {
      const beforeImage = fullChanged ? previousAvatar?.full : previousAvatar?.thumbnail;
      const afterImage = fullChanged ? freshAvatar.full : freshAvatar.thumbnail;
      const name = incoming.currentAvatarName?.trim().slice(0,256);
      const author = incoming.currentAvatarAuthorName?.trim().slice(0,256);
      const preview = !idChanged && afterImage || freshAvatar.thumbnail || freshAvatar.full;
      const avatarEvent = this.event('avatar',user.id,next,source,
        idChanged ? 'Сменил аватар' : 'Обновилось изображение аватара', {
          before:idChanged ? previousAvatar?.id : beforeImage?.url,
          after:idChanged ? freshAvatar.id : afterImage?.url,
          avatarEvidence:idChanged ? 'id' : 'image',
          ...(freshAvatar.id ? {avatarId:freshAvatar.id} : {}),
          ...(preview ? {avatarUrl:preview.url} : {}),
          ...(name ? {avatarName:name} : {}), ...(author ? {avatarAuthorName:author} : {}),
        });
      events.push(avatarEvent);
      this.pendingAvatars.delete(user.id);
      this.pendingAvatars.set(user.id, {
        event: avatarEvent,
        beforeId: previousAvatar?.id,
        images: new Set(freshImages.map(image => image.identity)),
      });
      while (this.pendingAvatars.size > 1000) this.pendingAvatars.delete(this.pendingAvatars.keys().next().value!);
    } else if (pendingAvatar && source !== 'refresh' && (matchesPendingImage || !!freshAvatar.id && freshAvatar.id === pendingAvatar.event.avatarId)) {
      // Upsert the original row after its exact public-profile data arrives.
      // Only add absent metadata: a later rename must not rewrite an old name.
      const original = pendingAvatar.event;
      const enriched: HistoryEvent = { ...original };
      if (!enriched.avatarId && freshAvatar.id) enriched.avatarId = freshAvatar.id;
      if (!enriched.avatarName && incoming.currentAvatarName?.trim()) enriched.avatarName = incoming.currentAvatarName.trim().slice(0,256);
      if (!enriched.avatarAuthorName && incoming.currentAvatarAuthorName?.trim()) enriched.avatarAuthorName = incoming.currentAvatarAuthorName.trim().slice(0,256);
      if (!enriched.avatarUrl && freshImages.length) enriched.avatarUrl = (freshAvatar.thumbnail || freshAvatar.full)!.url;
      if (original.avatarEvidence === 'image' && pendingAvatar.beforeId && freshAvatar.id && pendingAvatar.beforeId !== freshAvatar.id) {
        enriched.avatarEvidence = 'id'; enriched.before = pendingAvatar.beforeId; enriched.after = freshAvatar.id;
        enriched.detail = 'Сменил аватар';
      }
      if ((Object.keys(enriched) as (keyof HistoryEvent)[]).some(key => enriched[key] !== original[key])) {
        pendingAvatar.event = enriched;
        events.push(enriched);
      }
    }
    const statusChanged = old.status !== undefined && incoming.status !== undefined && old.status !== incoming.status;
    const descriptionChanged = old.statusDescription !== undefined && incoming.statusDescription !== undefined && old.statusDescription !== incoming.statusDescription;
    if (statusChanged || descriptionChanged) events.push(this.event('status',user.id,next,source,
      [next.status,next.statusDescription].filter(Boolean).join(' · '),
      {before:[old.status,old.statusDescription].filter(Boolean).join(' · '),after:[next.status,next.statusDescription].filter(Boolean).join(' · ')}));
    change('trust',previousRank,freshRank,`Trust Rank: ${previousRank} → ${freshRank}`);
    const oldFields = {pronouns:old.pronouns,bioLinks:old.bioLinks,languages:old.languages};
    const changedFields = (Object.keys(oldFields) as (keyof typeof oldFields)[])
      .filter((key) => oldFields[key] !== undefined && incoming[key] !== undefined && JSON.stringify(oldFields[key]) !== JSON.stringify(incoming[key]));
    if (changedFields.length) events.push(this.event('profile',user.id,next,source,`Обновлены: ${changedFields.map((key) => ({pronouns:'местоимения',bioLinks:'ссылки',languages:'языки'})[key]).join(', ')}`));
    return events;
  }
  /** Enrich an existing WS event from its exact image-file lookup; never inspect a user's profile. */
  enrichAvatar(eventId: string, fileId: string, avatar: Avatar): HistoryEvent[] {
    const pending = [...this.pendingAvatars.values()].find(value => value.event.id === eventId);
    if (!pending || !/^avtr_[A-Za-z0-9_-]{1,120}$/.test(avatar.id)) return [];
    const original = pending.event;
    if (original.source !== 'pipeline' || original.kind !== 'avatar'
      || (fileIdOfAvatarImage(original.after) || fileIdOfAvatarImage(original.avatarUrl)) !== fileId
      || original.avatarId && original.avatarId !== avatar.id) return [];
    const enriched = { ...original, avatarId: avatar.id };
    if (!enriched.avatarName && avatar.name?.trim()) enriched.avatarName = avatar.name.trim().slice(0,256);
    if (!enriched.avatarAuthorName && avatar.authorName?.trim()) enriched.avatarAuthorName = avatar.authorName.trim().slice(0,256);
    if (original.avatarEvidence === 'image' && pending.beforeId && pending.beforeId !== avatar.id) {
      enriched.avatarEvidence = 'id'; enriched.before = pending.beforeId; enriched.after = avatar.id;
      enriched.detail = 'Сменил аватар';
    }
    if (!(Object.keys(enriched) as (keyof HistoryEvent)[]).some(key => enriched[key] !== original[key])) return [];
    pending.event = enriched;
    const current = this.avatars.get(original.userId);
    if (current && [current.full?.url,current.thumbnail?.url].some(url => fileIdOfAvatarImage(url) === fileId)) {
      // The lookup identifies the file's avatar. Still do not accept inherited
      // friend-list IDs as a fresh VRChat ID on a later row refresh.
      this.avatars.set(original.userId,{ ...current, id:avatar.id, awaitingIdentity:true });
    }
    return [enriched];
  }
  observePipeline(event:PipelineEvent, friends:User[], self:User): HistoryEvent[] {
    if (!event.type.startsWith('friend-') && event.type !== 'user-update') return [];
    const content = object(event.content);
    const partial = object(content.user) as Partial<User>;
    const userId = typeof content.userId === 'string' ? content.userId : typeof content.userid === 'string' ? content.userid : typeof partial.id === 'string' ? partial.id : undefined;
    if (!userId || !userId.startsWith('usr_')) return [];
    const known = this.known.get(userId) || {};
    const current = friends.find((user) => user.id === userId) || (self.id === userId ? self : undefined);
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
    if(!events.length)return;
    this.queue.push(...events);
    this.publish({events:sortEvents([...this.state.events,...events])});
    void this.flush();
  }
  observeSession(self:User,friends:User[],source:ObservationSource) {this.updateGame(this.game.observe(self,friends,source));}
  pause() {this.observer.pause();this.updateGame(this.game.pause());}
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
  const enrichAvatar=useCallback((eventId:string,fileId:string,avatar:Avatar) => { if(journal)journal.append(journal.observer.enrichAvatar(eventId,fileId,avatar)); },[journal]);
  const observeProfile=useCallback((user:User,source:HistoryEvent['source']='profile') => { if(journal)journal.append(journal.observer.observeProfile(user,source)); },[journal]);
  const observeUsers=useCallback((users:User[],source:HistoryEvent['source']='refresh') => { if(journal)journal.append(journal.observer.observeUsers(users,source)); },[journal]);
  const seedUsers=useCallback((users:User[])=>journal?.observer.seedUsers(users),[journal]);
  const recordModeration=useCallback((id:string,name:string,action:string)=>{if(journal)journal.append([journal.observer.recordModeration(id,name,action)]);},[journal]);
  const recordFriendAction=useCallback((id:string,name:string,kind:'friend-add'|'friend-remove')=>{if(journal)journal.append(journal.observer.recordFriendAction(id,name,kind));},[journal]);
  const retry=useCallback(()=>{if(journal){void journal.load();void journal.flush();void journal.flushGame();}},[journal]);
  const clear=useCallback(async()=>{await journal?.clear();},[journal]);
  const pause=useCallback(()=>journal?.pause(),[journal]);
  const observeSession=useCallback((self:User,friends:User[],source:ObservationSource)=>journal?.observeSession(self,friends,source),[journal]);
  const friendStats=useCallback((id:string)=>friendStatistics(journal?.state.visits||[],id),[journal,state.visits]);
  // A synchronous account render gate prevents a previous account's history flashing before effects.
  const visible = journal && state===journal.state ? state : journal?.state || {events:[],visits:[],sessions:[],loading:false,error:''};
  return {...visible,observePipeline,enrichAvatar,observeProfile,observeUsers,seedUsers,recordModeration,recordFriendAction,retry,clear,pause,observeSession,friendStats};
}
export type HistoryState = ReturnType<typeof useHistory>;
