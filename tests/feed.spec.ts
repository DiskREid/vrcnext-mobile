import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';

type FeedEvent={id:string;kind:string;before?:string;after?:string;avatarName?:string;avatarId?:string;avatarEvidence?:string;avatarUrl?:string};
type FeedFixture={friendId:string;requests:{path:string;method:string;time:number}[];searches:{query:string;page:number}[];unexpected:string[];connected:boolean;changeProfile:(change:Record<string,string>)=>void;emitAvatar:()=>void;emitSignal:()=>void;failNextProfile:(status?:number,retryAfter?:number)=>void;setActive:(value:boolean)=>void;stored:()=>Promise<FeedEvent[]>};
async function fixture(page:Page){return page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest);}
async function stored(page:Page){return page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.stored());}
const feed=(page:Page)=>page.locator('[data-screen="feed"]');
const rows=(page:Page)=>feed(page).locator('.history-row');
async function openFeed(page:Page){
 await page.goto('/tests/feed-harness.html');
 await expect(page.getByRole('heading',{name:'Привет, Synthetic Feed Self ✦',exact:true})).toBeVisible();
 await page.locator('nav[aria-label="Основная навигация"]:visible').getByRole('button',{name:'Ещё',exact:true}).click();
 await page.getByRole('button',{name:/^Лента /}).click();
 await expect(feed(page).getByRole('heading',{name:'Лента',exact:true})).toBeVisible();
 await expect(feed(page).getByRole('region',{name:'Проверка профилей друзей',exact:true})).toContainText('Проверено: 1 из 1');
 await expect.poll(async()=>(await fixture(page)).connected).toBe(true);
}
async function checkNoHorizontalOverflow(page:Page){
 const sizes=await page.evaluate(()=>[document.documentElement,document.querySelector('.main-content'),...document.querySelectorAll('.modal')].filter(Boolean).map(element=>({width:element!.clientWidth,scroll:element!.scrollWidth})));
 for(const value of sizes)expect(value.scroll).toBeLessThanOrEqual(value.width+1);
}

test('feed observes a limited-image update, enriches that same event with the real avatar name and Bio, and searches only after a click',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.install();await openFeed(page);
 await expect(rows(page)).toHaveCount(0);expect(await stored(page)).toEqual([]);
 expect((await fixture(page)).requests.filter(request=>/^\/users\/[^/]+$/.test(request.path))).toEqual([]);
 expect((await fixture(page)).searches).toEqual([]);
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.changeProfile({bio:'Привет 👋\nИграю в 22:30',currentAvatar:'avtr_feed-new',currentAvatarName:'Лунный Лис',currentAvatarAuthorName:'Synthetic Moon Author',currentAvatarImageUrl:'https://api.vrchat.cloud/api/1/file/file_feed-new/1/file',currentAvatarThumbnailImageUrl:'https://api.vrchat.cloud/api/1/image/file_feed-new/1/256'});f.emitAvatar();});
 await expect(rows(page)).toHaveCount(1);
 await expect(rows(page).first()).toContainText('Изображение аватара');
 await expect.poll(async()=>(await stored(page)).filter(event=>event.kind==='avatar').length).toBe(1);
 const initialAvatar=(await stored(page)).find(event=>event.kind==='avatar')!;
 // The profile scheduler coalesces recent signals for two minutes instead of polling each WS event.
 await page.clock.fastForward(120_100);
 const avatarButton=feed(page).getByRole('button',{name:'Найти аватар Лунный Лис в AvatarDB',exact:true});
 await expect(avatarButton).toBeVisible();
 await expect(rows(page)).toHaveCount(2);
 await expect.poll(async()=>(await stored(page)).find(event=>event.kind==='avatar')?.avatarName).toBe('Лунный Лис');
 const avatarEvents=(await stored(page)).filter(event=>event.kind==='avatar');
 expect(avatarEvents).toHaveLength(1);expect(avatarEvents[0]).toMatchObject({id:initialAvatar.id,avatarId:'avtr_feed-new',avatarEvidence:'id',before:'avtr_feed-old',after:'avtr_feed-new',avatarName:'Лунный Лис'});
 const avatarRow=rows(page).filter({has:page.getByRole('button',{name:'Найти аватар Лунный Лис в AvatarDB',exact:true})});
 await expect(avatarRow).toContainText('Synthetic Moon Author');
 await expect(avatarRow.locator('.history-avatar-preview')).toHaveAttribute('alt','Лунный Лис');
 const bio=rows(page).filter({has:page.locator('.history-bio-current')});
 await expect(bio).toContainText('Играю в 22:30');
 await expect(bio.locator('.bio-diff')).toHaveCount(0);
 await bio.locator('summary').click();
 await expect(bio.locator('del')).toContainText('22');
 await expect(bio.locator('ins')).toContainText('30');
 await bio.scrollIntoViewIfNeeded();
 await page.screenshot({path:`artifacts/regressions/${info.project.name}-feed-avatar-bio-synthetic-fixture.png`});
 expect((await fixture(page)).searches).toEqual([]);
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

