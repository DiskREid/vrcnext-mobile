import {test,expect} from '@playwright/test';
import type {Locator,Page} from '@playwright/test';

const graphOf=(page:Page)=>page.getByRole('img',{name:'Граф общих друзей',exact:true});
const websiteOf=(svg:Locator)=>svg.getByRole('button',{name:'Открыть профиль Website Friend',exact:true});
async function graphFixture(page:Page){
 await page.goto('/tests/network-harness.html');
 await page.getByRole('button',{name:'Граф',exact:true}).click();
 const svg=graphOf(page);await expect(svg.locator('.network-node')).toHaveCount(4);
 await svg.scrollIntoViewIfNeeded();
 return svg;
}
async function nodePoint(node:Locator){
 const circle=await node.locator('.network-node-disc').boundingBox();
 if(!circle)throw new Error('Graph node has no visible circle');
 return{x:circle.x+circle.width/2,y:circle.y+circle.height/2};
}
async function pointer(target:Locator,type:string,id:number,point:{x:number;y:number}){
 await target.dispatchEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',clientX:point.x,clientY:point.y,button:0,buttons:type==='pointerup'||type==='pointercancel'?0:1});
}
async function compatibilityClick(svg:Locator,point:{x:number;y:number}){
 await svg.dispatchEvent('click',{bubbles:true,cancelable:true,detail:1,clientX:point.x,clientY:point.y,button:0});
}
async function shortTap(svg:Locator,node:Locator,id:number){
 const point=await nodePoint(node);
 await pointer(node,'pointerdown',id,point);await pointer(svg,'pointerup',id,point);
 await compatibilityClick(svg,point);
}
async function holdNode(page:Page,svg:Locator,node:Locator,id=41){
 const point=await nodePoint(node);
 await pointer(node,'pointerdown',id,point);
 await expect(node).toHaveClass(/\bselected\b/);
 await pointer(svg,'pointerup',id,point);
 await compatibilityClick(svg,point);
 await expect(page.getByRole('dialog',{name:'Профиль',exact:true})).toHaveCount(0);
}
async function graphPlacement(svg:Locator){
 await svg.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
 return svg.evaluate(element=>({
  box:(()=>{const rect=element.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height};})(),
  view:element.querySelector('.network-scene')!.getAttribute('transform'),
  nodes:[...element.querySelectorAll('.network-node')].map(node=>({id:node.getAttribute('data-network-id'),position:node.getAttribute('transform')})),
 }));
}

test('graph shows cached circular avatars and every nickname, opens profiles directly and has one scan action',async({page})=>{
 await page.goto('/tests/network-harness.html');
 await expect(page.getByRole('heading',{name:'Mutual Friend Network',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Граф',exact:true}).click();
 // Keep the user-visible graph name stable for accessibility.
 const svg=page.getByRole('img',{name:'Граф общих друзей',exact:true});
 await expect(svg.locator('.network-node')).toHaveCount(4);
 await expect(svg.locator('.network-label')).toHaveCount(4);
 for(const name of ['Network Self','Website Friend','Game Friend','Offline Friend'])await expect(svg.locator('.network-label').filter({hasText:name})).toBeVisible();
 const friend=svg.getByRole('button',{name:'Открыть профиль Website Friend',exact:true});
 const avatar=friend.locator('foreignObject .avatar img');
 await expect.poll(()=>avatar.evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth)).toBe(64);
 await friend.press('Enter');
 const profile=page.getByRole('dialog',{name:'Профиль',exact:true});
 await expect(profile.getByRole('heading',{name:'Website Friend',exact:true})).toBeVisible();
 await profile.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:'Список',exact:true}).click();
 await page.getByRole('button',{name:'Выбрать Website Friend',exact:true}).click();
 await expect(page.getByRole('button',{name:'Проверить общих друзей',exact:true})).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Проверить связи',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Проверить общих друзей',exact:true}).click();
 await expect(page.getByText(/Получено общих друзей: 2/)).toBeVisible();
 await page.getByRole('button',{name:'Показать связи',exact:true}).click();
 await expect(svg.locator('.network-node')).toHaveCount(4);
 await expect(svg.locator('.network-edges line')).toHaveCount(0);
 const counts=await svg.locator('.network-edges path').evaluateAll(paths=>paths.map(path=>Number(path.getAttribute('data-edge-count'))));
 expect(counts.reduce((sum,count)=>sum+count,0)).toBe(5);
 expect(counts.length).toBeLessThan(5);
});

