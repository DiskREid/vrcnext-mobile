import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';

type FeedEvent={id:string;kind:string;time?:string;userId?:string;displayName?:string;detail?:string;source?:string;before?:string;after?:string;avatarName?:string;avatarId?:string;avatarEvidence?:string;avatarUrl?:string;avatarFileId?:string;previousAvatarName?:string;previousAvatarId?:string;previousAvatarUrl?:string;previousAvatarFileId?:string};
type FeedFixture={friendId:string;oldFile:string;newFile:string;otherFile:string;fileOnlyFile:string;customFile:string;oldImage:string;newImage:string;otherImage:string;oldThumbnail:string;newThumbnail:string;fileOnlyImage:string;customImage:string;requests:{path:string;method:string;time:number}[];resolves:{fileId:string;source:string;time:number}[];searches:{query:string;page:number}[];unexpected:string[];connected:boolean;held:boolean;emitUpdate:(user:Record<string,unknown>)=>void;emitEvent:(type:string,user?:Record<string,unknown>)=>void;emitConnection:(state:string)=>void;changeProfile:(change:Record<string,unknown>)=>void;setResolveMode:(fileId:string,mode:string)=>void;failNextResolve:(status?:number,retryAfter?:number)=>void;holdNextResolve:()=>void;releaseResolve:()=>void;setActive:(value:boolean)=>void;seedStored:(events:FeedEvent[])=>Promise<void>;stored:()=>Promise<FeedEvent[]>};
async function fixture(page:Page){return page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest);}
async function stored(page:Page){return page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.stored());}
const feed=(page:Page)=>page.locator('[data-screen="feed"]');
const rows=(page:Page)=>feed(page).locator('.history-row');
const profileReads=(value:FeedFixture)=>value.requests.filter(request=>request.path.startsWith('/profile/'));
async function openFeed(page:Page,query=''){
 await page.goto('/tests/feed-harness.html'+query);
 await expect(page.getByRole('heading',{name:'Привет, Synthetic Feed Self ✦',exact:true})).toBeVisible();
 await page.locator('nav[aria-label="Основная навигация"]:visible').getByRole('button',{name:'Ещё',exact:true}).click();
 await page.getByRole('button',{name:/^Лента /}).click();
 await expect(feed(page).getByRole('heading',{name:'Лента',exact:true})).toBeVisible();
 await expect.poll(async()=>(await fixture(page)).connected).toBe(true);
 await expect(feed(page).getByRole('region',{name:'Проверка профилей друзей',exact:true})).toHaveCount(0);
 await expect(feed(page).getByRole('button',{name:/^(Проверить профили|Обновить био и аватары)$/})).toHaveCount(0);
}
async function checkNoHorizontalOverflow(page:Page){
 const sizes=await page.evaluate(()=>[document.documentElement,document.querySelector('.main-content'),...document.querySelectorAll('.modal')].filter(Boolean).map(element=>({width:element!.clientWidth,scroll:element!.scrollWidth})));
 for(const value of sizes)expect(value.scroll).toBeLessThanOrEqual(value.width+1);
}
async function avatarEvents(page:Page){return(await stored(page)).filter(event=>event.kind==='avatar');}
async function settleMetadata(page:Page){await page.clock.fastForward(10_100);}

