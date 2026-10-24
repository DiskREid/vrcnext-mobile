import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PipelineEvent, User } from '../api';
import { IndexedHistoryStore, MemoryHistoryStore } from './history-storage';
import type { HistoryStore } from './history-storage';

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
  source: 'pipeline' | 'profile' | 'action';
  avatarUrl?: string;
}
export const historyLabels: Record<HistoryKind, string> = {
  online: 'Зашёл в VRChat', offline: 'Вышел из VRChat', world: 'Местоположение', instance: 'Сменил инстанс',
  status: 'Изменил статус', avatar: 'Сменил аватар', bio: 'Изменил Bio', 'friend-add': 'Добавлен в друзья',
  'friend-remove': 'Удалён из друзей', name: 'Изменил имя', trust: 'Изменил Trust Rank',
  profile: 'Обновил профиль', moderation: 'Модерация',
};
type Snapshot = Partial<Pick<User, 'id'|'displayName'|'status'|'statusDescription'|'location'|'currentAvatar'|'bio'|'pronouns'|'bioLinks'|'languages'|'tags'>>;
function snapshot(user: Partial<User>): Snapshot {
  const result: Snapshot = {};
  // Never persist arbitrary server objects, credentials, cookies, or auth fields.
  for (const key of ['id','displayName','status','statusDescription','location','currentAvatar','bio','pronouns'] as const)
    if (typeof user[key] === 'string') result[key] = user[key].slice(0, key === 'bio' ? 8192 : 2048);
  for (const key of ['bioLinks','languages','tags'] as const)
    if (Array.isArray(user[key])) result[key] = user[key].filter((v):v is string => typeof v === 'string').slice(0,100).map((s)=>s.slice(0,2048));
  return result;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function trust(tags: string[] | undefined) {
  return tags?.filter((tag) => /^system_(?:trust_|probable_troll|troll)/.test(tag)).sort().join(',');
}
function displayLocation(value: string) {
  return value === 'private' ? 'Приватный инстанс' : value === 'offline' ? 'Не в сети' : value || 'Местоположение скрыто';
}

/** Pure observation reducer. Unknown values establish a baseline, never a fabricated change. */
export class HistoryObserver {
  private known = new Map<string, Snapshot>();
  private presence = new Map<string, 'online'|'offline'>();
  private membership = new Map<string, boolean>();
  constructor(private readonly now: () => string = () => new Date().toISOString(), private readonly id: () => string = () => crypto.randomUUID()) {}
  pause() { this.known.clear(); this.presence.clear(); this.membership.clear(); }
  seedUsers(users: User[]) {
    for (const user of users) {
      const prior = this.known.get(user.id) || {};
      this.known.set(user.id, { ...snapshot(user), ...prior });
    }
  }
  private event(kind: HistoryKind, userId: string, user: Snapshot, source: HistoryEvent['source'], detail: string, extra: Partial<HistoryEvent> = {}): HistoryEvent {
    return { id:this.id(), time:this.now(), kind,userId,displayName:user.displayName || userId,detail,source,...extra };
  }
  observeProfile(user: User, source: HistoryEvent['source'] = 'profile'): HistoryEvent[] {
    const old = this.known.get(user.id);
    const incoming = snapshot(user);
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
    // An image may change without the avatar changing. Only a real avatar ID is evidence.
    if (old.currentAvatar?.startsWith('avtr_') && incoming.currentAvatar?.startsWith('avtr_'))
      change('avatar',old.currentAvatar,incoming.currentAvatar,`${old.currentAvatar} → ${incoming.currentAvatar}`);
    const statusChanged = old.status !== undefined && incoming.status !== undefined && old.status !== incoming.status;
    const descriptionChanged = old.statusDescription !== undefined && incoming.statusDescription !== undefined && old.statusDescription !== incoming.statusDescription;
    if (statusChanged || descriptionChanged) events.push(this.event('status',user.id,next,source,
      [next.status,next.statusDescription].filter(Boolean).join(' · '),
      {before:[old.status,old.statusDescription].filter(Boolean).join(' · '),after:[next.status,next.statusDescription].filter(Boolean).join(' · ')}));
    change('trust',trust(old.tags),trust(incoming.tags),'Изменились доступные Trust Rank теги');
    const oldFields = {pronouns:old.pronouns,bioLinks:old.bioLinks,languages:old.languages};
    const changedFields = (Object.keys(oldFields) as (keyof typeof oldFields)[])
      .filter((key) => oldFields[key] !== undefined && incoming[key] !== undefined && JSON.stringify(oldFields[key]) !== JSON.stringify(incoming[key]));
    if (changedFields.length) events.push(this.event('profile',user.id,next,source,`Обновлены: ${changedFields.map((key) => ({pronouns:'местоимения',bioLinks:'ссылки',languages:'языки'})[key]).join(', ')}`));
    return events;
  }
  observePipeline(event:PipelineEvent, friends:User[], self:User): HistoryEvent[] {
    if (!event.type.startsWith('friend-') && event.type !== 'user-update') return [];
    const content = event.content;
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
      if (this.presence.get(userId) !== (online?'online':'offline')) output.push(this.event(online?'online':'offline',userId,next,'pipeline',online?'Получено событие входа в VRChat':'Получено событие выхода из VRChat'));
      this.presence.set(userId,online?'online':'offline');
    }
    // friend-active is website/app presence. It deliberately creates no game-login event.
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
    output.push(...this.observeProfile(next,'pipeline'));
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
type JournalState = { events:HistoryEvent[];loading:boolean;error:string };
/** Serial durable writes; events received while opening the DB are merged, never overwritten. */
export class HistoryJournal {
  readonly observer = new HistoryObserver();
  state:JournalState = {events:[],loading:true,error:''};
  private listeners = new Set<(state:JournalState)=>void>();
  private queue:HistoryEvent[] = [];
  private writing = false;
  private generation = 0;
  private readError='';
  private writeError='';
  constructor(readonly account:string,private store:HistoryStore) {}
  subscribe(listener:(state:JournalState)=>void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(change:Partial<JournalState>) { this.state={...this.state,...change};for(const listener of this.listeners) listener(this.state); }
  async load() {
    const current = ++this.generation;
    this.readError='';this.publish({loading:true,error:this.writeError});
    try {
      const stored=await this.store.read(this.account);
      if (current===this.generation) this.publish({events:sortEvents([...stored,...this.state.events])});
    } catch(error) { if(current===this.generation){this.readError=error instanceof Error?error.message:'Не удалось загрузить историю.';this.publish({error:[this.readError,this.writeError].filter(Boolean).join(' ')});} }
    finally { if(current===this.generation)this.publish({loading:false}); }
  }
  append(events:HistoryEvent[]) {
    if(!events.length)return;
    this.queue.push(...events);
    this.publish({events:sortEvents([...events,...this.state.events])});
    void this.flush();
  }
  async flush() {
    if(this.writing)return;
    this.writing=true;
    try {
      while(this.queue.length) {
        const pending=this.queue.slice();
        await this.store.append(this.account,pending);
        this.queue.splice(0,pending.length);
      }
      this.writeError='';this.publish({error:this.readError});
    } catch(error) { this.writeError=error instanceof Error?error.message:'События пока не сохранены. Повторите попытку.';this.publish({error:[this.readError,this.writeError].filter(Boolean).join(' ')}); }
    finally {this.writing=false;}
  }
  async clear() {
    if(this.writing)throw new Error('Дождитесь сохранения последних событий.');
    await this.store.clear(this.account);
    this.generation++;this.queue=[];this.readError='';this.writeError='';this.observer.pause();this.publish({events:[],loading:false,error:''});
  }
}
const realStorage = new IndexedHistoryStore();
export function useHistory(account:string|undefined,demo:boolean) {
  const journal = useMemo(() => account ? new HistoryJournal(account,demo?new MemoryHistoryStore():realStorage) : undefined,[account,demo]);
  const [state,setState] = useState<JournalState>({events:[],loading:false,error:''});
  useEffect(() => {
    if(!journal) {setState({events:[],loading:false,error:''});return;}
    setState(journal.state);
    const unsubscribe=journal.subscribe(setState);
    void journal.load();
    return unsubscribe;
  },[journal]);
  const observePipeline=useCallback((event:PipelineEvent,friends:User[],self:User) => { if(journal)journal.append(journal.observer.observePipeline(event,friends,self)); },[journal]);
  const observeProfile=useCallback((user:User) => { if(journal)journal.append(journal.observer.observeProfile(user)); },[journal]);
  const seedUsers=useCallback((users:User[])=>journal?.observer.seedUsers(users),[journal]);
  const recordModeration=useCallback((id:string,name:string,action:string)=>{if(journal)journal.append([journal.observer.recordModeration(id,name,action)]);},[journal]);
  const recordFriendAction=useCallback((id:string,name:string,kind:'friend-add'|'friend-remove')=>{if(journal)journal.append(journal.observer.recordFriendAction(id,name,kind));},[journal]);
  const retry=useCallback(()=>{if(journal){void journal.load();void journal.flush();}},[journal]);
  const clear=useCallback(async()=>{await journal?.clear();},[journal]);
  const pause=useCallback(()=>journal?.observer.pause(),[journal]);
  // A synchronous account render gate prevents a previous account's history flashing before effects.
  const visible = journal && state===journal.state ? state : journal?.state || {events:[],loading:false,error:''};
  return {...visible,observePipeline,observeProfile,seedUsers,recordModeration,recordFriendAction,retry,clear,pause};
}
export type HistoryState = ReturnType<typeof useHistory>;