test('pointer frames move only the scene transform and never rebuild graph content or open a dragged profile',async({page})=>{
 await page.goto('/tests/network-harness.html');
 await page.getByRole('button',{name:'Граф',exact:true}).click();
 const svg=page.getByRole('img',{name:'Граф общих друзей',exact:true});
 await expect(svg.locator('.network-node')).toHaveCount(4);
 await expect.poll(()=>svg.locator('.network-scene').getAttribute('transform')).not.toBeNull();
 await expect.poll(()=>svg.locator('.network-avatar img').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0))).toBe(true);
 await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
 const result=await svg.evaluate(async(svg)=>{
  const scene=svg.querySelector('.network-scene')!;
  const start=scene.getAttribute('transform');
  let contentMutations=0;
  const observer=new MutationObserver(records=>{contentMutations+=records.filter(record=>record.target!==scene).length;});
  observer.observe(scene,{attributes:true,childList:true,subtree:true});
  const rect=svg.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  const point=(type:string,dx:number)=>svg.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:91,pointerType:'touch',clientX:x+dx,clientY:y,button:0,buttons:type==='pointerup'?0:1}));
  point('pointerdown',0);
  for(let i=1;i<=12;i++){point('pointermove',i*4);await new Promise(requestAnimationFrame);}
  await new Promise(requestAnimationFrame);
  const during={start,end:scene.getAttribute('transform'),contentMutations};
  observer.disconnect();point('pointerup',48);
  return during;
 });
 expect(result.end).not.toBe(result.start);
 expect(result.contentMutations).toBe(0);
 await expect(page.getByRole('dialog',{name:'Профиль',exact:true})).toHaveCount(0);
});

test('a short touch opens the full profile, while a hold highlights only direct connections and does not open a profile on release',async({page})=>{
 const svg=await graphFixture(page),friend=websiteOf(svg);
 await shortTap(svg,friend,40);
 const profile=page.getByRole('dialog',{name:'Профиль',exact:true});
 await expect(profile.getByRole('heading',{name:'Website Friend',exact:true})).toBeVisible();
 await profile.getByRole('button',{name:'Закрыть',exact:true}).click();
 const selection=page.getByRole('region',{name:'Выбранный пользователь',exact:true});
 const beforeCard=await selection.textContent(),beforePlacement=await graphPlacement(svg);
 await holdNode(page,svg,friend);
 expect(await selection.textContent()).toBe(beforeCard);
 expect(await graphPlacement(svg)).toEqual(beforePlacement);
 await expect(svg.locator('.network-node.selected')).toHaveCount(1);
 await expect(svg.locator('.network-node.neighbor')).toHaveCount(1);
 await expect(svg.locator('.network-node.dimmed')).toHaveCount(2);
 const paths=await svg.locator('.network-edges path').evaluateAll(elements=>elements.map(path=>({count:Number(path.getAttribute('data-edge-count')),selected:path.classList.contains('selected-edge'),dimmed:path.classList.contains('dimmed')})));
 expect(paths.filter(path=>path.selected).reduce((count,path)=>count+path.count,0)).toBe(1);
 expect(paths.filter(path=>path.dimmed).reduce((count,path)=>count+path.count,0)).toBe(2);
 // A completed hold must not disable the next ordinary tap on that same person.
 await shortTap(svg,friend,42);
 await expect(profile.getByRole('heading',{name:'Website Friend',exact:true})).toBeVisible();
});

test('holding another person preserves the focused neighborhood, its placement and the scan selection above the graph',async({page})=>{
 await graphFixture(page);
 await page.getByRole('button',{name:'Список',exact:true}).click();
 await page.getByRole('button',{name:'Выбрать Website Friend',exact:true}).click();
 await page.getByRole('button',{name:'Проверить общих друзей',exact:true}).click();
 await expect(page.getByText(/Получено общих друзей: 2/)).toBeVisible();
 await page.getByRole('button',{name:'Показать связи',exact:true}).click();
 const svg=graphOf(page);await expect(svg.locator('.network-node')).toHaveCount(4);
 await svg.scrollIntoViewIfNeeded();
 const selection=page.getByRole('region',{name:'Выбранный пользователь',exact:true});
 await expect(selection.getByRole('heading',{name:'Website Friend',exact:true})).toHaveCount(1);
 const beforeCard=await selection.textContent(),beforePlacement=await graphPlacement(svg);
 const other=svg.getByRole('button',{name:'Открыть профиль Offline Friend',exact:true});
 await holdNode(page,svg,other,45);
 await expect(svg.locator('.network-node.selected')).toHaveAttribute('data-network-id','usr_graph-offline');
 expect(await selection.textContent()).toBe(beforeCard);
 expect(await graphPlacement(svg)).toEqual(beforePlacement);
 await expect(page.getByRole('combobox',{name:'Друг для проверки связей',exact:true})).toHaveValue('usr_graph-website');
});

