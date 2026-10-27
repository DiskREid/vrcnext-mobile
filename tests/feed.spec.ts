import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';

type FeedEvent={id:string;kind:string;time?:string;userId?:string;displayName?:string;detail?:string;source?:string;before?:string;after?:string;avatarName?:string;avatarId?:string;avatarEvidence?:string;avatarUrl?:string};
type FeedFixture={friendId:string;oldFile:string;newFile:string;otherFile:string;oldImage:string;newImage:string;otherImage:string;requests:{path:string;method:string;time:number}[];resolves:{fileId:string;time:number}[];searches:{query:string;page:number}[];unexpected:string[];connected:boolean;held:boolean;emitUpdate:(user:Record<string,unknown>)=>void;emitEvent:(type:string,user?:Record<string,unknown>)=>void;changeProfile:(change:Record<string,unknown>)=>void;failNextResolve:(status?:number,retryAfter?:number)=>void;holdNextResolve:()=>void;releaseResolve:()=>void;setActive:(value:boolean)=>void;seedStored:(events:FeedEvent[])=>Promise<void>;stored:()=>Promise<FeedEvent[]>};
async function fixture(page:Page){return page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest);}
async function stored(page:Page){return page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.stored());}
const feed=(page:Page)=>page.locator('[data-screen="feed"]');
const rows=(page:Page)=>feed(page).locator('.history-row');
const profileReads=(value:FeedFixture)=>value.requests.filter(request=>request.path.startsWith('/profile/'));
async function openFeed(page:Page){
 await page.goto('/tests/feed-harness.html');
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

test('an avatar change event resolves only its file ID and updates the original row; Bio comes directly from received fields',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.install();await openFeed(page);
 await expect(rows(page)).toHaveCount(0);expect(await stored(page)).toEqual([]);
 expect(profileReads(await fixture(page))).toEqual([]);expect((await fixture(page)).resolves).toEqual([]);
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.emitUpdate({bio:'Привет 👋\nИграю в 22:22',tags:['system_trust_known']}));
 await expect(rows(page)).toHaveCount(0);
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.holdNextResolve();f.emitUpdate({bio:'Привет 👋\nИграю в 22:30',currentAvatarImageUrl:f.newImage});});
 await expect(rows(page)).toHaveCount(2);
 await expect.poll(async()=>(await fixture(page)).held).toBe(true);
 await expect.poll(async()=>(await stored(page)).filter(event=>event.kind==='avatar').length).toBe(1);
 const initialAvatar=(await stored(page)).find(event=>event.kind==='avatar')!;
 expect(initialAvatar).toMatchObject({source:'pipeline',avatarEvidence:'image',before:(await fixture(page)).oldImage,after:(await fixture(page)).newImage});
 expect(initialAvatar.avatarName).toBeUndefined();
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.releaseResolve());
 const avatarButton=feed(page).getByRole('button',{name:'Найти аватар Лунный Лис в AvatarDB',exact:true});
 await expect(avatarButton).toBeVisible();
 await expect(rows(page)).toHaveCount(2);
 await expect.poll(async()=>(await stored(page)).find(event=>event.kind==='avatar')?.avatarName).toBe('Лунный Лис');
 const avatarEvents=(await stored(page)).filter(event=>event.kind==='avatar');
 expect(avatarEvents).toHaveLength(1);expect(avatarEvents[0]).toMatchObject({id:initialAvatar.id,time:initialAvatar.time,avatarId:'avtr_feed-new',avatarName:'Лунный Лис',source:'pipeline'});
 const avatarRow=rows(page).filter({has:page.getByRole('button',{name:'Найти аватар Лунный Лис в AvatarDB',exact:true})});
 await expect(avatarRow).toContainText('Synthetic Moon Author');
 await expect(avatarRow.locator('.history-avatar-preview')).toHaveAttribute('alt','Лунный Лис');
 const bio=rows(page).filter({has:page.locator('.history-bio-current')});
 await expect(bio).toContainText('Играю в 22:30');await expect(bio.locator('.bio-diff')).toHaveCount(0);
 await bio.locator('summary').click();await expect(bio.locator('del')).toContainText('22');await expect(bio.locator('ins')).toContainText('30');
 await bio.scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts/regressions/${info.project.name}-feed-event-avatar-bio-synthetic-fixture.png`});
 const beforeSearch=await fixture(page);
 expect(beforeSearch.resolves).toEqual([{fileId:beforeSearch.newFile,time:expect.any(Number)}]);
 expect(beforeSearch.searches).toEqual([]);expect(profileReads(beforeSearch)).toEqual([]);
 await avatarButton.click();
 const search=page.getByRole('dialog',{name:'Поиск аватара в AvatarDB',exact:true});
 await expect(search).toBeVisible();await expect(search.getByRole('button',{name:'Открыть аватар Лунный Лис',exact:true})).toBeVisible();
 expect((await fixture(page)).searches).toEqual([{query:'Лунный Лис',page:0,time:expect.any(Number)}]);
 await search.getByRole('button',{name:'Закрыть',exact:true}).click();
 await avatarRow.getByRole('button',{name:'Открыть профиль Synthetic Feed Friend',exact:true}).click();
 const profile=page.getByRole('dialog',{name:'Профиль',exact:true});
 await expect(profile.getByRole('heading',{name:'Synthetic Feed Friend',exact:true})).toBeVisible();
 await profile.getByRole('button',{name:'Закрыть',exact:true}).click();
 expect((await stored(page)).filter(event=>event.kind==='avatar')).toHaveLength(1);
 await checkNoHorizontalOverflow(page);expect((await fixture(page)).unexpected).toEqual([]);expect(errors).toEqual([]);
});

test('idle time, generic friend events and feed refresh never scan public profiles or resolve unchanged avatars',async({page})=>{
 await page.clock.install();await openFeed(page);
 expect(profileReads(await fixture(page))).toEqual([]);expect((await fixture(page)).resolves).toEqual([]);
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.changeProfile({bio:'Not sent in any event'});f.emitUpdate({status:'active',tags:['system_trust_known']});f.emitUpdate({tags:['system_trust_basic','system_trust_known']});f.emitEvent('friend-online');f.emitEvent('friend-active');
  // Hidden/loading placeholders must neither replace the real avatar baseline
  // nor turn its reappearance into an avatar change or an AvatarDB request.
  f.emitUpdate({currentAvatarImageUrl:'https://api.vrchat.cloud/api/1/file/file_0e8c4e32-7444-44ea-ade4-313c010d4bae/1/file'});
  f.emitUpdate({currentAvatarImageUrl:'https://api.vrchat.cloud/api/1/image/file_31255e6b-696e-4c11-b007-595fa1142467/2/256'});
  f.emitUpdate({currentAvatarImageUrl:f.oldImage});});
 await page.clock.fastForward(3_600_100);
 await page.getByRole('button',{name:'Обновить данные',exact:true}).click();
 await page.clock.fastForward(3_600_100);
 const state=await fixture(page);
 expect(profileReads(state)).toEqual([]);expect(state.resolves).toEqual([]);expect(state.searches).toEqual([]);
 expect((await stored(page)).filter(event=>['avatar','bio','trust'].includes(event.kind))).toEqual([]);
 expect(state.unexpected).toEqual([]);await checkNoHorizontalOverflow(page);
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

test('failed avatar resolution keeps the event without scanning profiles or repeatedly retrying while idle',async({page})=>{
 await page.clock.install();await openFeed(page);
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.failNextResolve(503);f.emitUpdate({currentAvatarImageUrl:f.newImage});});
 await expect(rows(page)).toHaveCount(1);
 await expect.poll(async()=>(await fixture(page)).resolves.length).toBe(1);
 await expect.poll(async()=>(await stored(page)).length).toBe(1);
 const event=(await stored(page))[0];expect(event).toMatchObject({kind:'avatar',source:'pipeline'});expect(event.avatarName).toBeUndefined();
 await page.clock.fastForward(3_600_100);
 expect((await fixture(page)).resolves).toHaveLength(1);expect(profileReads(await fixture(page))).toEqual([]);
 expect((await stored(page))[0].id).toBe(event.id);
 // A new changed file is its own event and still resolves after the earlier failure.
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.emitUpdate({currentAvatarImageUrl:(window as unknown as {__feedTest:FeedFixture}).__feedTest.otherImage}));
 await expect(rows(page)).toHaveCount(2);
 await expect(feed(page).getByRole('button',{name:'Найти аватар Солнечный Лис в AvatarDB',exact:true})).toBeVisible();
 expect(profileReads(await fixture(page))).toEqual([]);expect((await fixture(page)).unexpected).toEqual([]);
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
