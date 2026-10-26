import { describe, expect, it, vi } from 'vitest';
import { closeInterrupted, friendStatistics, GameObserver, intervalMs, observedLocation, realLocation, unionDuration } from './game-history';
import type { GameData, GameVisit } from './game-history';
import { HistoryJournal } from './history';
import { MemoryHistoryStore } from './history-storage';
import type { HistoryStore } from './history-storage';
import type { User } from '../api';

const self:User={id:'usr_self',displayName:'Me',location:'wrld_a:1'};
const friend:User={id:'usr_friend',displayName:'Friend',location:'wrld_a:1',state:'online'};
const origin=Date.parse('2026-10-25T12:00:00.000Z');
const at=(seconds:number)=>new Date(origin+seconds*1000).toISOString();
function fixture() {let seconds=0,id=0;const observer=new GameObserver(()=>at(seconds),()=>`id_${++id}`);return {observer,time:(value:number)=>{seconds=value;}};}
function storedVisit(id='old'):GameVisit {return {id,sessionId:'session_old',location:'wrld_a:1',worldId:'wrld_a',start:at(0),lastObserved:at(120),source:'api',reason:'observation-gap',participants:[{userId:friend.id,displayName:friend.displayName,start:at(0),lastObserved:at(120)}]};}

describe('observed game locations and co-presence',()=>{
  it('composes a disclosed world and instance only when the same sample omits location',()=>{
    const tags='1~hidden(usr_owner)~region(eu)';
    expect(observedLocation({worldId:'wrld_a',instanceId:tags})).toBe(`wrld_a:${tags}`);
    const {observer}=fixture();
    const data=observer.observe({...self,location:undefined,worldId:'wrld_a',instanceId:'1'},[friend],'api');
    expect(data.visits[0]).toMatchObject({location:'wrld_a:1',worldId:'wrld_a'});
    expect(data.visits[0].participants[0].userId).toBe(friend.id);
  });
  it('never reconstructs a hidden, offline or incomplete location using other fields',()=>{
    for(const location of ['private','offline','traveling','','invalid'])
      expect(observedLocation({location,worldId:'wrld_a',instanceId:'1'})).toBeUndefined();
    for(const instanceId of ['private','offline','traveling','','wrld_a:1','1/invalid'])
      expect(observedLocation({worldId:'wrld_a',instanceId})).toBeUndefined();
    expect(observedLocation({worldId:'offline',instanceId:'1'})).toBeUndefined();
    expect(observedLocation({worldId:'wrld_a'})).toBeUndefined();
    expect(observedLocation({instanceId:'1'})).toBeUndefined();
    const {observer,time}=fixture();observer.observe(self,[],'api');time(120);
    const absent=observer.observe({id:self.id,displayName:self.displayName,instanceId:'2'},[],'api');
    expect(absent.visits[0]).toMatchObject({end:at(0),reason:'observation-gap'});
  });
  it('records a single real location without inventing elapsed time',()=>{
    const {observer}=fixture();const data=observer.observe(self,[friend],'api');
    expect(data.visits).toHaveLength(1);expect(data.sessions).toHaveLength(1);
    expect(data.visits[0]).toMatchObject({location:self.location,worldId:'wrld_a',start:at(0),lastObserved:at(0),source:'api'});
    expect(intervalMs(data.visits[0])).toBe(0);
    expect(friendStatistics(data.visits,friend.id)).toEqual({encounters:1,totalMs:0,lastMeeting:at(0)});
  });
  it('extends only to another actual sample and does not create a new visit or encounter',()=>{
    const {observer,time}=fixture();const first=observer.observe(self,[friend],'api');time(120);
    const second=observer.observe(self,[friend],'api');
    expect(second.visits[0].id).toBe(first.visits[0].id);
    expect(second.sessions[0].id).toBe(first.sessions[0].id);
    expect(friendStatistics(second.visits,friend.id)).toEqual({encounters:1,totalMs:120_000,lastMeeting:at(120)});
    expect(first.visits[0].lastObserved).toBe(at(0)); // emitted/persisted snapshots remain immutable
  });
  it('closes the previous world at its last sample, leaving the unknown transition gap empty',()=>{
    const {observer,time}=fixture();observer.observe(self,[friend],'api');time(120);observer.observe(self,[friend],'api');time(240);
    const moved=observer.observe({...self,location:'wrld_b:9'},[],'pipeline');
    expect(moved.visits).toHaveLength(2);
    expect(moved.visits[0]).toMatchObject({location:'wrld_a:1',end:at(120),lastObserved:at(120),reason:'location-change'});
    expect(moved.visits[0].participants[0].end).toBe(at(120));
    expect(moved.visits[1]).toMatchObject({location:'wrld_b:9',start:at(240),lastObserved:at(240),source:'pipeline'});
  });
  it('starts a separate visit for another instance of the same world',()=>{
    const {observer,time}=fixture();observer.observe(self,[],'api');time(120);
    const moved=observer.observe({...self,location:'wrld_a:2'},[],'api');
    expect(moved.visits).toHaveLength(2);expect(moved.visits[0].worldId).toBe(moved.visits[1].worldId);
    expect(moved.visits[0].id).not.toBe(moved.visits[1].id);
  });
  it('does not extend time to an offline event or the current wall clock',()=>{
    const {observer,time}=fixture();observer.observe(self,[friend],'api');time(120);observer.observe(self,[friend],'api');time(240);
    const offline=observer.observe({...self,location:'offline'},[],'pipeline');
    expect(offline.visits[0]).toMatchObject({end:at(120),reason:'offline'});
    expect(offline.sessions[0].end).toBe(at(120));
    expect(intervalMs(offline.visits[0])).toBe(120_000);
    time(7200);expect(observer.pause()).toEqual({visits:[],sessions:[]});
  });
  it('closes on an observation gap and begins a new session on resume',()=>{
    const {observer,time}=fixture();const initial=observer.observe(self,[friend],'api');time(90);
    const closed=observer.pause();expect(closed.visits[0].end).toBe(at(0));
    expect(closed.sessions[0].end).toBe(at(0));time(7200);
    const resumed=observer.observe(self,[friend],'api');
    expect(resumed.visits[0].start).toBe(at(7200));expect(resumed.sessions[0].id).not.toBe(initial.sessions[0].id);
    expect(intervalMs(resumed.visits[0])).toBe(0);
  });
  it('splits a suspended or clock-reversed sample even when lifecycle callbacks were missed',()=>{
    const {observer,time}=fixture();observer.observe(self,[],'api');time(600);
    const gap=observer.observe(self,[],'api');
    expect(gap.visits).toHaveLength(2);expect(gap.visits[0].end).toBe(at(0));expect(gap.visits[1].start).toBe(at(600));
    time(30);const reversed=observer.observe(self,[],'api');
    expect(reversed.visits).toHaveLength(2);expect(intervalMs(reversed.visits[0])).toBe(0);
  });
  it('records only friends in the exact visible instance, never all world occupants',()=>{
    const {observer}=fixture();const data=observer.observe(self,[friend,{...friend,id:'usr_other_instance',location:'wrld_a:2'},{...friend,id:'usr_private',location:'private'},{...friend,id:'usr_offline',state:'offline'}],'api');
    expect(data.visits[0].participants.map((p)=>p.userId)).toEqual([friend.id]);
    expect(observer.observe({...self,location:'private'},[friend],'api').visits[0].reason).toBe('observation-gap');
    expect(realLocation('offline')).toBe(false);expect(realLocation('private')).toBe(false);expect(realLocation('https://other.test')).toBe(false);
  });
  it('does not turn tagged privacy placeholders into real recorded visits',()=>{
    for(const placeholder of ['offline','private','traveling']){
      const location=`wrld_a:${placeholder}~region(eu)`;
      expect(realLocation(location)).toBe(false);
      expect(observedLocation({location})).toBeUndefined();
      expect(fixture().observer.observe({...self,location},[friend],'api')).toEqual({visits:[],sessions:[]});
    }
  });
  it('uses same-sample disclosed friend fields for exact co-presence without overriding privacy',()=>{
    const {observer}=fixture();
    const friends=[
      {...friend,location:undefined,worldId:'wrld_a',instanceId:'1'},
      {...friend,id:'usr_hidden',location:'private',worldId:'wrld_a',instanceId:'1'},
      {...friend,id:'usr_elsewhere',location:undefined,worldId:'wrld_a',instanceId:'2'},
    ];
    expect(observer.observe(self,friends,'api').visits[0].participants.map(person=>person.userId)).toEqual([friend.id]);
  });
  it('ends a missing participant at lastObserved and records a later re-encounter separately',()=>{
    const {observer,time}=fixture();observer.observe(self,[friend],'api');time(120);observer.observe(self,[friend],'api');time(240);
    const alone=observer.observe(self,[],'api');expect(alone.visits[0].participants[0].end).toBe(at(120));
    time(360);const together=observer.observe(self,[friend],'api');
    expect(together.visits[0].participants).toHaveLength(2);
    expect(friendStatistics(together.visits,friend.id)).toEqual({encounters:2,totalMs:120_000,lastMeeting:at(360)});
  });
  it('unions overlapping intervals and clamps invalid or backward duration',()=>{
    expect(unionDuration([{start:at(0),lastObserved:at(120)},{start:at(60),lastObserved:at(180)},{start:at(300),lastObserved:at(360)}])).toBe(240_000);
    expect(intervalMs({start:at(120),end:at(600),lastObserved:at(240)})).toBe(120_000);
    expect(intervalMs({start:at(120),lastObserved:at(0)})).toBe(0);
    expect(intervalMs({start:'invalid',lastObserved:at(0)})).toBe(0);
  });
  it('closes unfinished persisted records without extending or resuming their old session',()=>{
    const old=storedVisit();const repaired=closeInterrupted({visits:[old],sessions:[{id:old.sessionId,start:at(0),lastObserved:at(120)}]});
    expect(repaired.visits[0]).toMatchObject({end:at(120),reason:'observation-gap'});
    expect(repaired.visits[0].participants[0].end).toBe(at(120));expect(repaired.sessions[0].end).toBe(at(120));
    expect(old.end).toBeUndefined();expect(closeInterrupted({visits:[old],sessions:[]},old.id).visits).toEqual([]);
  });
});