test('manual public profile checks detect Bio changes and clearing without opening a profile, and persist them across reload',async({page})=>{
 await page.clock.install();await openFeed(page);
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.changeProfile({bio:'Привет 👋\nИграю в 23:00'}));
 await feed(page).getByRole('button',{name:'Проверить профили',exact:true}).click();
 await page.clock.fastForward(10_100);
 await expect(rows(page)).toHaveCount(1);
 await expect(rows(page).first()).toContainText('Играю в 23:00');
 await expect.poll(async()=>(await stored(page)).filter(event=>event.kind==='bio').length).toBe(1);
 expect((await fixture(page)).requests.filter(request=>/^\/users\/[^/]+$/.test(request.path))).toEqual([]);
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.changeProfile({bio:''}));
 await feed(page).getByRole('button',{name:'Проверить профили',exact:true}).click();
 await page.clock.fastForward(10_100);
 await expect(rows(page)).toHaveCount(2);await expect(rows(page).first()).toContainText('Био очищено');
 await rows(page).first().locator('summary').click();
 await expect(rows(page).first().locator('del')).toContainText('Привет');
 await expect.poll(async()=>(await stored(page)).filter(event=>event.kind==='bio').length).toBe(2);
 const saved=(await stored(page)).filter(event=>event.kind==='bio');
 expect(saved.some(event=>event.before==='Привет 👋\nИграю в 23:00'&&event.after==='')).toBe(true);
 await openFeed(page);
 await expect(rows(page)).toHaveCount(2);
 const restored=(await stored(page)).filter(event=>event.kind==='bio');
 expect(new Set(restored.map(event=>event.id))).toEqual(new Set(saved.map(event=>event.id)));
 expect((await fixture(page)).unexpected).toEqual([]);await checkNoHorizontalOverflow(page);
});

test('a failed profile read retains the Bio baseline, then retries safely and does not manufacture changes while backgrounded',async({page})=>{
 await page.clock.install();await openFeed(page);
 await page.evaluate(()=>{const f=(window as unknown as {__feedTest:FeedFixture}).__feedTest;f.changeProfile({bio:'Активное изменение'});f.failNextProfile(503);});
 await feed(page).getByRole('button',{name:'Проверить профили',exact:true}).click();await page.clock.fastForward(10_100);
 await expect(feed(page).getByRole('alert')).toContainText('Synthetic public profile unavailable');
 await expect(rows(page)).toHaveCount(0);expect(await stored(page)).toEqual([]);
 await page.clock.fastForward(120_100);
 await expect(rows(page)).toHaveCount(1);
 await expect(feed(page).getByRole('alert')).toHaveCount(0);
 await expect.poll(async()=>(await stored(page)).length).toBe(1);
 expect((await stored(page))[0]).toMatchObject({kind:'bio',before:'Привет 👋\nИграю в 22:22',after:'Активное изменение'});
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.setActive(false));
 const profiles=(await fixture(page)).requests.filter(request=>request.path.startsWith('/profile/')).length;
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.changeProfile({bio:'Изменено в фоне'}));
 await page.clock.fastForward(600_100);
 expect((await fixture(page)).requests.filter(request=>request.path.startsWith('/profile/'))).toHaveLength(profiles);
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.setActive(true));
 await page.clock.fastForward(10_100);
 await expect(feed(page).getByRole('region',{name:'Проверка профилей друзей',exact:true})).toContainText('Проверено: 1 из 1');
 await expect(rows(page)).toHaveCount(1);
 await page.evaluate(()=>(window as unknown as {__feedTest:FeedFixture}).__feedTest.changeProfile({bio:'Снова в открытом приложении'}));
 await feed(page).getByRole('button',{name:'Проверить профили',exact:true}).click();await page.clock.fastForward(10_100);
 await expect(rows(page)).toHaveCount(2);
 await expect.poll(async()=>(await stored(page)).length).toBe(2);
 expect((await stored(page)).some(event=>event.before==='Изменено в фоне'&&event.after==='Снова в открытом приложении')).toBe(true);
 const times=(await fixture(page)).requests.filter(request=>request.path.startsWith('/profile/')).map(request=>request.time);
 for(let index=1;index<times.length;index++)expect(times[index]-times[index-1]).toBeGreaterThanOrEqual(10_000);
 expect((await fixture(page)).unexpected).toEqual([]);
});
