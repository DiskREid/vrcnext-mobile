import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './index';
import { createFavoritesClient, FavoriteMoveError, favoriteApi, loadFavoriteWorlds, loadFavoriteAvatars, loadFavoriteGroups, clearFavoriteEntityCache } from './favorites';
import type { Favorite } from './types';

const original: Favorite = { id: 'fvrt_record', favoriteId: 'wrld_target', type: 'world', tags: ['worlds1', 'worlds3'] };
const moved: Favorite = { ...original, id: 'fvrt_new', tags: ['worlds8'] };
type Request = Parameters<typeof createFavoritesClient>[0];
afterEach(() => { vi.restoreAllMocks(); clearFavoriteEntityCache(); });
function fixture(results: unknown[]) {
  const request = vi.fn(async () => { const next = results.shift(); if (next instanceof Error) throw next; return next; });
  return { request, client: createFavoritesClient(request as unknown as Request) };
}

describe('all favorite categories and complete lists', () => {
  it('removes only one friend category by replacing the favorite record with remaining tags', async () => {
    const friend: Favorite = { id: 'fvrt_record-id', favoriteId: 'usr_friend', type: 'friend', tags: ['group_0', 'group_2'] };
    const remaining = { ...friend, id: 'fvrt_replaced', tags: ['group_2'] };
    const { client, request } = fixture([{}, remaining]);
    expect(await client.setTags(friend, ['group_2'])).toEqual(remaining);
    expect(request.mock.calls).toEqual([
      ['/favorites/fvrt_record-id', 'DELETE'],
      ['/favorites', 'POST', { type: 'friend', favoriteId: 'usr_friend', tags: ['group_2'] }],
    ]);
  });
  it('removes all categories with the record ID and does not re-add an empty favorite', async () => {
    const friend: Favorite = { id: 'fvrt_remove', favoriteId: 'usr_friend', type: 'friend', tags: ['group_0'] };
    const { client, request } = fixture([{}]);
    expect(await client.setTags(friend, [])).toBeUndefined();
    expect(request.mock.calls).toEqual([['/favorites/fvrt_remove', 'DELETE']]);
  });
  it('does not call dropped server tags a successful favorite update', async () => {
    const { client } = fixture([{ id: 'fvrt_partial', favoriteId: 'usr_friend', type: 'friend', tags: ['group_0'] }]);
    await expect(client.add('usr_friend', 'friend', ['group_0', 'group_2'])).rejects.toThrow('подтверждение');
  });
  it('uses modern groups by type and retains every server-provided category including the eighth', async () => {
    const groups = Array.from({length:8}, (_,i)=>({id:`grp_${i}`,name:`worlds${i+1}`,displayName:`Worlds ${i+1}`,visibility:'private'}));
    const {client,request}=fixture([{favoriteGroups:groups,maxFavoriteGroups:8}]);
    const result=await client.groups('usr_me','world');
    expect(result).toHaveLength(8); expect(result[7]).toMatchObject({name:'worlds8',type:'world'});
    expect(request).toHaveBeenCalledWith('/favorites/groups/world?ownerId=usr_me');
  });
  it('falls back only after an actual unsupported 404, never after permission errors', async () => {
    const group={id:'grp_legacy',type:'avatar',name:'avatars6',displayName:'Six'};
    const fallback=fixture([new ApiError('missing',404),[group]]);
    expect(await fallback.client.groups('usr_me','avatar')).toEqual([group]);
    expect(fallback.request).toHaveBeenLastCalledWith('/favorite/groups?type=avatar&ownerId=usr_me&n=100&offset=0');
    const denied=fixture([new ApiError('denied',403)]);
    await expect(denied.client.groups('usr_me','friend')).rejects.toMatchObject({status:403});
    expect(denied.request).toHaveBeenCalledOnce();
  });
  it('paginates all records and rejects repeated full pages', async () => {
    const page=Array.from({length:100},(_,i)=>({...original,id:`fvrt_${i}`,favoriteId:`wrld_${i}`}));
    const {client,request}=fixture([page,[original]]);
    expect(await client.favorites('world')).toHaveLength(101);
    expect(request).toHaveBeenLastCalledWith('/favorites?type=world&n=100&offset=100');
    await expect(fixture([page,page]).client.favorites('world')).rejects.toThrow('повторил страницу');
  });
  it('loads complete world metadata separately without substituting a target ID for a favorite record ID', async () => {
    const {client,request}=fixture([[{id:'wrld_target',name:'Real World'}]]);
    expect(await client.metadata('world')).toEqual([{id:'wrld_target',name:'Real World'}]);
    expect(request).toHaveBeenCalledWith('/worlds/favorites?n=100&offset=0');
  });
  it('loads every actual ordinary and VRC+ world category explicitly, not the default group only', async () => {
    vi.spyOn(favoriteApi,'groups').mockImplementation(async (_owner,type) => Array.from({length:4},(_,i)=>({type,name:`${type}_${i}`,displayName:`Group ${i}`})));
    const metadata=vi.spyOn(favoriteApi,'metadata').mockImplementation(async (_type,tag)=>[{id:'wrld_shared',name:'Shared'}, {id:`wrld_${tag}`,name:tag!}]);
    const worlds=await loadFavoriteWorlds('usr_all_eight',true);
    expect(metadata).toHaveBeenCalledTimes(8);
    expect(metadata).toHaveBeenCalledWith('world','vrcPlusWorld_3');
    expect(worlds).toHaveLength(9);
    expect(worlds.find((w)=>w.id==='wrld_shared')?.favoriteGroupNames).toHaveLength(8);
  });
  it('loads favorite avatar pages with the exact selected category tag', async () => {
    const rows = Array.from({length:100}, (_,index) => ({id:`avtr_${index}`,name:`Avatar ${index}`}));
    const {client,request} = fixture([rows,[{id:'avtr_last',name:'Last avatar'}]]);
    expect(await client.metadata('avatar','avatars6')).toHaveLength(101);
    expect(request.mock.calls).toEqual([
      ['/avatars/favorites?tag=avatars6&n=100&offset=0'],
      ['/avatars/favorites?tag=avatars6&n=100&offset=100'],
    ]);
  });
  it('keeps all-avatar and selected-category snapshots separate and fetches only the selected tag', async () => {
    const groups = [{type:'avatar' as const,name:'avatars1',displayName:'First'}, {type:'avatar' as const,name:'avatars2',displayName:'Second'}];
    const metadata = vi.spyOn(favoriteApi,'metadata').mockImplementation(async (_type,tag) => [{id:`avtr_${tag}`,name:tag!}]);
    const all = await loadFavoriteAvatars('usr_avatar_collections',false,groups);
    expect(all.map((avatar)=>avatar.favoriteGroupNames)).toEqual([['avatars1'],['avatars2']]);
    metadata.mockClear();
    const second = await loadFavoriteAvatars('usr_avatar_collections',false,groups,'avatars2');
    expect(metadata).toHaveBeenCalledExactlyOnceWith('avatar','avatars2');
    expect(second).toMatchObject([{id:'avtr_avatars2',favoriteGroupNames:['avatars2']}]);
    metadata.mockClear();
    expect(await loadFavoriteAvatars('usr_avatar_collections',false,groups,'avatars2')).toBe(second);
    expect(metadata).not.toHaveBeenCalled();
    expect(await loadFavoriteAvatars('usr_avatar_collections',false,groups)).toBe(all);
  });
  it('does not replace an unavailable avatar category with all collections', async () => {
    const groups = [{type:'avatar' as const,name:'avatars1',displayName:'First'}];
    const metadata = vi.spyOn(favoriteApi,'metadata');
    await expect(loadFavoriteAvatars('usr_avatar_category_missing',false,groups,'avatars9')).rejects.toThrow('Выбранная коллекция недоступна');
    expect(metadata).not.toHaveBeenCalled();
  });
  it('retains every proven avatar category when an avatar belongs to multiple collections', async () => {
    const groups = [{type:'avatar' as const,name:'avatars1',displayName:'First'}, {type:'avatar' as const,name:'avatars2',displayName:'Second'}];
    vi.spyOn(favoriteApi,'metadata').mockResolvedValue([{id:'avtr_shared',name:'Shared avatar'}]);
    const result = await loadFavoriteAvatars('usr_shared_avatar',true,groups);
    expect(result).toHaveLength(1);
    expect(result[0].favoriteGroupNames).toEqual(['avatars1','avatars2']);
  });
  it('retains ordinary favorites for a non-subscriber but does not conceal rate limits on optional VRC+', async () => {
    const ordinary={type:'world' as const,name:'worlds1',displayName:'First'};
    const groups=vi.spyOn(favoriteApi,'groups').mockImplementation(async (_owner,type) => {
      if (type === 'vrcPlusWorld') throw new ApiError('subscription required',403);
      return [ordinary];
    });
    expect(await loadFavoriteGroups('usr_non_subscriber','world')).toEqual([ordinary]);
    groups.mockImplementation(async (_owner,type) => { if(type === 'vrcPlusWorld') throw new ApiError('rate limit',429); return [ordinary]; });
    await expect(loadFavoriteGroups('usr_non_subscriber','world')).rejects.toMatchObject({status:429});
    const {client}=fixture([[original],new ApiError('subscription required',403)]);
    expect(await client.familyFavorites('world')).toEqual([original]);
  });
});