describe('durable game journal',()=>{
  it('preserves observations received while an account clear is pending',async()=>{
    const memory=new MemoryHistoryStore();const {observer,time}=fixture();
    let finish!:()=>void;
    const storage:HistoryStore={read:(...args)=>memory.read(...args),append:(...args)=>memory.append(...args),readGame:(...args)=>memory.readGame(...args),saveGame:(...args)=>memory.saveGame(...args),clear:async(account)=>{await new Promise<void>((resolve)=>{finish=resolve;});await memory.clear(account);}};
    const journal=new HistoryJournal('usr_one',storage,observer);
    journal.observeSession(self,[friend],'api');
    journal.append([{id:'old_event',time:at(0),kind:'online',userId:friend.id,displayName:friend.displayName,detail:'Old fixture',source:'pipeline'}]);
    await vi.waitFor(async()=>expect((await memory.readGame('usr_one')).visits).toHaveLength(1));
    const deleting=journal.clear();
    time(120);journal.observeSession(self,[friend],'api');
    journal.append([{id:'new_event',time:at(120),kind:'online',userId:friend.id,displayName:friend.displayName,detail:'New fixture',source:'pipeline'}]);
    await journal.load(); // A read during deletion must not queue repair of the soon-to-be-deleted rows.
    expect((await memory.read('usr_one')).map((event)=>event.id)).toEqual(['old_event']);
    finish();await deleting;
    await vi.waitFor(async()=>expect((await memory.read('usr_one')).map((event)=>event.id)).toEqual(['new_event']));
    await vi.waitFor(async()=>expect((await memory.readGame('usr_one')).visits.map((visit)=>visit.start)).toEqual([at(120)]));
    expect(journal.state.events.map((event)=>event.id)).toEqual(['new_event']);
    expect(journal.state.visits.map((visit)=>visit.start)).toEqual([at(120)]);
  });
  it('retains old and new data if an in-flight clear fails',async()=>{
    const memory=new MemoryHistoryStore();const {observer,time}=fixture();
    let fail!:(error:Error)=>void;
    const storage:HistoryStore={read:(...args)=>memory.read(...args),append:(...args)=>memory.append(...args),readGame:(...args)=>memory.readGame(...args),saveGame:(...args)=>memory.saveGame(...args),clear:()=>new Promise<void>((_resolve,reject)=>{fail=reject;})};
    const journal=new HistoryJournal('usr_one',storage,observer);journal.observeSession(self,[friend],'api');
    await vi.waitFor(async()=>expect((await memory.readGame('usr_one')).visits).toHaveLength(1));
    const deleting=journal.clear();
    time(120);journal.observeSession({...self,location:'wrld_b:2'},[],'api');
    fail(new Error('Delete failed'));
    await expect(deleting).rejects.toThrow('Delete failed');
    await vi.waitFor(async()=>expect((await memory.readGame('usr_one')).visits).toHaveLength(2));
    const old=journal.state.visits.find((visit)=>visit.location===self.location)!;
    expect(old.end).toBe(at(0));
    expect(journal.state.visits.find((visit)=>visit.location==='wrld_b:2')?.start).toBe(at(120));
  });
  it('keeps sessions and visits account-isolated and repairs an interrupted previous process',async()=>{
    const storage=new MemoryHistoryStore();const old=storedVisit();
    await storage.saveGame('usr_one',{visits:[old],sessions:[{id:old.sessionId,start:at(0),lastObserved:at(120)}]});
    await storage.saveGame('usr_two',{visits:[storedVisit('unrelated')],sessions:[]});
    const journal=new HistoryJournal('usr_one',storage);await journal.load();await journal.flushGame();
    expect(journal.state.visits[0].end).toBe(at(120));expect(journal.state.sessions[0].end).toBe(at(120));
    await journal.clear();expect(await storage.readGame('usr_one')).toEqual({visits:[],sessions:[]});
    expect((await storage.readGame('usr_two')).visits[0].id).toBe('unrelated');
  });
  it('keeps pending game samples visible on disk errors and retries without duplicate IDs',async()=>{
    let blocked=true;const memory=new MemoryHistoryStore();const {observer,time}=fixture();
    const storage:HistoryStore={read:(...args)=>memory.read(...args),append:(...args)=>memory.append(...args),readGame:(...args)=>memory.readGame(...args),saveGame:async(...args)=>{if(blocked)throw new Error('Disk full');await memory.saveGame(...args);},clear:(...args)=>memory.clear(...args)};
    const journal=new HistoryJournal('usr_one',storage,observer);journal.observeSession(self,[friend],'api');await Promise.resolve();await Promise.resolve();
    expect(journal.state.error).toContain('Disk full');time(120);journal.observeSession(self,[friend],'api');await Promise.resolve();await Promise.resolve();
    blocked=false;await journal.flushGame();await journal.flushGame();
    const stored=await memory.readGame('usr_one');expect(stored.visits).toHaveLength(1);expect(stored.visits[0].lastObserved).toBe(at(120));expect(journal.state.error).toBe('');
  });
  it('does not let a read-time crash repair overwrite a newer live sample or close in-flight record',async()=>{
    let complete!:(game:GameData)=>void;const memory=new MemoryHistoryStore();const {observer,time}=fixture();
    const storage:HistoryStore={read:(...args)=>memory.read(...args),append:(...args)=>memory.append(...args),readGame:()=>new Promise((resolve)=>{complete=resolve;}),saveGame:(...args)=>memory.saveGame(...args),clear:(...args)=>memory.clear(...args)};
    const journal=new HistoryJournal('usr_one',storage,observer);const loading=journal.load();
    journal.observeSession(self,[friend],'api');await Promise.resolve();const old=await memory.readGame('usr_one');time(120);journal.observeSession(self,[friend],'api');journal.pause();
    complete(old);await loading;await Promise.resolve();await journal.flushGame();
    const stored=await memory.readGame('usr_one');expect(stored.visits[0].end).toBe(at(120));expect(journal.state.visits[0].end).toBe(at(120));
  });
  it('does not hide a failed game read when an unrelated event write succeeds',async()=>{
    const memory=new MemoryHistoryStore();const storage:HistoryStore={read:(...args)=>memory.read(...args),append:(...args)=>memory.append(...args),readGame:async()=>{throw new Error('Game read failed');},saveGame:(...args)=>memory.saveGame(...args),clear:(...args)=>memory.clear(...args)};
    const journal=new HistoryJournal('usr_one',storage);await journal.load();await journal.flush();
    expect(journal.state.error).toContain('Game read failed');
  });
});
