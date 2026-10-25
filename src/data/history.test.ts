import { describe, expect, it } from 'vitest';
import { HistoryJournal, HistoryObserver } from './history';
import type { HistoryEvent } from './history';
import { MemoryHistoryStore } from './history-storage';
import type { HistoryStore } from './history-storage';
import type { User } from '../api';

const alice:User={id:'usr_alice',displayName:'Alice',status:'active',statusDescription:'hello',location:'wrld_a:1',bio:'bio',currentAvatar:'avtr_old',tags:['system_trust_basic']};
const self:User={id:'usr_me',displayName:'Me'};
function observer() {let id=0;return new HistoryObserver(()=> '2026-10-25T12:00:00.000Z',()=>`event_${++id}`);}
function sample(id='event_1'):HistoryEvent {return {id,time:'2026-10-25T12:00:00.000Z',kind:'online',userId:alice.id,displayName:alice.displayName,detail:'Observed online',source:'pipeline'};}

describe('observed friend history',()=>{
  it('establishes the first profile as baseline without inventing past changes',()=>{
    const history=observer();
    expect(history.observeProfile(alice)).toEqual([]);
    expect(history.observeProfile(alice)).toEqual([]);
    expect(history.observeProfile({...alice,bio:''})).toMatchObject([{kind:'bio',before:'bio',after:'',time:'2026-10-25T12:00:00.000Z',source:'profile'}]);
  });
  it('ignores absent fields and image changes as evidence of an avatar change',()=>{
    const history=observer();history.seedUsers([alice]);
    expect(history.observeProfile({id:alice.id,displayName:alice.displayName,currentAvatarImageUrl:'https://example.test/new.jpg'})).toEqual([]);
    expect(history.observeProfile({...alice,currentAvatar:'avtr_new'})).toMatchObject([{kind:'avatar',before:'avtr_old',after:'avtr_new'}]);
  });
  it('records explicit login/offline once and never treats website activity as game login',()=>{
    const history=observer();
    expect(history.observePipeline({type:'friend-active',content:{userId:alice.id,user:{displayName:alice.displayName}}},[alice],self)).toEqual([]);
    expect(history.observePipeline({type:'friend-online',content:{userId:alice.id,location:alice.location}},[alice],self)).toMatchObject([{kind:'online'}]);
    expect(history.observePipeline({type:'friend-online',content:{userId:alice.id,location:alice.location}},[alice],self)).toEqual([]);
    expect(history.observePipeline({type:'friend-offline',content:{userId:alice.id}},[alice],self)).toMatchObject([{kind:'offline'}]);
  });
  it('distinguishes moving to another instance of the same world from another world',()=>{
    const history=observer();history.seedUsers([alice]);
    expect(history.observePipeline({type:'friend-location',content:{userId:alice.id,location:'wrld_a:2',user:{displayName:'Alice'}}},[alice],self)).toMatchObject([{kind:'instance',worldId:'wrld_a',before:'wrld_a:1',after:'wrld_a:2'}]);
    expect(history.observePipeline({type:'friend-location',content:{userId:alice.id,location:'wrld_b:3'}},[alice],self)).toMatchObject([{kind:'world',worldId:'wrld_b'}]);
  });
  it('labels a first location as newly visible rather than claiming a previous visit',()=>{
    const events=observer().observePipeline({type:'friend-location',content:{userId:alice.id,location:'wrld_b:3'}},[alice],self);
    expect(events[0].before).toBeUndefined();
    expect(events[0].detail).toContain('стало доступно');
  });
  it('does not invent profile changes across a stopped observation period',()=>{
    const history=observer();history.seedUsers([alice]);history.pause();
    expect(history.observeProfile({...alice,displayName:'Later name',bio:'unobserved change'})).toEqual([]);
  });
  it('retains known public fields when a partial friend list is seeded later',()=>{
    const history=observer();history.observeProfile(alice);
    history.seedUsers([{id:alice.id,displayName:'Partial',bio:undefined}]);
    expect(history.observeProfile({...alice,bio:'new'})).toMatchObject([{kind:'bio',before:'bio',after:'new'}]);
  });
  it('records real friend actions and deduplicates their matching websocket acknowledgement',()=>{
    const history=observer();
    expect(history.recordFriendAction(alice.id,alice.displayName,'friend-remove')).toMatchObject([{kind:'friend-remove',source:'action'}]);
    expect(history.observePipeline({type:'friend-delete',content:{userId:alice.id}},[alice],self)).toEqual([]);
    expect(history.observePipeline({type:'friend-add',content:{userId:alice.id,user:alice}},[alice],self)).toMatchObject([{kind:'friend-add'}]);
  });
  it('saves only the event whitelist and no unknown auth-bearing server payload',()=>{
    const history=observer();
    const events=history.observePipeline({type:'friend-online',content:{userId:alice.id,user:{...alice,authToken:'do-not-persist'},cookies:'do-not-persist'}},[alice],self);
    expect(JSON.stringify(events)).not.toContain('do-not-persist');
    expect(Object.keys(events[0]).sort()).toEqual(['detail','displayName','id','kind','source','time','userId']);
  });
});