describe('favorite moves and recovery', () => {
  it('deletes the favorite record, then adds the target to the selected category', async () => {
    const {client,request}=fixture([{},moved]);
    expect(await client.move(original,'worlds8')).toEqual(moved);
    expect(request.mock.calls).toEqual([
      ['/favorites/fvrt_record','DELETE'],
      ['/favorites','POST',{type:'world',favoriteId:'wrld_target',tags:['worlds8']}],
    ]);
  });
  it('changes the favorite type as well as the tag when moving into a VRC+ world group', async () => {
    const plus: Favorite = {...moved,type:'vrcPlusWorld',tags:['vrcPlusWorlds4']};
    const {client,request}=fixture([{},plus]);
    expect(await client.move(original,'vrcPlusWorlds4','vrcPlusWorld')).toEqual(plus);
    expect(request).toHaveBeenLastCalledWith('/favorites','POST',{type:'vrcPlusWorld',favoriteId:'wrld_target',tags:['vrcPlusWorlds4']});
  });
  it('restores every original tag after a failed move and read-back proving no record exists', async () => {
    const {client,request}=fixture([{},new ApiError('full',400),[],[],{...original,id:'fvrt_restored'}]);
    await expect(client.move(original,'worlds8')).rejects.toMatchObject({restored:true,uncertain:false});
    expect(request).toHaveBeenLastCalledWith('/favorites','POST',{type:'world',favoriteId:'wrld_target',tags:['worlds1','worlds3']});
  });
  it('recognizes an applied timed-out POST without duplicate add or rollback', async () => {
    const {client,request}=fixture([{},new ApiError('network'),[moved],[]]);
    expect(await client.move(original,'worlds8')).toEqual(moved);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('does not overwrite an independently changed record', async () => {
    const {client,request}=fixture([{},new ApiError('network'),[{...moved,tags:['worlds2']}],[]]);
    await expect(client.move(original,'worlds8')).rejects.toMatchObject({restored:false,uncertain:false});
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('retains recovery information when the server cannot verify state, without blind retries', async () => {
    const {client,request}=fixture([{},new ApiError('rate limited',429),new ApiError('cooldown',429),new ApiError('cooldown',429)]);
    try { await client.move(original,'worlds8'); throw new Error('expected failure'); }
    catch(e) { expect(e).toBeInstanceOf(FavoriteMoveError); expect(e).toMatchObject({original,restored:false,uncertain:true}); }
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('recovers only a missing record and never duplicates an existing restored favorite', async () => {
    const {client,request}=fixture([[original],[]]);
    expect(await client.recover(original)).toEqual(original); expect(request).toHaveBeenCalledTimes(2);
    const missing=fixture([[],[],original]);
    expect(await missing.client.recover(original)).toEqual(original);
    expect(missing.request).toHaveBeenLastCalledWith('/favorites','POST',{type:'world',favoriteId:'wrld_target',tags:['worlds1','worlds3']});
  });
  it('updates a category using its own internal name and the current account owner', async () => {
    const {client,request}=fixture([{}]);
    await client.updateGroup('usr_me',{name:'worlds8',displayName:'Old',type:'world'},' New name ','friends');
    expect(request).toHaveBeenCalledWith('/favorite/group/world/worlds8/usr_me','PUT',{displayName:'New name',visibility:'friends'});
  });
});
