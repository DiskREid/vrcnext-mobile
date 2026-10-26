import { describe, expect, it } from 'vitest';
import { notificationCategory, notificationDestination, sortNotifications } from './notifications';
describe('notification categories and destinations', () => {
  it('recognizes invitation, friend, group and calendar protocols', () => {
    expect(['invite','requestInvite','group.invite'].map(type => notificationCategory({id:type,type}))).toEqual(['invites','invites','invites']);
    expect(notificationCategory({id:'1',type:'friendRequest'})).toBe('friends');
    expect(notificationCategory({id:'2',type:'groupAnnouncement'})).toBe('groups');
    expect(notificationCategory({id:'3',type:'event.announcement'})).toBe('calendar');
    expect(notificationCategory({id:'4',type:'boop'})).toBe('other');
  });
  it('opens calendar links before group or sender profiles', () => {
    expect(notificationDestination({id:'1',type:'group.event.created',senderUserId:'usr_sender',link:'event:grp_real,cal_real'})).toEqual({type:'event',groupId:'grp_real',eventId:'cal_real'});
    expect(notificationDestination({id:'2',type:'event.announcement',details:{groupId:'grp_real',eventId:'cal_real'}})).toEqual({type:'event',groupId:'grp_real',eventId:'cal_real'});
  });
  it('never treats a group sender as a user ID or accepts arbitrary target URLs', () => {
    expect(notificationDestination({id:'1',type:'group.announcement',senderUserId:'grp_real'})).toEqual({type:'group',id:'grp_real'});
    expect(notificationDestination({id:'2',type:'friendRequest',senderUserId:'usr_real'})).toEqual({type:'user',id:'usr_real'});
    expect(notificationDestination({id:'3',type:'other',senderUserId:'https://bad.test',details:{groupId:'../auth'}})).toBeUndefined();
  });
  it('sorts fresh notices first without mutating input; unknown times go last', () => {
    const items=[{id:'old',type:'invite',created_at:'2026-01-01'},{id:'unknown',type:'invite'},{id:'new',type:'invite',createdAt:'2026-10-26'}];
    expect(sortNotifications(items).map(x=>x.id)).toEqual(['new','old','unknown']);expect(items[0].id).toBe('old');
  });
});
