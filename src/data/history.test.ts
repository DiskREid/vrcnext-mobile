import { describe, expect, it, vi } from 'vitest';
import { HistoryJournal, HistoryObserver } from './history';
import type { HistoryEvent } from './history';
import { MemoryHistoryStore } from './history-storage';
import type { HistoryStore } from './history-storage';
import type { User } from '../api';

const alice:User={id:'usr_alice',displayName:'Alice',status:'active',statusDescription:'hello',location:'wrld_a:1',bio:'bio',currentAvatar:'avtr_old',tags:['system_trust_basic']};
const self:User={id:'usr_me',displayName:'Me'};
const avatarFile = (id:string,version=1) => `https://api.vrchat.cloud/api/1/file/file_${id}/${version}/file`;
const avatarThumbnail = (id:string,version=1) => `https://api.vrchat.cloud/api/1/image/file_${id}/${version}/256`;
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
  it('does not suppress a new game login after website activity or invent an exit from website logout',()=>{
    const history=observer();
    expect(history.observePipeline({type:'friend-online',content:{userId:alice.id,location:alice.location}},[alice],self)).toMatchObject([{kind:'online'}]);
    expect(history.observePipeline({type:'friend-active',content:{userId:alice.id}},[alice],self)).toEqual([]);
    expect(history.observePipeline({type:'friend-offline',content:{userId:alice.id}},[{...alice,state:'active',location:'offline'}],self)).toEqual([]);
    expect(history.observePipeline({type:'friend-online',content:{userId:alice.id,location:'wrld_b:2'}},[alice],self)).toMatchObject([{kind:'online'}]);
  });
  it('starts a fresh location baseline after a game-to-website transition',()=>{
    const history=observer();history.seedUsers([alice]);
    history.observePipeline({type:'friend-active',content:{userId:alice.id}},[alice],self);
    expect(history.observePipeline({type:'friend-location',content:{userId:alice.id,location:'wrld_a:2'}},[alice],self)).toMatchObject([{kind:'world',before:'',after:'wrld_a:2'}]);
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
  it('compares friend refreshes instead of reseeding away avatar-image and Bio changes',()=>{
    const history=observer();
    const first={id:alice.id,displayName:alice.displayName,bio:'Before',currentAvatarImageUrl:avatarFile('old')};
    expect(history.observeUsers([first])).toEqual([]);
    const changed={...first,bio:'',currentAvatarImageUrl:avatarFile('new')};
    const events=history.observeUsers([changed]);
    expect(events).toMatchObject([
      {kind:'bio',before:'Before',after:'',source:'refresh'},
      {kind:'avatar',avatarEvidence:'image',before:avatarFile('old'),after:avatarFile('new'),avatarUrl:avatarFile('new'),source:'refresh'},
    ]);
    expect(events[1].detail).toBe('Обновилось изображение аватара');
    expect(history.observeUsers([changed])).toEqual([]);
    expect(history.observeUsers([{id:alice.id,displayName:alice.displayName}])).toEqual([]);
    expect(history.observeProfile({...changed,bio:'Later'},'sync')).toMatchObject([{kind:'bio',before:'',after:'Later',source:'sync'}]);
  });
  it('compares file identity across CDN, resolution and signed query changes without recording tokens',()=>{
    const history=observer();
    history.seedUsers([{...alice,currentAvatarImageUrl:avatarFile('same')+'?authToken=secret#preview'}]);
    expect(history.observeProfile({...alice,currentAvatarImageUrl:avatarThumbnail('same')+'?width=1024&token=different'})).toEqual([]);
    expect(history.observeProfile({...alice,currentAvatarImageUrl:'https://file-variants.vrchat.com/file_same/1/256'})).toEqual([]);
    const events=history.observeProfile({...alice,currentAvatarImageUrl:avatarFile('same',2)+'?token=do-not-persist'});
    expect(events).toMatchObject([{kind:'avatar',avatarEvidence:'image',avatarUrl:avatarFile('same',2)}]);
    expect(events[0].before).not.toContain('?');expect(events[0].after).toBe(avatarFile('same',2));
    expect(JSON.stringify(events)).not.toContain('do-not-persist');expect(JSON.stringify(events)).not.toContain('secret');
  });
  it('uses avatar fields only and does not confuse a profile photo, invalid URL or first image with a switch',()=>{
    const history=observer();history.seedUsers([alice]);
    expect(history.observeProfile({...alice,currentAvatarImageUrl:avatarFile('first')})).toEqual([]);
    for(const invalid of ['', 'javascript:alert(1)', 'https://name:secret@api.vrchat.cloud/api/1/file/file_new/1/file', 'https://example.test/avatar.jpg']) {
      expect(history.observeProfile({...alice,currentAvatarImageUrl:invalid,userIcon:avatarFile('icon'),profilePicOverride:avatarFile('picture'),profilePicOverrideThumbnail:avatarThumbnail('picture')})).toEqual([]);
    }
    expect(history.observeProfile({...alice,currentAvatarImageUrl:avatarFile('new')})).toMatchObject([{kind:'avatar',avatarEvidence:'image',before:avatarFile('first'),after:avatarFile('new')}]);
  });
  it('records a confirmed avatar ID switch once with only fresh name, author and preview data',()=>{
    const history=observer();history.seedUsers([{...alice,currentAvatarName:'Old Avatar',currentAvatarAuthorName:'Old Author',currentAvatarImageUrl:avatarFile('old')}]);
    const changed={...alice,currentAvatar:'avtr_new',currentAvatarName:'New Avatar',currentAvatarAuthorName:'New Author',currentAvatarImageUrl:avatarFile('new'),currentAvatarThumbnailImageUrl:avatarThumbnail('new')};
    const events=history.observeProfile(changed,'sync');
    expect(events).toMatchObject([{kind:'avatar',avatarEvidence:'id',before:'avtr_old',after:'avtr_new',avatarName:'New Avatar',avatarAuthorName:'New Author',avatarUrl:avatarThumbnail('new'),source:'sync'}]);
    expect(history.observeProfile(changed)).toEqual([]);
    expect(history.observePipeline({type:'friend-update',content:{userId:alice.id,user:{currentAvatar:'avtr_third'}}},[changed],self)).toMatchObject([{kind:'avatar',avatarEvidence:'id',before:'avtr_new',after:'avtr_third'}]);
    const fourth=history.observePipeline({type:'friend-update',content:{userId:alice.id,user:{currentAvatar:'avtr_fourth'}}},[changed],self);
    expect(fourth[0].avatarUrl).toBeUndefined();expect(fourth[0].avatarName).toBeUndefined();expect(fourth[0].avatarAuthorName).toBeUndefined();
  });
  it('does not misreport a same-ID image edit as another avatar identity',()=>{
    const history=observer();history.seedUsers([{...alice,currentAvatarImageUrl:avatarFile('same',1)}]);
    const events=history.observeProfile({...alice,currentAvatarImageUrl:avatarFile('same',2)});
    expect(events).toMatchObject([{kind:'avatar',avatarEvidence:'image',detail:'Обновилось изображение аватара'}]);
    expect(events[0].before).not.toBe('avtr_old');
    expect(history.observeProfile({...alice,currentAvatarImageUrl:avatarFile('same',2)})).toEqual([]);
  });
  it('deduplicates an image-only pipeline change and later exact profile hydration without trusting an inherited ID',()=>{
    const history=observer();const initial={...alice,currentAvatarImageUrl:avatarFile('old'),currentAvatarThumbnailImageUrl:avatarThumbnail('old')};
    history.seedUsers([initial]);
    const observed=history.observePipeline({type:'friend-update',content:{userId:alice.id,user:{currentAvatarImageUrl:avatarFile('new')}}},[initial],self);
    expect(observed).toMatchObject([{kind:'avatar',avatarEvidence:'image'}]);
    // A merged friend row can still carry the previous avatar ID until hydration.
    expect(history.observeUsers([{...initial,currentAvatarImageUrl:avatarFile('new'),currentAvatarThumbnailImageUrl:undefined}])).toEqual([]);
    const hydrated={...alice,currentAvatar:'avtr_new',currentAvatarName:'New',currentAvatarImageUrl:avatarFile('new'),currentAvatarThumbnailImageUrl:avatarThumbnail('new')};
    expect(history.observeProfile(hydrated,'sync')).toMatchObject([{id:observed[0].id,time:observed[0].time,avatarEvidence:'id',before:'avtr_old',after:'avtr_new',avatarId:'avtr_new',avatarName:'New'}]);
    expect(history.observeProfile(hydrated)).toEqual([]);
    expect(history.observeProfile({...hydrated,currentAvatar:'avtr_next',currentAvatarImageUrl:avatarFile('next'),currentAvatarThumbnailImageUrl:avatarThumbnail('next')},'sync')).toMatchObject([{kind:'avatar',avatarEvidence:'id',before:'avtr_new',after:'avtr_next'}]);
  });
  it('does not replay a partial thumbnail change when the full image arrives later',()=>{
    const history=observer();history.seedUsers([{...alice,currentAvatarImageUrl:avatarFile('oldFull'),currentAvatarThumbnailImageUrl:avatarThumbnail('oldThumb')}]);
    const observed=history.observePipeline({type:'friend-update',content:{userId:alice.id,user:{currentAvatarThumbnailImageUrl:avatarThumbnail('newThumb')}}},[alice],self);
    expect(observed).toMatchObject([{kind:'avatar',avatarEvidence:'image',avatarUrl:avatarThumbnail('newThumb')}]);
    expect(history.observeProfile({...alice,currentAvatar:'avtr_new',currentAvatarImageUrl:avatarFile('newFull'),currentAvatarThumbnailImageUrl:avatarThumbnail('newThumb')},'sync')).toMatchObject([{id:observed[0].id,avatarId:'avtr_new',avatarEvidence:'id'}]);
  });
  it('enriches a precise ID event with a later name, author and preview without creating another row',()=>{
    const history=observer();history.seedUsers([alice]);
    const observed=history.observePipeline({type:'friend-update',content:{userId:alice.id,user:{currentAvatar:'avtr_new'}}},[alice],self)[0];
    expect(observed.avatarName).toBeUndefined();expect(observed.avatarUrl).toBeUndefined();
    const hydrated={...alice,currentAvatar:'avtr_new',currentAvatarName:'Настоящий аватар',currentAvatarAuthorName:'Автор',currentAvatarImageUrl:avatarFile('new')};
    expect(history.observeProfile(hydrated,'sync')).toEqual([{...observed,avatarName:'Настоящий аватар',avatarAuthorName:'Автор',avatarUrl:avatarFile('new')}]);
    expect(history.observeProfile(hydrated,'sync')).toEqual([]);
    expect(history.observeProfile({...hydrated,currentAvatarName:'Позднее переименование'},'sync')).toEqual([]);
  });
  it('keeps image edits honest while still adding the confirmed searchable ID and name',()=>{
    const history=observer();history.seedUsers([{...alice,currentAvatarImageUrl:avatarFile('same',1)}]);
    const observed=history.observeProfile({...alice,currentAvatarImageUrl:avatarFile('same',2)})[0];
    const enriched=history.observeProfile({...alice,currentAvatarName:'Тот же аватар',currentAvatarAuthorName:'Автор',currentAvatarImageUrl:avatarFile('same',2)},'sync');
    expect(enriched).toMatchObject([{id:observed.id,avatarEvidence:'image',avatarId:'avtr_old',avatarName:'Тот же аватар',before:avatarFile('same',1),after:avatarFile('same',2)}]);
    expect(enriched[0].detail).toBe('Обновилось изображение аватара');
  });
  it('only attaches names to the latest matching image when several avatar images change before hydration',()=>{
    const history=observer();const initial={...alice,currentAvatarImageUrl:avatarFile('old')};history.seedUsers([initial]);
    const update=(image:string)=>history.observePipeline({type:'friend-update',content:{userId:alice.id,user:{currentAvatarImageUrl:avatarFile(image)}}},[initial],self)[0];
    const first=update('one'),second=update('two');
    const enriched=history.observeProfile({...alice,currentAvatar:'avtr_two',currentAvatarName:'Второй',currentAvatarImageUrl:avatarFile('two')},'sync');
    expect(enriched).toMatchObject([{id:second.id,avatarName:'Второй',avatarId:'avtr_two',avatarEvidence:'image'}]);
    expect(enriched[0].id).not.toBe(first.id);expect(first.avatarName).toBeUndefined();
    // The unknown intermediate avatar cannot prove an old-ID → new-ID switch.
    expect(enriched[0].before).toBe(avatarFile('one'));expect(enriched[0].after).toBe(avatarFile('two'));
  });
  it('does not attach an unproven ID or inherited friend-row name without matching fresh image evidence',()=>{
    const history=observer();const initial={...alice,currentAvatarName:'Старое имя',currentAvatarImageUrl:avatarFile('old')};history.seedUsers([initial]);
    const observed=history.observePipeline({type:'friend-update',content:{userId:alice.id,user:{currentAvatarImageUrl:avatarFile('new')}}},[initial],self)[0];
    expect(history.observeUsers([{...initial,currentAvatarImageUrl:avatarFile('new')}])).toEqual([]);
    expect(history.observeProfile({...alice,currentAvatar:'avtr_new',currentAvatarName:'Неподтверждённое имя'},'sync')).toEqual([]);
    const enriched=history.observeProfile({...alice,currentAvatar:'avtr_new',currentAvatarImageUrl:avatarFile('new')},'sync');
    expect(enriched).toMatchObject([{id:observed.id,avatarId:'avtr_new',avatarEvidence:'id'}]);
    expect(enriched[0].avatarName).toBeUndefined();
    expect(history.observeProfile({...alice,currentAvatar:'avtr_new',currentAvatarName:'Подтверждённое имя',currentAvatarImageUrl:avatarFile('new')},'sync')).toMatchObject([{id:observed.id,avatarName:'Подтверждённое имя'}]);
  });
  it('does not turn name hydration after a paused observation period into an update to an old event',()=>{
    const history=observer();history.seedUsers([{...alice,currentAvatarImageUrl:avatarFile('old')}]);
    history.observeProfile({...alice,currentAvatarImageUrl:avatarFile('new'),currentAvatar:undefined});
    history.pause();
    expect(history.observeProfile({...alice,currentAvatar:'avtr_new',currentAvatarName:'Новый',currentAvatarImageUrl:avatarFile('new')},'sync')).toEqual([]);
  });
  it('records an explicit pipeline Bio edit and clearing once without erasing it for absent fields',()=>{
    const history=observer();history.seedUsers([alice]);
    const update=(user:Partial<User>)=>history.observePipeline({type:'friend-update',content:{userId:alice.id,user}},[alice],self);
    expect(update({bio:'Changed'})).toMatchObject([{kind:'bio',before:'bio',after:'Changed',source:'pipeline'}]);
    expect(update({status:'active'})).toEqual([]);
    expect(history.observeProfile({...alice,bio:'Changed'},'sync')).toEqual([]);
    expect(update({bio:''})).toMatchObject([{kind:'bio',before:'Changed',after:''}]);
    expect(update({bio:''})).toEqual([]);
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
  it('upserts hydrated avatar metadata while an earlier version is still being saved, and restores one enriched row',async()=>{
    const memory=new MemoryHistoryStore();let releaseFirst!:()=>void;let calls=0;
    const storage:HistoryStore={readGame:async()=>({visits:[],sessions:[]}),saveGame:async()=>{},read:(...args)=>memory.read(...args),clear:(...args)=>memory.clear(...args),append:async(...args)=>{
      if(calls++===0)await new Promise<void>(resolve=>{releaseFirst=resolve;});
      await memory.append(...args);
    }};
    const original:HistoryEvent={...sample('avatar_row'),kind:'avatar',avatarEvidence:'image',detail:'Обновилось изображение аватара',avatarUrl:avatarFile('new')};
    const enriched:HistoryEvent={...original,avatarId:'avtr_new',avatarName:'Новый аватар',avatarAuthorName:'Автор'};
    const journal=new HistoryJournal('usr_one',storage);
    journal.append([original]);journal.append([enriched]);
    expect(journal.state.events).toEqual([enriched]);
    releaseFirst();
    await vi.waitFor(async()=>expect(await memory.read('usr_one')).toEqual([enriched]));
    const restarted=new HistoryJournal('usr_one',storage);await restarted.load();
    expect(restarted.state.events).toEqual([enriched]);
    expect(await memory.read('usr_other')).toEqual([]);
  });
  it('keeps live enrichment when an older copy of the same event finishes loading from storage',async()=>{
    let completeRead!:(events:HistoryEvent[])=>void;
    const memory=new MemoryHistoryStore();
    const storage:HistoryStore={readGame:async()=>({visits:[],sessions:[]}),saveGame:async()=>{},read:()=>new Promise(resolve=>{completeRead=resolve;}),append:(...args)=>memory.append(...args),clear:(...args)=>memory.clear(...args)};
    const original:HistoryEvent={...sample('avatar_row'),kind:'avatar',avatarEvidence:'image',detail:'Обновилось изображение аватара'};
    const enriched={...original,avatarId:'avtr_new',avatarName:'Свежее имя'};
    const journal=new HistoryJournal('usr_one',storage);const loading=journal.load();
    journal.append([original,enriched]);completeRead([original]);await loading;
    expect(journal.state.events).toEqual([enriched]);
  });
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
