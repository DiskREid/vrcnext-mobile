import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';

type GroupsFixture={requests:{path:string;method:string}[];unexpected:string[];actions:{type:string;id:string}[];ids:{early:string;late:string;pending:string;other:string;hidden:string};selfId:string;friendId:string;holdGroupNext:boolean;heldGroup:boolean;memberOverrides:Record<string,{membershipStatus:string}|null>;releaseGroup:()=>void};
async function fixture(page:Page){return page.evaluate(()=>(window as unknown as {__profileGroupsTest:GroupsFixture}).__profileGroupsTest);}
async function openGroups(page:Page,scenario='paged'){
  await page.goto('/tests/profile-groups-harness.html?scenario='+scenario);
  const dialog=page.getByRole('dialog',{name:'Профиль',exact:true});
  await expect(dialog.getByRole('heading',{name:'Synthetic Group Friend',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Группы',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Общие группы',exact:true})).toBeVisible();
  return dialog;
}
async function noHorizontalOverflow(page:Page){
  const sizes=await page.evaluate(()=>({document:[document.documentElement.scrollWidth,document.documentElement.clientWidth],modal:[document.querySelector<HTMLElement>('.modal')?.scrollWidth||0,document.querySelector<HTMLElement>('.modal')?.clientWidth||0]}));
  expect(sizes.document[0]).toBeLessThanOrEqual(sizes.document[1]+1);
  expect(sizes.modal[0]).toBeLessThanOrEqual(sizes.modal[1]+1);
}

test('profile common groups merge own membership and paged evidence with canonical nested group IDs',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const dialog=await openGroups(page);
  const early=dialog.locator('.list-row').filter({hasText:'Synthetic Shared Early'});
  const nested=dialog.locator('.list-row').filter({hasText:'Synthetic Shared Nested'});
  const pending=dialog.locator('.list-row').filter({hasText:'Synthetic Pending Membership'});
  const other=dialog.locator('.list-row').filter({hasText:'Synthetic Friend Only'});
  await expect(early).toContainText('Общая');
  await expect(nested).toContainText('Общая');
  await expect(pending).toBeVisible();await expect(pending).not.toContainText('Общая');
  await expect(other).toBeVisible();await expect(other).not.toContainText('Общая');
  const initial=await fixture(page);
  expect(initial.requests.filter(request=>request.path.startsWith('/groups/'))).toEqual([]);
  expect(initial.requests.filter(request=>request.path===`/users/${initial.selfId}/groups`)).toHaveLength(1);
  await dialog.getByRole('button',{name:'Общие группы',exact:true}).click();
  await dialog.getByRole('searchbox',{name:'Поиск по группам пользователя',exact:true}).fill('Synthetic Shared');
  await expect(early).toBeVisible();await expect(nested).toBeVisible();
  await expect(dialog.locator('.list-row').filter({hasText:'Synthetic Shared Hidden'})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Загрузить ещё',exact:true}).click();
  const hidden=dialog.locator('.list-row').filter({hasText:'Synthetic Shared Hidden'});
  await expect(hidden).toBeVisible();await expect(hidden).toContainText('Общая');
  await expect(dialog.locator('.list-row')).toHaveCount(3);
  expect((await fixture(page)).requests.some(request=>request.path.includes('/mutuals/groups?n=100&offset=100'))).toBe(true);
  await page.screenshot({path:`artifacts/regressions/${testInfo.project.name}-common-groups-synthetic-fixture.png`});
  await nested.click();
  const group=page.getByRole('dialog',{name:'Synthetic Shared Nested',exact:true});
  await expect(group.getByRole('button',{name:'Вы участник · выйти',exact:true})).toBeVisible();
  await expect(group.getByRole('button',{name:'Вступить в группу',exact:true})).toHaveCount(0);
  expect((await fixture(page)).actions.at(-1)).toEqual({type:'group',id:initial.ids.late});
  expect((await fixture(page)).requests.filter(request=>request.path.startsWith('/groups/'))).toHaveLength(1);
  await noHorizontalOverflow(page);expect(errors).toEqual([]);expect((await fixture(page)).unexpected).toEqual([]);
});