describe('durable account history journal',()=>{
  it('restores earlier events without mixing accounts or wiping on new controller creation',async()=>{
    const storage=new MemoryHistoryStore();
    await storage.append('usr_one',[sample()]);await storage.append('usr_two',[sample('other')]);
    const restarted=new HistoryJournal('usr_one',storage);await restarted.load();
    expect(restarted.state.events.map((event)=>event.id)).toEqual(['event_1']);
    await restarted.clear();
    expect(await storage.read('usr_one')).toEqual([]);
    expect((await storage.read('usr_two')).map((event)=>event.id)).toEqual(['other']);
  });
  it('merges events received while IndexedDB is being opened rather than replacing them',async()=>{
    let completeRead!:(events:HistoryEvent[])=>void;
    const memory=new MemoryHistoryStore();
    const storage:HistoryStore={readGame:async()=>({visits:[],sessions:[]}),saveGame:async()=>{},read:()=>new Promise((resolve)=>{completeRead=resolve;}),append:(...args)=>memory.append(...args),clear:(...args)=>memory.clear(...args)};
    const journal=new HistoryJournal('usr_one',storage);
    const loading=journal.load();journal.append([sample('live')]);
    completeRead([sample('stored')]);await loading;await journal.flush();
    expect(new Set(journal.state.events.map((event)=>event.id))).toEqual(new Set(['live','stored']));
  });
  it('reports a failed durable write, keeps the pending events, and retries with identical IDs',async()=>{
    let blocked=true;
    const memory=new MemoryHistoryStore();
    const storage:HistoryStore={readGame:async()=>({visits:[],sessions:[]}),saveGame:async()=>{},read:(...args)=>memory.read(...args),append:async(...args)=>{if(blocked)throw new Error('Storage full');await memory.append(...args);},clear:(...args)=>memory.clear(...args)};
    const journal=new HistoryJournal('usr_one',storage);
    journal.append([sample()]);await Promise.resolve();await Promise.resolve();
    expect(journal.state.error).toContain('Storage full');expect(journal.state.events).toHaveLength(1);
    blocked=false;await journal.flush();await journal.flush();
    expect(journal.state.error).toBe('');expect(await memory.read('usr_one')).toEqual([sample()]);
  });
  it('does not hide a read failure when an unrelated write succeeds',async()=>{
    const storage:HistoryStore={readGame:async()=>({visits:[],sessions:[]}),saveGame:async()=>{},read:async()=>{throw new Error('Read unavailable');},append:async()=>{},clear:async()=>{}};
    const journal=new HistoryJournal('usr_one',storage);await journal.load();
    journal.append([sample()]);await Promise.resolve();await Promise.resolve();
    expect(journal.state.error).toContain('Read unavailable');
  });
});