for(const interruption of ['drag','second touch','pointer cancel'] as const){
 test(`${interruption} cancels the node hold without highlighting connections or opening a profile`,async({page})=>{
  const svg=await graphFixture(page),friend=websiteOf(svg),start=await nodePoint(friend);
  await pointer(friend,'pointerdown',51,start);
  if(interruption==='drag')await pointer(svg,'pointermove',51,{x:start.x+24,y:start.y+8});
  if(interruption==='second touch')await pointer(svg,'pointerdown',52,{x:start.x+70,y:start.y});
  if(interruption==='pointer cancel')await pointer(svg,'pointercancel',51,start);
  // Wait beyond the recognition threshold: the cancelled timer must stay cancelled.
  await page.waitForTimeout(650);
  await expect(svg.locator('.network-node.selected')).toHaveCount(0);
  if(interruption==='second touch')await pointer(svg,'pointerup',52,{x:start.x+70,y:start.y});
  if(interruption!=='pointer cancel')await pointer(svg,'pointerup',51,interruption==='drag'?{x:start.x+24,y:start.y+8}:start);
  await compatibilityClick(svg,start);
  await expect(page.getByRole('dialog',{name:'Профиль',exact:true})).toHaveCount(0);
 });
}

test('full-screen graph fills the viewport, keeps focus and touch controls, and Back closes only the top screen',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await graphFixture(page);
 const before=await page.evaluate(()=>document.body.style.overflow);
 await page.getByRole('button',{name:'На весь экран',exact:true}).click();
 const fullscreen=page.getByRole('dialog',{name:'Граф общих друзей на весь экран',exact:true});
 await expect(fullscreen).toBeVisible();
 const rect=await fullscreen.boundingBox(),viewport=page.viewportSize()!;
 expect(rect!.x).toBeCloseTo(0,0);expect(rect!.y).toBeCloseTo(0,0);
 expect(rect!.width).toBeCloseTo(viewport.width,0);expect(rect!.height).toBeCloseTo(viewport.height,0);
 await expect.poll(()=>page.evaluate(()=>document.body.style.overflow)).toBe('hidden');
 await page.keyboard.press('Shift+Tab');
 expect(await fullscreen.evaluate(element=>element.contains(document.activeElement))).toBe(true);
 const svg=fullscreen.getByRole('img',{name:'Граф общих друзей',exact:true}),friend=websiteOf(svg);
 await holdNode(page,svg,friend,61);
 await expect(svg.locator('.network-node.selected')).toHaveCount(1);
 await page.screenshot({path:`artifacts/regressions/${info.project.name}-network-fullscreen-hold-synthetic-fixture.png`});
 await shortTap(svg,friend,62);
 const profile=page.getByRole('dialog',{name:'Профиль',exact:true});
 await expect(profile.getByRole('heading',{name:'Website Friend',exact:true})).toBeVisible();
 // A dialog can be DOM-visible while another fixed layer covers it. Check the real hit target.
 await expect.poll(()=>profile.evaluate(element=>{
  const box=element.getBoundingClientRect();
  return element.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
 })).toBe(true);
 // Android's backButton uses the same Escape event; only the profile should close first.
 await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 await expect(profile).toHaveCount(0);await expect(fullscreen).toBeVisible();
 await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 await expect(fullscreen).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>document.body.style.overflow)).toBe(before);
 await page.getByRole('button',{name:'На весь экран',exact:true}).click();
 await fullscreen.getByRole('button',{name:'Выйти из полного экрана',exact:true}).click();
 await expect(fullscreen).toHaveCount(0);
 expect(errors).toEqual([]);
});