test('own membership intersection remains usable when mutual groups endpoint is denied',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const dialog=await openGroups(page,'denied');
  const nested=dialog.locator('.list-row').filter({hasText:'Synthetic Shared Nested'});
  await expect(nested).toContainText('Общая');
  await dialog.getByRole('button',{name:'Общие группы',exact:true}).click();
  await expect(nested).toBeVisible();
  await expect(dialog.locator('.list-row').filter({hasText:'Synthetic Shared Early'})).toBeVisible();
  await expect(dialog.locator('.list-row').filter({hasText:'Synthetic Friend Only'})).toHaveCount(0);
  await expect(dialog.locator('.list-row').filter({hasText:'Synthetic Pending Membership'})).toHaveCount(0);
  await expect(dialog.getByRole('alert').first()).toBeVisible();
  await expect(dialog.getByText('Нет доступных общих групп',{exact:true})).toHaveCount(0);
  const state=await fixture(page);
  expect(state.requests.filter(request=>request.path.startsWith('/groups/'))).toEqual([]);
  await noHorizontalOverflow(page);expect(errors).toEqual([]);expect(state.unexpected).toEqual([]);
});

test('direct mutual-group evidence survives failed lookup sources without claiming the other memberships',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const dialog=await openGroups(page,'unavailable');
  await expect(dialog.locator('.list-row').filter({hasText:'Synthetic Shared Nested'})).toBeVisible();
  await expect(dialog.locator('.list-row').filter({hasText:'Synthetic Shared Nested'})).not.toContainText('Общая');
  await expect(dialog.locator('.list-row').filter({hasText:'Synthetic Shared Early'})).toContainText('Общая');
  await dialog.getByRole('button',{name:'Общие группы',exact:true}).click();
  await expect(dialog.locator('.list-row').filter({hasText:'Synthetic Shared Early'})).toBeVisible();
  await expect(dialog.getByRole('alert').first()).toBeVisible();
  await expect(dialog.getByText('Нет доступных общих групп',{exact:true})).toHaveCount(0);
  await expect(dialog.getByText('Вы не состоите в группе',{exact:true})).toHaveCount(0);
  const state=await fixture(page);
  expect(state.requests.filter(request=>request.path.startsWith('/groups/'))).toEqual([]);
  await noHorizontalOverflow(page);expect(errors).toEqual([]);expect(state.unexpected).toEqual([]);
});


test('group details wait for unknown membership and apply a fresh server result over an old common hint',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const dialog=await openGroups(page,'recheck');
  await expect(dialog.locator('.list-row').filter({hasText:'Synthetic Friend Only'})).toBeVisible();
  await page.evaluate(()=>(window as unknown as {__profileGroupsTest:GroupsFixture}).__profileGroupsTest.holdGroupNext=true);
  await dialog.locator('.list-row').filter({hasText:'Synthetic Friend Only'}).click();
  const unknown=page.getByRole('dialog',{name:'Synthetic Friend Only',exact:true});
  await expect.poll(async()=>(await fixture(page)).heldGroup).toBe(true);
  await expect(unknown.getByRole('button',{name:'Проверяем участие…',exact:true})).toBeDisabled();
  await expect(unknown.getByRole('button',{name:'Вступить в группу',exact:true})).toHaveCount(0);
  await page.evaluate(()=>(window as unknown as {__profileGroupsTest:GroupsFixture}).__profileGroupsTest.releaseGroup());
  await expect(unknown.getByRole('button',{name:'Вы участник · выйти',exact:true})).toBeVisible();
  await unknown.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.evaluate(()=>{const state=(window as unknown as {__profileGroupsTest:GroupsFixture}).__profileGroupsTest;state.memberOverrides[state.ids.early]=null;});
  await dialog.locator('.list-row').filter({hasText:'Synthetic Shared Early'}).click();
  const common=page.getByRole('dialog',{name:'Synthetic Shared Early',exact:true});
  await expect(common.getByRole('button',{name:'Вступить в группу',exact:true})).toBeVisible();
  await expect(common.getByRole('button',{name:'Вы участник · выйти',exact:true})).toHaveCount(0);
  const state=await fixture(page);
  expect(state.requests.every(request=>request.method==='GET')).toBe(true);
  await noHorizontalOverflow(page);expect(errors).toEqual([]);expect(state.unexpected).toEqual([]);
});
