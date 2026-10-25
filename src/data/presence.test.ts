import { describe, expect, it } from 'vitest';
import { overlayLiveUser, presenceIndicator, presenceMode } from './presence';
import { patchFriends } from './friends';
import type { User } from '../api/types';
const friend: User = { id: 'usr_friend', displayName: 'Friend', state: 'online', location: 'wrld_test:1', status: 'busy' };
describe('presence independent of preferred status', () => {
  it('shows offline gray even when a previous preferred status is colored', () => {
    for (const status of ['active','join me','ask me','busy']) expect(presenceIndicator({ state:'offline',location:'offline',status })).toMatchObject({mode:'offline',color:'offline'});
  });
  it('shows website as a ring while game status keeps its selected color', () => {
    expect(presenceIndicator({state:'active',location:'offline',status:'busy'})).toMatchObject({mode:'website',color:'busy'});
    expect(presenceIndicator(friend)).toMatchObject({mode:'game',color:'busy'});
    expect(presenceIndicator({...friend,status:'ask me'}).color).toBe('ask');
    expect(presenceIndicator({...friend,status:'join me'}).color).toBe('join');
  });
  it('handles current-user state always offline, disclosed fields and unavailable presence', () => {
    expect(presenceMode({...friend,state:'offline'})).toBe('game');
    expect(presenceMode({worldId:'wrld_test',instanceId:'123',state:'offline'})).toBe('game');
    expect(presenceMode({location:'private',status:'ask me'})).toBe('game');
    expect(presenceMode({status:'active'})).toBe('unknown');
  });
  it('changes a live user from game to website to offline without destroying their preferred status', () => {
    const website=patchFriends([friend],{type:'friend-active',content:{userId:friend.id}})[0];
    expect(presenceMode(website)).toBe('website'); expect(website.location).toBe('');
    const offline=patchFriends([website],{type:'friend-offline',content:{userId:friend.id}})[0];
    expect(presenceMode(offline)).toBe('offline'); expect(offline.status).toBe('busy');
  });
  it('does not let an old friend cache overwrite a freshly loaded profile', () => {
    const fresh={...friend,location:'private'};
    expect(overlayLiveUser(fresh,friend,friend)).toBe(fresh);
    expect(overlayLiveUser(fresh,friend,{...friend,status:'ask me'})).toMatchObject({location:'private',status:'ask me'});
    expect(overlayLiveUser(fresh,friend,{...friend,state:'offline',location:'offline'})).toMatchObject({state:'offline',location:'offline'});
  });
});
