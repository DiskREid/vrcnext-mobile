import { describe, expect, it, vi } from 'vitest';
import { CalendarSynchronizer } from './calendar-sync';
import { createCalendarClient } from '../api/calendar';
import type { CalendarEvent } from '../api';
type Client=ReturnType<typeof createCalendarClient>;
const origin=Date.parse('2026-10-25T12:00:00Z');
const event=(start=origin+20*60_000):CalendarEvent=>({id:'cal_one',groupId:'grp_one',title:'Real followed event',startsAt:new Date(start).toISOString(),isFollowing:true});
function storage(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>{values.set(key,value);}};}
function client(events:CalendarEvent[]=[event()]) {
  return {allMonth:vi.fn(async()=>({events,complete:true})),groups:vi.fn(async()=>[{id:'grp_one',name:'Real group'}])} as unknown as Client;
}
function fixture(events:CalendarEvent[]=[event()]) {let now=origin;const backend=client(events),disk=storage();const sync=new CalendarSynchronizer('usr_one',backend,disk,()=>now);return {sync,backend,disk,time:(value:number)=>{now=value;}};}
describe('real calendar synchronization and reminders',()=>{
  it('uses first snapshot only as a baseline and deduplicates a real upcoming reminder',async()=>{
    const {sync,backend,time}=fixture();await sync.sync();expect(sync.state.reminders).toEqual([]);expect(backend.allMonth).toHaveBeenCalledTimes(2);
    time(origin+6*60_000);await sync.sync();expect(sync.state.reminders).toHaveLength(1);expect(sync.state.reminders[0].event).toMatchObject({id:'cal_one',group:{name:'Real group'}});
    time(origin+7*60_000);await sync.sync();expect(sync.state.reminders).toHaveLength(1);
  });
  it('never creates reminders for unfollowed, past or malformed dates',async()=>{
    const records=[{...event(),isFollowing:false},{...event(origin-1000),id:'cal_past'},{...event(),id:'cal_invalid',startsAt:'invalid'}];
    const {sync,time}=fixture(records);await sync.sync();time(origin+6*60_000);await sync.sync();expect(sync.state.reminders).toEqual([]);
  });
  it('prunes expired cached reminders and confirmed unfollowed or rescheduled events',async()=>{
    const {sync,backend,disk,time}=fixture();await sync.sync();time(origin+6*60_000);await sync.sync();expect(sync.state.reminders).toHaveLength(1);
    const expired=new CalendarSynchronizer('usr_one',backend,disk,()=>origin+21*60_000);expect(expired.state.reminders).toEqual([]);
    vi.mocked(backend.allMonth).mockResolvedValue({events:[{...event(),isFollowing:false}],complete:true});await sync.sync();expect(sync.state.reminders).toEqual([]);
  });
  it('restores cache and reminder deduplication per account and keeps dismissal after reopening',async()=>{
    const {sync,backend,disk,time}=fixture();await sync.sync();time(origin+6*60_000);await sync.sync();
    const id=sync.state.reminders[0].id;sync.dismissReminder(id);
    const restored=new CalendarSynchronizer('usr_one',backend,disk,()=>origin+7*60_000);expect(restored.state.events).toHaveLength(1);await restored.sync();expect(restored.state.reminders).toEqual([]);
    const other=new CalendarSynchronizer('usr_other',backend,disk);expect(other.state.events).toEqual([]);expect(other.state.reminders).toEqual([]);
  });
  it('keeps successful data when the next network or permission request fails',async()=>{
    const {sync,backend}=fixture();await sync.sync();const old=sync.state.events;
    vi.mocked(backend.allMonth).mockRejectedValue(Object.assign(new Error('Permission denied'),{status:403}));
    await sync.sync();expect(sync.state.events).toBe(old);expect(sync.state.error).toContain('Permission denied');
  });
  it('respects rate limits and stops periodic retry after an expired session',async()=>{
    const {sync,backend}=fixture();vi.mocked(backend.allMonth).mockRejectedValue(Object.assign(new Error('Rate limited'),{status:429,retryAfter:900}));
    expect(await sync.sync()).toMatchObject({retryAfter:900_000});
  });
  it('keeps a 429 cooldown across background pauses and explicit refreshes',async()=>{
    const {sync,backend,time}=fixture();vi.mocked(backend.allMonth).mockRejectedValueOnce(Object.assign(new Error('Rate limited'),{status:429,retryAfter:900}));
    await sync.sync();sync.pause();sync.retryAuthentication();time(origin+60_000);
    expect(await sync.sync()).toMatchObject({applied:false,retryAfter:840_000});expect(backend.allMonth).toHaveBeenCalledOnce();
    time(origin+901_000);await sync.sync();expect(backend.allMonth).toHaveBeenCalledTimes(3);expect(sync.state.events).toHaveLength(1);
  });
  it('keeps a 401 stopped across foreground transitions until an explicit user retry',async()=>{
    const {sync,backend}=fixture();vi.mocked(backend.allMonth).mockRejectedValueOnce(Object.assign(new Error('Session expired'),{status:401}));
    expect((await sync.sync()).retryAfter).toBe(Infinity);sync.pause();
    expect(await sync.sync()).toMatchObject({applied:false,retryAfter:Infinity});expect(backend.allMonth).toHaveBeenCalledOnce();
    sync.retryAuthentication();await sync.sync();expect(backend.allMonth).toHaveBeenCalledTimes(3);expect(sync.state.events).toHaveLength(1);
  });
  it('does not commit a late snapshot received across a foreground interruption',async()=>{
    let complete!:(value:{events:CalendarEvent[];complete:boolean})=>void;
    const backend=client();vi.mocked(backend.allMonth).mockImplementationOnce(()=>new Promise((resolve)=>{complete=resolve;}));
    const sync=new CalendarSynchronizer('usr_one',backend,storage(),()=>origin);
    const first=sync.sync();expect(sync.sync()).toBe(first);sync.pause();complete({events:[event()],complete:true});
    expect(await first).toMatchObject({applied:false});expect(sync.state.events).toEqual([]);expect(sync.state.loading).toBe(false);
    await sync.sync();expect(sync.state.events).toHaveLength(1);expect(sync.state.reminders).toEqual([]);
  });
  it('keeps actual events while visibly reporting incomplete sync or missing group names',async()=>{
    const {sync,backend}=fixture();vi.mocked(backend.allMonth).mockResolvedValue({events:[event()],complete:false});vi.mocked(backend.groups).mockRejectedValue(new Error('Group names unavailable'));
    await sync.sync();expect(sync.state.events).toHaveLength(1);expect(sync.state.error).toContain('часть событий');expect(sync.state.error).toContain('Group names unavailable');
  });
  it('retains an actual cached event missing from a bounded partial snapshot, but removes it after a complete snapshot',async()=>{
    const {sync,backend}=fixture();await sync.sync();
    vi.mocked(backend.allMonth).mockResolvedValue({events:[],complete:false});await sync.sync();
    expect(sync.state.events).toHaveLength(1);expect(sync.state.error).toContain('ранее загруженные');
    vi.mocked(backend.allMonth).mockResolvedValue({events:[],complete:true});await sync.sync();expect(sync.state.events).toEqual([]);
  });
  it('does not hide a group-list rate limit behind a successful event snapshot',async()=>{
    const {sync,backend}=fixture();vi.mocked(backend.groups).mockRejectedValue(Object.assign(new Error('Group rate limit'),{status:429,retryAfter:1000}));
    expect((await sync.sync()).retryAfter).toBe(1_000_000);expect(sync.state.error).toContain('Group rate limit');
  });
  it('reports persistence failures and malformed cache without inventing rows',async()=>{
    const disk={getItem:()=>'{broken',setItem:()=>{throw new Error('Disk full');}};
    const sync=new CalendarSynchronizer('usr_one',client(),disk,()=>origin);expect(sync.state.error).toContain('прочитать');expect(sync.state.events).toEqual([]);
    await sync.sync();expect(sync.state.events).toHaveLength(1);expect(sync.state.error).toContain('сохранить');
  });
});
