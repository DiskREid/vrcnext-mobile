import { describe, expect, it } from 'vitest';
import { patchFriends, stableFriends } from './friends';
import type { User } from '../api';
const a: User = { id: 'usr_a', displayName: 'A', status: 'active', bio: 'real bio' };
const b: User = { id: 'usr_b', displayName: 'B', location: 'offline', status: 'offline' };
describe('friend presence without list reloads', () => {
  it('updates only the changed friend in its existing position', () => {
    const next = patchFriends([a,b], { type:'friend-online', content:{userId:b.id,location:'wrld_world:123'} });
    expect(next.map((u) => u.id)).toEqual([a.id,b.id]);
    expect(next[0]).toBe(a);
    expect(next[1]).toMatchObject({location:'wrld_world:123', state:'online'});
    expect(next[1].status).not.toBe('offline');
  });
  it('retains omitted profile fields and preserves unchanged objects', () => {
    expect(patchFriends([a,b], {type:'friend-update', content:{userId:a.id,user:{status:'busy'}}})[0]).toMatchObject({bio:'real bio',status:'busy'});
    expect(patchFriends([a,b], {type:'notification',content:{}})).toEqual([a,b]);
  });
  it('distinguishes website activity from joining the game', () => {
    const next = patchFriends([b], {type:'friend-active',content:{userid:b.id}})[0];
    expect(next.state).toBe('active'); expect(next.location).not.toMatch(/^wrld_/);
  });
  it('deletes confirmed removals and appends new friends without reordering', () => {
    expect(patchFriends([a,b],{type:'friend-delete',content:{userId:a.id}})).toEqual([b]);
    expect(patchFriends([a],{type:'friend-add',content:{userId:b.id,user:b}}).map((u)=>u.id)).toEqual([a.id,b.id]);
  });
  it('ignores partial unknown users and keeps old order across REST refresh', () => {
    expect(patchFriends([a],{type:'friend-online',content:{userId:b.id}})).toEqual([a]);
    expect(stableFriends([a,b],[{...b,status:'busy'},a]).map((u)=>u.id)).toEqual([a.id,b.id]);
  });
});