test('modern iconUrl changes confirm an avatar transition, resolve both names and keep clickable old and new avatars',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.install();await openFeed(page);
 await expect(rows(page)).toHaveCount(0);expect(await stored(page)).toEqual([]);
 expect(profileReads(await fixture(page))).toEqual([]);expect((await fixture(page)).resolves).toEqual([]);
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.emitUpdate({bio:'Привет 👋\nИграю в 22:22',tags:['system_trust_known']}));
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.holdNextResolve();f.emitUpdate({bio:'Привет 👋\nИграю в 22:30',iconUrl:f.newImage});});
 await expect.poll(async()=>(await fixture(page)).held).toBe(true);
 // An icon may be a custom profile picture. It becomes an avatar event only
 // after the exact file lookup establishes avatar metadata.
 await expect(rows(page)).toHaveCount(1);expect(await avatarEvents(page)).toEqual([]);
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.releaseResolve());
 const newButton=feed(page).getByRole('button',{name:'Найти аватар Лунный Лис в AvatarDB',exact:true});
 await expect(newButton).toBeVisible();await expect(rows(page)).toHaveCount(2);
 const first=(await avatarEvents(page))[0];
 expect(first).toMatchObject({source:'pipeline',avatarName:'Лунный Лис',avatarId:'avtr_feed-new',avatarFileId:(await fixture(page)).newFile,previousAvatarFileId:(await fixture(page)).oldFile});
 await settleMetadata(page);
 const oldButton=feed(page).getByRole('button',{name:'Найти аватар Старый Лис в AvatarDB',exact:true});
 await expect(oldButton).toBeVisible();
 await expect.poll(async()=>(await avatarEvents(page))[0]?.previousAvatarName).toBe('Старый Лис');
 expect((await avatarEvents(page))[0]).toMatchObject({id:first.id,time:first.time,previousAvatarName:'Старый Лис',previousAvatarId:'avtr_feed-old'});
 expect(await avatarEvents(page)).toHaveLength(1);
 const avatarRow=rows(page).filter({has:page.getByRole('group',{name:'Смена аватара',exact:true})});
 await expect(avatarRow.getByRole('group',{name:'Предыдущий аватар',exact:true})).toContainText('Старый Лис');
 await expect(avatarRow.getByRole('group',{name:'Новый аватар',exact:true})).toContainText('Лунный Лис');
 await expect(avatarRow.locator('.history-avatar-before .history-avatar-preview')).toHaveAttribute('alt','Старый Лис');
 await expect(avatarRow.locator('.history-avatar-after .history-avatar-preview')).toHaveAttribute('alt','Лунный Лис');
 await avatarRow.scrollIntoViewIfNeeded();await page.clock.runFor(50);
 await expect.poll(()=>avatarRow.locator('.history-avatar-preview').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0))).toBe(true);
 await page.screenshot({path:`artifacts/regressions/${info.project.name}-feed-avatar-transition-synthetic-fixture.png`});
 expect((await fixture(page)).searches).toEqual([]);expect(profileReads(await fixture(page))).toEqual([]);
 await oldButton.click();
 const search=page.getByRole('dialog',{name:'Поиск аватара в AvatarDB',exact:true});
 await expect(search.getByRole('button',{name:'Открыть аватар Старый Лис',exact:true})).toBeVisible();
 await search.getByRole('button',{name:'Закрыть',exact:true}).click();
 await newButton.click();await expect(search.getByRole('button',{name:'Открыть аватар Лунный Лис',exact:true})).toBeVisible();
 await search.getByRole('button',{name:'Закрыть',exact:true}).click();
 expect((await fixture(page)).searches.map(value=>value.query)).toEqual(['Старый Лис','Лунный Лис']);
 const bio=rows(page).filter({has:page.locator('.history-bio-current')});
 await bio.locator('summary').click();await expect(bio.locator('del')).toContainText('22');await expect(bio.locator('ins')).toContainText('30');
 await avatarRow.getByRole('button',{name:'Открыть профиль Synthetic Feed Friend',exact:true}).click();
 const profile=page.getByRole('dialog',{name:'Профиль',exact:true});
 await expect(profile.getByRole('heading',{name:'Synthetic Feed Friend',exact:true})).toBeVisible();
 await profile.getByRole('button',{name:'Закрыть',exact:true}).click();
 expect(await avatarEvents(page)).toHaveLength(1);
 await checkNoHorizontalOverflow(page);expect((await fixture(page)).unexpected).toEqual([]);expect(errors).toEqual([]);
});

