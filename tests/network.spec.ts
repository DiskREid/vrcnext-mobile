import {test,expect} from '@playwright/test';

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
