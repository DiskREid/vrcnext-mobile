import { describe, expect, it, vi } from 'vitest';
import { ImagePreviewCache } from './image-cache';
const data=(name:string)=>'data:image/png;base64,'+name;
function deferred(){let resolve!:(s:string)=>void;const promise=new Promise<string>((done)=>{resolve=done;});return{promise,resolve};}
describe('bounded avatar preview requests',()=>{
  it('deduplicates pending images and starts at most two native loads',async()=>{
    const cache=new ImagePreviewCache(); const a=deferred(),b=deferred();
    const one=vi.fn(()=>a.promise),two=vi.fn(()=>b.promise),three=vi.fn(async()=>data('c'));
    const first=cache.load('a',one,()=>true),duplicate=cache.load('a',one,()=>true),second=cache.load('b',two,()=>true),last=cache.load('c',three,()=>true);
    await Promise.resolve(); expect(one).toHaveBeenCalledOnce();expect(two).toHaveBeenCalledOnce();expect(three).not.toHaveBeenCalled();
    a.resolve(data('a')); b.resolve(data('b'));await Promise.all([first,duplicate,second,last]);expect(three).toHaveBeenCalledOnce();
    expect(await cache.load('a',one,()=>true)).toBe(data('a'));expect(one).toHaveBeenCalledOnce();
  });
  it('does not permanently cache a failed image and cancels obsolete queued requests',async()=>{
    const cache=new ImagePreviewCache();const failed=vi.fn(async()=>{throw Error('network');});
    await expect(cache.load('a',failed,()=>true)).rejects.toThrow('network');
    await expect(cache.load('a',async()=>data('recovered'),()=>true)).resolves.toBe(data('recovered'));
    const loader=vi.fn(async()=>data('hidden'));
    await expect(cache.load('hidden',loader,()=>false)).rejects.toThrow('cancelled');expect(loader).not.toHaveBeenCalled();
  });
  it('drops completed previews by LRU size and never restores bytes from a cleared account',async()=>{
    const cache=new ImagePreviewCache(1000,1);const loader=vi.fn(async()=>data('a'));
    await cache.load('a',loader,()=>true);await cache.load('b',async()=>data('b'),()=>true);await cache.load('a',loader,()=>true);expect(loader).toHaveBeenCalledTimes(2);
    const old=deferred();const pending=cache.load('old',()=>old.promise,()=>true);await Promise.resolve();cache.clear();old.resolve(data('secret-old-account'));
    await expect(pending).rejects.toThrow('cancelled');
    expect(await cache.load('old',async()=>data('new-account'),()=>true)).toBe(data('new-account'));
  });
});