for(const fullscreen of [false,true]){
 test(`real touch at the canvas edge opens one persistent profile in ${fullscreen?'full-screen':'inline'} graph`,async({page})=>{
  let svg=await graphFixture(page);
  if(fullscreen){await page.getByRole('button',{name:'На весь экран',exact:true}).click();svg=graphOf(page);}
  await svg.scrollIntoViewIfNeeded();
  // Put the node outside the future landscape profile bounds. Opening on pointerup
  // made the browser's following click hit that new backdrop and close it again.
  const friend=websiteOf(svg),frame=await svg.boundingBox();
  expect(frame).not.toBeNull();
  const before=await nodePoint(friend),desired=frame!.x+12;
  const start={x:frame!.x+frame!.width-12,y:Math.max(frame!.y+10,Math.min(page.viewportSize()!.height/2,frame!.y+frame!.height-10))};
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  await page.mouse.move(start.x+desired-before.x,start.y,{steps:12});await page.mouse.up();
  await expect.poll(async()=>Math.abs((await nodePoint(friend)).x-desired)).toBeLessThan(1);
  await expect(page.getByRole('dialog',{name:'Профиль',exact:true})).toHaveCount(0);
  await page.evaluate(()=>{
   (window as unknown as {__graphOpeningClicks:boolean[]}).__graphOpeningClicks=[];
   document.addEventListener('click',event=>{
    (window as unknown as {__graphOpeningClicks:boolean[]}).__graphOpeningClicks.push((event.target as Element).classList.contains('modal-backdrop'));
   },true);
  });
  const point=await nodePoint(friend);
  await page.touchscreen.tap(point.x,point.y);
  const profile=page.getByRole('dialog',{name:'Профиль',exact:true});
  await expect(profile.getByRole('heading',{name:'Website Friend',exact:true})).toBeVisible();
  await page.waitForTimeout(350);
  await expect(profile).toBeVisible();
  expect(await page.evaluate(()=>(window as unknown as {__networkTest:{actions:unknown[]}}).__networkTest.actions)).toEqual([{type:'profile',id:'usr_graph-website'}]);
  expect(await page.evaluate(()=>(window as unknown as {__graphOpeningClicks:boolean[]}).__graphOpeningClicks)).not.toContain(true);
  await profile.getByRole('button',{name:'Закрыть',exact:true}).tap();
  await expect(profile).toHaveCount(0);
 });
}

test('real touch hold, drag and pinch do not open profiles and a following tap remains usable',async({page})=>{
 const client=await page.context().newCDPSession(page);
 const touch=(type:'touchStart'|'touchMove'|'touchEnd',points:{id:number;x:number;y:number}[])=>client.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(point=>({...point,radiusX:1,radiusY:1,force:1}))});
 for(const fullscreen of [false,true]){
  let svg=await graphFixture(page);
  if(fullscreen){await page.getByRole('button',{name:'На весь экран',exact:true}).click();svg=graphOf(page);}
  const friend=websiteOf(svg);await friend.scrollIntoViewIfNeeded();
  const point=await nodePoint(friend);
  await touch('touchStart',[{id:1,...point}]);
  await expect(friend).toHaveClass(/\bselected\b/);
  await touch('touchEnd',[]);
  await page.waitForTimeout(150);
  await expect(page.getByRole('dialog',{name:'Профиль',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Снять выделение связей',exact:true}).tap();
  const drag=await nodePoint(friend);
  await touch('touchStart',[{id:1,...drag}]);
  await touch('touchMove',[{id:1,x:drag.x-20,y:drag.y-8}]);
  await touch('touchEnd',[]);
  const pinch=await nodePoint(friend);
  const second={id:2,x:pinch.x-45,y:pinch.y};
  await touch('touchStart',[{id:1,...pinch},second]);
  await touch('touchMove',[{id:1,x:pinch.x+15,y:pinch.y},{...second,x:second.x-15}]);
  await touch('touchEnd',[]);
  await page.waitForTimeout(650);
  await expect(svg.locator('.network-node.selected')).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'Профиль',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as unknown as {__networkTest:{actions:unknown[]}}).__networkTest.actions)).toEqual([]);
  await friend.scrollIntoViewIfNeeded();
  const tap=await nodePoint(friend);await page.touchscreen.tap(tap.x,tap.y);
  const profile=page.getByRole('dialog',{name:'Профиль',exact:true});
  await expect(profile.getByRole('heading',{name:'Website Friend',exact:true})).toBeVisible();
  await profile.getByRole('button',{name:'Закрыть',exact:true}).tap();
 }
 await client.detach();
});
