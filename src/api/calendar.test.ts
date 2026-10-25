import { describe, expect, it, vi } from 'vitest';
import { createCalendarClient, normalizeCalendarEvent, normalizeCalendarPage, parseCalendarLink, withCalendarGroups } from './calendar';
import type { CalendarRequest } from './calendar';
const event = (id = 'cal_one') => ({ id, ownerId: 'grp_one', title: 'Real event', startsAt: '2026-10-25T12:00:00Z', userInterest: { isFollowing: true } });
function fixture(...responses: unknown[]) {
  const request = vi.fn(async () => { const next = responses.shift(); if (next instanceof Error) throw next; return next; }) as unknown as CalendarRequest;
  return { request, client: createCalendarClient(request) };
}
describe('calendar response contracts', () => {
  it('reads owner and nested user interest, including an explicit false overriding stale flat true', () => {
    expect(normalizeCalendarEvent({ ...event(), isFollowing: true, userInterest: { isFollowing: false } })).toMatchObject({ groupId: 'grp_one', isFollowing: false });
    expect(normalizeCalendarEvent(event())).toMatchObject({ groupId: 'grp_one', isFollowing: true });
  });
  it('respects hasNext even for a full hundred rows and advances a short page by consumed rows', () => {
    expect(normalizeCalendarPage({ results: Array.from({length:100},(_,i)=>event(`cal_${i}`)), hasNext: false, totalCount:100 })).toMatchObject({ hasNext:false, nextOffset:100,totalCount:100 });
    expect(normalizeCalendarPage({results:[event()],hasNext:true,totalCount:5},3)).toMatchObject({hasNext:true,nextOffset:4,totalCount:5});
  });
  it('marks an absent interest as followed only when the following endpoint proves it', () => {
    expect(normalizeCalendarPage([{ id:'cal_one' }],0,true).events[0].isFollowing).toBe(true);
    expect(normalizeCalendarPage([{ id:'cal_one' }]).events[0].isFollowing).toBeUndefined();
  });
  it('refuses malformed lists and impossible next pages instead of inventing empty success', () => {
    expect(()=>normalizeCalendarPage({wrong:[]})).toThrow('список');
    expect(()=>normalizeCalendarPage({results:[],hasNext:true})).toThrow('следующей');
    expect(()=>normalizeCalendarEvent({title:'Missing ID'})).toThrow('идентификатора');
  });
  it('queries the requested calendar month and preserves metadata through all-page loading', async () => {
    const {client,request}=fixture({results:[event()],hasNext:true,totalCount:2},{results:[event('cal_two')],hasNext:false,totalCount:2});
    expect(await client.allMonth(new Date(2026,9,25),'following')).toMatchObject({complete:true,events:[{id:'cal_one'},{id:'cal_two'}]});
    const calls=vi.mocked(request).mock.calls.map(([path])=>new URL(path,'https://test.invalid'));
    expect(calls[0].pathname).toBe('/calendar/following');
    expect(calls[0].searchParams.get('date')).toBe('2026-10-01T00:00:00.000Z');
    expect(calls[1].searchParams.get('offset')).toBe('1');
  });
  it('reports bounded synchronization as incomplete and rejects a repeated API page', async () => {
    const {client}=fixture({results:[event()],hasNext:true});
    expect(await client.allMonth(new Date(),'all',1)).toMatchObject({complete:false});
    const repeated=fixture({results:[event()],hasNext:true},{results:[event()],hasNext:true});
    await expect(repeated.client.allMonth(new Date(),'all')).rejects.toThrow('повторил');
  });
  it('does not request another page after its foreground observation is paused', async () => {
    let active = true;
    const request = vi.fn(async () => { active = false; return { results: [event()], hasNext: true }; }) as unknown as CalendarRequest;
    const result = await createCalendarClient(request).allMonth(new Date(), 'all', 4, () => active);
    expect(result).toMatchObject({ events: [{ id: 'cal_one' }], complete: false });
    expect(request).toHaveBeenCalledOnce();
  });
  it('shares an in-flight group list for one account and never another account', async () => {
    const {client,request}=fixture([{groupId:'grp_one',name:'One'}],[{groupId:'grp_two',name:'Two'}]);
    const [a,b]=await Promise.all([client.groups('usr_one'),client.groups('usr_one')]);
    expect(a).toEqual(b); expect(request).toHaveBeenCalledOnce();
    await client.groups('usr_one');expect(request).toHaveBeenCalledOnce();
    expect(await client.groups('usr_two')).toMatchObject([{id:'grp_two'}]);expect(request).toHaveBeenCalledTimes(2);
  });
  it('does not cache a failed groups request as an empty result', async () => {
    const {client,request}=fixture(new Error('Permission denied'),[{groupId:'grp_one',name:'One'}]);
    await expect(client.groups('usr_one')).rejects.toThrow('Permission');
    expect(await client.groups('usr_one')).toMatchObject([{id:'grp_one'}]);expect(request).toHaveBeenCalledTimes(2);
  });
  it('loads real details and only parses fixed event links', async () => {
    const {client,request}=fixture(event());
    expect(await client.detail('grp_one','cal_one')).toMatchObject({id:'cal_one',isFollowing:true});
    expect(request).toHaveBeenCalledWith('/calendar/grp_one/cal_one');
    expect(parseCalendarLink('event:grp_one,cal_one')).toEqual({groupId:'grp_one',eventId:'cal_one'});
    for(const link of ['https://elsewhere.invalid','event:grp_one,cal_one?secret=x','event:../grp_one,cal_one','javascript:alert(1)']) expect(parseCalendarLink(link)).toBeUndefined();
  });
  it('joins names without replacing known event data or inventing absent names',()=>{
    const events=[normalizeCalendarEvent(event()),normalizeCalendarEvent(event('cal_two'))];
    expect(withCalendarGroups(events,[{id:'grp_one',name:'Group'}])[0]).toMatchObject({title:'Real event',group:{name:'Group'}});
    expect(withCalendarGroups(events,[])[0].group).toBeUndefined();
  });
});
