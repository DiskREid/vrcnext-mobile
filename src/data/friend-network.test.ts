import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import type { User } from '../api';
import {
  buildKnownGraph, isObservationFresh, normalizeGraphPerson, readNetworkCache,
  scanMutualFriends, writeNetworkCache,
} from './friend-network';
import type { GraphObservation, GraphPerson } from './friend-network';

const person = (id: string, displayName = id): User => ({ id, displayName, status: 'active' });
const self = person('usr_self', 'Me');
const alice = person('usr_alice', 'Alice');
const bob = person('usr_bob', 'Bob');
const charlie = person('usr_charlie', 'Charlie');
const stamp = '2026-10-25T12:00:00.000Z';
const observed = (userId = alice.id, mutuals: GraphPerson[] = [bob, charlie]): GraphObservation =>
  ({ userId, displayName: 'Alice', mutuals, observedAt: stamp, complete: true });
const edgeIds = (graph: ReturnType<typeof buildKnownGraph>) =>
  graph.edges.map((edge) => [edge.source, edge.target].sort().join('|'));
function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

describe('known social edges only', () => {
  it('starts with current self-friend links and does not guess friend-friend links', () => {
    const graph = buildKnownGraph(self, [alice, bob], []);
    expect(edgeIds(graph).sort()).toEqual(['usr_alice|usr_self', 'usr_bob|usr_self']);
    expect(graph.nodes.find((node) => node.id === self.id)).toMatchObject({self: true, friend: false});
    expect(graph.nodes.find((node) => node.id === alice.id)).toMatchObject({self: false, friend: true});
    expect(graph.nodes.find((node) => node.id === alice.id)?.component).not.toBe(graph.nodes.find((node) => node.id === bob.id)?.component);
  });
  it('adds only the two links proved by each mutual row, never a clique of all returned people', () => {
    const graph = buildKnownGraph(self, [alice], [observed()]);
    expect(edgeIds(graph).sort()).toEqual([
      'usr_alice|usr_bob', 'usr_alice|usr_charlie', 'usr_alice|usr_self',
      'usr_bob|usr_self', 'usr_charlie|usr_self',
    ]);
    expect(edgeIds(graph)).not.toContain('usr_bob|usr_charlie');
    const nodes = graph.nodes.filter((node) => !node.self);
    expect(new Set(nodes.map((node) => node.component)).size).toBe(1);
    expect(graph.edges.find((edge) => edge.source === alice.id && edge.target === bob.id)).toMatchObject({sourceType: 'mutual', observedAt: stamp});
  });
  it('deduplicates reverse links and prefers the current friend list over a historical self link', () => {
    const graph = buildKnownGraph(self, [alice, bob], [observed(alice.id, [bob]), observed(bob.id, [alice])]);
    expect(graph.edges).toHaveLength(3);
    expect(graph.edges.find((edge) => [edge.source, edge.target].includes(self.id) && [edge.source, edge.target].includes(bob.id))?.sourceType).toBe('friends');
  });
  it('keeps layout IDs/components stable under changes of presence or names', () => {
    const initial = buildKnownGraph(self, [alice, bob], [observed()]);
    const updated = buildKnownGraph({...self, status: 'busy'}, [{...bob, displayName: 'New name', status: 'offline'}, alice], [observed()]);
    expect(updated.nodes.map((node) => [node.id, node.component])).toEqual(initial.nodes.map((node) => [node.id, node.component]));
    expect(updated.nodes.find((node) => node.id === bob.id)).toMatchObject({displayName: 'New name', status: 'offline'});
  });
  it('ignores malformed people and never creates self-loops from repeated mutual/self records', () => {
    const graph = buildKnownGraph(self, [alice], [observed(alice.id, [self, alice, bob, bob])]);
    expect(graph.edges.every((edge) => edge.source !== edge.target)).toBe(true);
    expect(graph.nodes.map((node) => node.id)).toEqual([alice.id, bob.id, self.id].sort());
    expect(normalizeGraphPerson({id:'https://other.test',displayName:'bad'})).toBeUndefined();
  });
});