test('thumbnail baseline and a later full image field still produce the first avatar change',async({page})=>{
 await page.clock.install();await openFeed(page,'?baseline=thumbnail');
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.holdNextResolve();f.emitUpdate({currentAvatarImageUrl:f.newImage});});
 await expect(rows(page)).toHaveCount(1);
 await expect.poll(async()=>(await fixture(page)).held).toBe(true);
 const first=(await avatarEvents(page))[0];expect(first).toMatchObject({previousAvatarFileId:(await fixture(page)).oldFile,avatarFileId:(await fixture(page)).newFile});
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.releaseResolve());await settleMetadata(page);
 await expect(feed(page).getByRole('button',{name:'Найти аватар Лунный Лис в AvatarDB',exact:true})).toBeVisible();
 await expect(feed(page).getByRole('button',{name:'Найти аватар Старый Лис в AvatarDB',exact:true})).toBeVisible();
 expect(await avatarEvents(page)).toHaveLength(1);expect((await avatarEvents(page))[0].id).toBe(first.id);
 expect(profileReads(await fixture(page))).toEqual([]);await checkNoHorizontalOverflow(page);
});

test('a missed AvatarDB mapping uses the exact avtr.icu mapping without scanning profiles',async({page})=>{
 await page.clock.install();await openFeed(page);
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.setResolveMode(f.newFile,'icu');f.emitUpdate({iconUrl:f.newImage});});
 await expect(feed(page).getByRole('button',{name:'Найти аватар Лунный Лис в AvatarDB',exact:true})).toBeVisible();await settleMetadata(page);
 const value=await fixture(page);
 expect(value.resolves.filter(call=>call.fileId===value.newFile).map(call=>call.source)).toEqual(['avtrdb','icu']);
 expect(value.requests.filter(call=>call.path===`/file/${value.newFile}`)).toEqual([]);
 expect(profileReads(value)).toEqual([]);expect(await avatarEvents(page)).toHaveLength(1);expect(value.unexpected).toEqual([]);
});

test('official file metadata supplies a real name without inventing an avatar ID when public databases have no match',async({page})=>{
 await page.clock.install();await openFeed(page);
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.emitUpdate({iconUrl:f.fileOnlyImage});});
 await expect(feed(page).getByRole('button',{name:'Найти аватар Официальный Лис в AvatarDB',exact:true})).toBeVisible();await settleMetadata(page);
 const value=await fixture(page),event=(await avatarEvents(page))[0];
 expect(value.resolves.filter(call=>call.fileId===value.fileOnlyFile).map(call=>call.source)).toEqual(['avtrdb','icu']);
 expect(value.requests.some(call=>call.path===`/file/${value.fileOnlyFile}`&&call.method==='GET')).toBe(true);
 expect(event).toMatchObject({avatarName:'Официальный Лис',avatarFileId:value.fileOnlyFile});expect(event.avatarId).toBeUndefined();
 expect(profileReads(value)).toEqual([]);expect(value.unexpected).toEqual([]);await checkNoHorizontalOverflow(page);
});

test('a custom profile icon never becomes an avatar switch, including its return to the known avatar image',async({page})=>{
 await page.clock.install();await openFeed(page);
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.emitUpdate({iconUrl:f.customImage});});await settleMetadata(page);
 const value=await fixture(page);
 expect(value.requests.some(call=>call.path===`/file/${value.customFile}`)).toBe(true);
 expect(await avatarEvents(page)).toEqual([]);await expect(rows(page)).toHaveCount(0);
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.emitUpdate({iconUrl:f.oldImage});});await settleMetadata(page);
 expect(await avatarEvents(page)).toEqual([]);await expect(rows(page)).toHaveCount(0);
 // An unverified custom icon between two real avatar images must not be shown
 // as a verified old avatar picture when the next actual avatar resolves.
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.emitUpdate({iconUrl:f.customImage});});await settleMetadata(page);
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.emitUpdate({iconUrl:f.newImage});});await settleMetadata(page);
 await expect(feed(page).getByRole('button',{name:'Найти аватар Лунный Лис в AvatarDB',exact:true})).toBeVisible();
 const real=(await avatarEvents(page))[0];expect(await avatarEvents(page)).toHaveLength(1);
 expect(real.previousAvatarFileId).toBe((await fixture(page)).customFile);
 expect(real.previousAvatarUrl).toBeUndefined();expect(real.previousAvatarName).toBeUndefined();
 await expect(feed(page).getByRole('group',{name:'Предыдущий аватар',exact:true})).toContainText('Название неизвестно');
 await expect(feed(page).locator('.history-avatar-before .history-avatar-preview')).toHaveCount(0);
 expect(profileReads(await fixture(page))).toEqual([]);expect((await fixture(page)).unexpected).toEqual([]);
});

