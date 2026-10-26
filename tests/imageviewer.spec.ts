import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
type ImageFixture={images:{url:string;maxDimension:number}[];downloads:{url:string;fileName:string}[];unexpected:string[];failSave:boolean;photo:string;print:string;thumbnail:string;groupImage:string};
const fixture=(page:Page)=>page.evaluate(()=>(window as unknown as {__imageViewerTest:ImageFixture}).__imageViewerTest);
async function openPhoto(page:Page){
 await page.goto('/tests/images-viewer-harness.html');
 await page.getByRole('button',{name:/Fixture Photo/}).click();
 await page.getByRole('dialog',{name:'Fixture Photo',exact:true}).getByRole('button',{name:'На весь экран',exact:true}).click();
 return page.getByRole('dialog',{name:'Изображение · Fixture Photo',exact:true});
}
test('photo viewer fills the viewport, pinches and pans without gesture dismissal and Back closes only the top modal',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const dialog=await openPhoto(page);await expect(dialog).toBeVisible();
 const rect=await dialog.boundingBox();expect(rect!.width).toBeCloseTo(page.viewportSize()!.width,0);expect(rect!.height).toBeCloseTo(page.viewportSize()!.height,0);
 const image=dialog.locator('.image-viewer-stage img');await expect.poll(()=>image.evaluate((element:HTMLImageElement)=>element.complete&&element.naturalWidth>0)).toBe(true);
 const stage=dialog.locator('.image-viewer-stage');
 await stage.evaluate(element=>{const box=element.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2;const emit=(type:string,id:number,px:number,py:number)=>element.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',clientX:px,clientY:py,button:0,buttons:type==='pointerup'?0:1}));emit('pointerdown',1,x-30,y);emit('pointerdown',2,x+30,y);emit('pointermove',1,x-100,y);emit('pointermove',2,x+100,y);emit('pointerup',1,x-100,y);emit('pointerup',2,x+100,y);});
 await expect(image).toHaveAttribute('style',/scale\(3\./);
 const zoom=await image.getAttribute('style');
 await stage.evaluate(element=>{const box=element.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2;for(const[type,px,py]of[['pointerdown',x,y],['pointermove',x+100,y+40],['pointerup',x+100,y+40]]as const)element.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:3,pointerType:'touch',clientX:px,clientY:py,button:0,buttons:type==='pointerup'?0:1}));});
 await expect(image).not.toHaveAttribute('style',zoom!);await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'Вписать изображение',exact:true}).click();await expect(image).toHaveAttribute('style',/scale\(1\)/);
 await expect(dialog.getByRole('button',{name:/Поделиться/})).toHaveCount(0);
 await page.screenshot({path:`artifacts/regressions/${info.project.name}-image-viewer-synthetic-fixture.png`});
 // Android's existing backButton handler dispatches this same Escape event to the top modal.
 await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 await expect(dialog).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Fixture Photo',exact:true})).toBeVisible();expect(errors).toEqual([]);expect((await fixture(page)).unexpected).toEqual([]);
});
test('downloads use original photo and Print URLs, expose failures and do not download thumbnail-only Prints',async({page})=>{
 const dialog=await openPhoto(page);await page.evaluate(()=>(window as unknown as {__imageViewerTest:ImageFixture}).__imageViewerTest.failSave=true);
 await dialog.getByRole('button',{name:'Скачать оригинал',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Synthetic gallery permission denied');
 await page.evaluate(()=>(window as unknown as {__imageViewerTest:ImageFixture}).__imageViewerTest.failSave=false);
 await dialog.getByRole('button',{name:'Скачать оригинал',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Оригинал сохранён');
 let state=await fixture(page);expect(state.downloads.map(item=>item.url)).toEqual([state.photo,state.photo]);expect(state.images.some(item=>item.maxDimension===2048&&item.url===state.photo)).toBe(true);
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('dialog',{name:'Fixture Photo',exact:true}).getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:'Принты',exact:true}).click();await page.getByRole('button',{name:/^Fixture Print/}).click();
 await page.getByRole('dialog',{name:'Fixture Print',exact:true}).getByRole('button',{name:'На весь экран',exact:true}).click();
 const print=page.getByRole('dialog',{name:'Изображение · Fixture Print',exact:true});await print.getByRole('button',{name:'Скачать оригинал',exact:true}).click();await expect(print.getByRole('status')).toContainText('Оригинал сохранён');
 state=await fixture(page);expect(state.downloads.at(-1)?.url).toBe(state.print);expect(state.downloads.some(item=>item.url===state.thumbnail)).toBe(false);
 await print.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('dialog',{name:'Fixture Print',exact:true}).getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:/^Fixture Preview Only/}).click();await page.getByRole('dialog',{name:'Fixture Preview Only',exact:true}).getByRole('button',{name:'На весь экран',exact:true}).click();
 const preview=page.getByRole('dialog',{name:'Изображение · Fixture Preview Only',exact:true});await expect(preview.getByRole('button',{name:'Скачать оригинал',exact:true})).toBeDisabled();await expect(preview).toContainText('VRChat не передал оригинал');expect((await fixture(page)).unexpected).toEqual([]);
});
test('a group gallery opens the same full-screen viewer and saves the documented original',async({page})=>{
 await page.goto('/tests/images-viewer-harness.html');await page.getByRole('button',{name:'Fixture Open Group',exact:true}).click();
 const group=page.getByRole('dialog',{name:'Fixture Gallery Group',exact:true});await group.getByRole('button',{name:'Галерея',exact:true}).click();await group.getByRole('button',{name:'Открыть изображение группы 1',exact:true}).click();
 const viewer=page.getByRole('dialog',{name:'Изображение · Fixture Group Image',exact:true});await expect(viewer).toBeVisible();await viewer.getByRole('button',{name:'Скачать оригинал',exact:true}).click();await expect(viewer.getByRole('status')).toContainText('Оригинал сохранён');
 const state=await fixture(page);expect(state.downloads.at(-1)?.url).toBe(state.groupImage);await viewer.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(group).toBeVisible();expect(state.unexpected).toEqual([]);
});