describe('account-scoped graph snapshots', () => {
  it('restores only its own account and persists a whitelist without cookies, tokens or URL fields', () => {
    const store = storage();
    const value = { ...observed(), authToken:'secret-token', mutuals:[{...bob, cookies:'private', iconUrl:'https://example.test/?token=private'}] };
    writeNetworkCache(self.id, [value], store);
    expect(JSON.stringify([...store.data.values()])).not.toMatch(/secret-token|private|iconUrl|cookies|authToken/);
    expect(readNetworkCache(self.id, store)).toEqual([observed(alice.id, [bob])]);
    expect(readNetworkCache('usr_other', store)).toEqual([]);
    writeNetworkCache('usr_other', [observed(charlie.id, [alice])], store);
    expect(readNetworkCache(self.id, store)[0].userId).toBe(alice.id);
  });
  it('reports malformed cache and write errors without returning a false successful empty graph', () => {
    const store = storage(); store.data.set('vrcnext-mobile.network.v1.usr_self', '{broken');
    expect(() => readNetworkCache(self.id, store)).toThrow('прочитать кеш');
    store.data.set('vrcnext-mobile.network.v1.usr_self', JSON.stringify({version:1,account:self.id,observations:[{...observed(),mutuals:[{id:'bad'}]}]}));
    expect(() => readNetworkCache(self.id, store)).toThrow('прочитать кеш');
    expect(() => writeNetworkCache(self.id, [observed()], {setItem:()=>{throw new Error('QuotaExceeded');}})).toThrow('сохранить кеш');
  });
  it('bounds the number of retained scans and total mutual records, without trimming a full scan into a fake complete one', () => {
    const store = storage();
    const snapshots = Array.from({length:30},(_,index)=>({...observed(`usr_scan-${index}`, [bob]),observedAt:new Date(Date.parse(stamp)+index*1000).toISOString()}));
    writeNetworkCache(self.id, snapshots, store);
    const retained = readNetworkCache(self.id, store);
    expect(retained).toHaveLength(20);
    expect(retained[0].userId).toBe('usr_scan-29');
    const many = Array.from({length:3},(_,scan)=>observed(`usr_big-${scan}`,Array.from({length:2200},(_,index)=>person(`usr_person-${scan}-${index}`))));
    writeNetworkCache(self.id, many, store);
    expect(readNetworkCache(self.id, store).reduce((sum,value)=>sum+value.mutuals.length,0)).toBeLessThanOrEqual(5000);
  });
  it('only treats complete snapshots within 15 minutes as fresh and rejects clock-reversed timestamps', () => {
    const now=Date.parse(stamp);
    expect(isObservationFresh(observed(),now)).toBe(true);
    expect(isObservationFresh(observed(),now+15*60_000)).toBe(false);
    expect(isObservationFresh({...observed(),complete:false},now)).toBe(false);
    expect(isObservationFresh(observed(),now-1)).toBe(false);
  });
});

describe('explicit mutual scanning', () => {
  it('reads sequential raw offsets, deduplicates boundary IDs and reports progress', async () => {
    const first = Array.from({length:100},(_,index)=>person(`usr_friend-${index}`));
    const load = vi.fn(async (_id:string,offset:number)=>offset===0?first:[first[99],person('usr_last')]);
    const progress=vi.fn();
    const result=await scanMutualFriends(alice.id,load,{now:()=>stamp,onProgress:progress});
    expect(load.mock.calls.map((call)=>call[1])).toEqual([0,100]);
    expect(result).toMatchObject({complete:true,observedAt:stamp,userId:alice.id});
    expect(result.mutuals).toHaveLength(101);
    expect(progress.mock.calls.map(([count])=>count)).toEqual([100,101]);
  });
  it('returns a denied or rate limited scan as incomplete, never as an empty complete list or an automatic retry', async () => {
    const denied=vi.fn(async()=>{throw new ApiError('secret backend text',403);});
    expect(await scanMutualFriends(alice.id,denied,{now:()=>stamp})).toMatchObject({complete:false,status:403,mutuals:[],error:expect.stringContaining('закрыл')});
    expect(denied).toHaveBeenCalledOnce();
    const limited=vi.fn(async()=>{throw new ApiError('secret backend text',429,60);});
    const result=await scanMutualFriends(alice.id,limited,{now:()=>stamp});
    expect(result).toMatchObject({complete:false,status:429,error:expect.stringContaining('60')});
    expect(result.error).not.toContain('secret'); expect(limited).toHaveBeenCalledOnce();
  });
  it('keeps genuinely received rows when a later page fails and detects repeated pages', async () => {
    const rows=Array.from({length:100},(_,index)=>person(`usr_friend-${index}`));
    const failed=vi.fn(async(_id:string,offset:number)=>{if(offset)throw new Error('network');return rows;});
    const partial=await scanMutualFriends(alice.id,failed,{now:()=>stamp});
    expect(partial.complete).toBe(false);expect(partial.mutuals).toHaveLength(100);expect(partial.error).toBeTruthy();
    const repeated=vi.fn(async()=>rows);
    expect(await scanMutualFriends(alice.id,repeated,{now:()=>stamp})).toMatchObject({complete:false,error:expect.stringContaining('повторил')});
    expect(repeated).toHaveBeenCalledTimes(2);
  });
  it('cancels without committing a late page after switching away, and rejects a bad selected ID locally', async () => {
    let cancelled=false;
    let finish!:(users:User[])=>void;
    const load=vi.fn(()=>new Promise<User[]>((resolve)=>{finish=resolve;}));
    const scan=scanMutualFriends(alice.id,load,{cancelled:()=>cancelled,now:()=>stamp});
    cancelled=true;finish([bob]);
    await expect(scan).rejects.toMatchObject({name:'AbortError'});
    await expect(scanMutualFriends('bad-id',load)).rejects.toThrow('идентификатора');
    expect(load).toHaveBeenCalledOnce();
  });
  it('stops at a fixed request bound and labels the available data incomplete', async () => {
    const load=vi.fn(async(_id:string,offset:number)=>Array.from({length:100},(_,index)=>person(`usr_friend-${offset+index}`)));
    const result=await scanMutualFriends(alice.id,load,{now:()=>stamp});
    expect(load).toHaveBeenCalledTimes(25);expect(result.mutuals).toHaveLength(2500);
    expect(result).toMatchObject({complete:false,error:expect.stringContaining('2500')});
  });
});