test('connecting after the friend list loaded does not erase the baseline of the first real avatar switch',async({page})=>{
 await page.clock.install();await openFeed(page);
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.emitConnection('connecting'));
 await expect.poll(async()=>(await fixture(page)).connected).toBe(false);
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.emitConnection('connected'));
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.emitUpdate({iconUrl:f.newImage});});
 await expect(feed(page).getByRole('button',{name:'Найти аватар Лунный Лис в AvatarDB',exact:true})).toBeVisible();await settleMetadata(page);
 expect(await avatarEvents(page)).toHaveLength(1);
 expect((await avatarEvents(page))[0]).toMatchObject({previousAvatarFileId:(await fixture(page)).oldFile,avatarFileId:(await fixture(page)).newFile});
 expect(profileReads(await fixture(page))).toEqual([]);expect((await fixture(page)).unexpected).toEqual([]);
});

test('idle time, generic friend events and feed refresh never scan public profiles or resolve unchanged avatars',async({page})=>{
 await page.clock.install();await openFeed(page);
 expect(profileReads(await fixture(page))).toEqual([]);expect((await fixture(page)).resolves).toEqual([]);
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.changeProfile({bio:'Not sent in any event'});f.emitUpdate({status:'active',tags:['system_trust_known']});f.emitUpdate({tags:['system_trust_basic','system_trust_known']});f.emitEvent('friend-online');f.emitEvent('friend-active');
  f.emitUpdate({currentAvatarImageUrl:'https://api.vrchat.cloud/api/1/file/file_0e8c4e32-7444-44ea-ade4-313c010d4bae/1/file'});
  f.emitUpdate({currentAvatarImageUrl:'https://api.vrchat.cloud/api/1/image/file_31255e6b-696e-4c11-b007-595fa1142467/2/256'});
  f.emitUpdate({currentAvatarImageUrl:f.oldImage});});
 await page.clock.fastForward(3_600_100);await page.getByRole('button',{name:'Обновить данные',exact:true}).click();await page.clock.fastForward(3_600_100);
 const value=await fixture(page);expect(profileReads(value)).toEqual([]);expect(value.resolves).toEqual([]);expect(value.searches).toEqual([]);
 expect((await stored(page)).filter(event=>['avatar','bio','trust'].includes(event.kind))).toEqual([]);
 expect(value.unexpected).toEqual([]);await checkNoHorizontalOverflow(page);
});

test('Bio edits and clearing are logged from actual fields and persist without interpreting missing Bio as an edit',async({page})=>{
 await page.clock.install();await openFeed(page);
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.emitUpdate({bio:'Привет 👋\nИграю в 22:22'}));
 await expect(rows(page)).toHaveCount(0);
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.emitUpdate({bio:'Привет 👋\nИграю в 23:00'}));
 await expect(rows(page)).toHaveCount(1);await expect(rows(page).first()).toContainText('Играю в 23:00');
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.emitUpdate({status:'active'}));
 await expect(rows(page)).toHaveCount(1);
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.emitUpdate({bio:''}));
 await expect(rows(page)).toHaveCount(2);await expect(rows(page).first()).toContainText('Био очищено');
 await rows(page).first().locator('summary').click();await expect(rows(page).first().locator('del')).toContainText('Привет');
 await expect.poll(async()=>(await stored(page)).length).toBe(2);
 const saved=await stored(page);
 expect(saved.some(event=>event.before==='Привет 👋\nИграю в 23:00'&&event.after===''&&event.source==='pipeline')).toBe(true);
 expect(profileReads(await fixture(page))).toEqual([]);expect((await fixture(page)).resolves).toEqual([]);
 await openFeed(page);await expect(rows(page)).toHaveCount(2);
 expect(new Set((await stored(page)).map(event=>event.id))).toEqual(new Set(saved.map(event=>event.id)));
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.emitUpdate({status:'active'}));
 await expect(rows(page)).toHaveCount(2);
 expect(profileReads(await fixture(page))).toEqual([]);expect((await fixture(page)).unexpected).toEqual([]);
});

test('failed file resolution leaves an observed image event and never retries it merely because time passes',async({page})=>{
 await page.clock.install();await openFeed(page);
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.setResolveMode(f.newFile,'failure');f.emitUpdate({currentAvatarImageUrl:f.newImage});});
 await expect(rows(page)).toHaveCount(1);await settleMetadata(page);
 const event=(await avatarEvents(page))[0];expect(event.avatarName).toBeUndefined();expect(event).toMatchObject({source:'pipeline'});
 const calls=(await fixture(page)).resolves.length;await page.clock.fastForward(3_600_100);
 expect((await fixture(page)).resolves).toHaveLength(calls);expect((await avatarEvents(page))[0].id).toBe(event.id);
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.emitUpdate({currentAvatarImageUrl:f.otherImage});});
 await expect(feed(page).getByRole('button',{name:'Найти аватар Солнечный Лис в AvatarDB',exact:true})).toBeVisible();
 expect(await avatarEvents(page)).toHaveLength(2);expect(profileReads(await fixture(page))).toEqual([]);expect((await fixture(page)).unexpected).toEqual([]);
});

test('legacy unconfirmed trust noise stays out of the feed after reload while raw history and confirmed changes are preserved',async({page})=>{
 await page.clock.install();await openFeed(page);
 await page.evaluate(async()=>{
  const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;
  const common={time:'2026-10-27T08:00:00.000Z',userId:f.friendId,detail:'Изменились доступные Trust Rank теги'};
  await f.seedStored([
   {...common,id:'legacy-empty-noise',kind:'trust',source:'sync',displayName:'Synthetic Legacy Noise',before:'',after:'system_trust_known'},
   {...common,id:'legacy-equivalent-noise',kind:'trust',source:'profile',displayName:'Synthetic Legacy Noise',before:'system_trust_basic,system_trust_known',after:'system_trust_known'},
   {...common,id:'legacy-real-rank',kind:'trust',source:'pipeline',displayName:'Synthetic Legacy Rank',before:'system_trust_basic',after:'system_trust_basic,system_trust_known'},
   {...common,id:'legacy-real-bio',kind:'bio',source:'sync',displayName:'Synthetic Legacy Bio',detail:'Биография обновлена',before:'Историческое био',after:'Сохранённое историческое био'},
  ]);
 });
 await openFeed(page);await expect(rows(page)).toHaveCount(2);
 await expect(rows(page).filter({hasText:'Synthetic Legacy Noise'})).toHaveCount(0);
 await expect(rows(page).filter({hasText:'Synthetic Legacy Rank'})).toHaveCount(1);
 await expect(rows(page).filter({hasText:'Сохранённое историческое био'})).toHaveCount(1);
 expect((await stored(page)).map(event=>event.id).sort()).toEqual(['legacy-empty-noise','legacy-equivalent-noise','legacy-real-bio','legacy-real-rank']);
 await openFeed(page);await expect(rows(page)).toHaveCount(2);expect(await stored(page)).toHaveLength(4);
 expect(profileReads(await fixture(page))).toEqual([]);await checkNoHorizontalOverflow(page);expect((await fixture(page)).unexpected).toEqual([]);
});
