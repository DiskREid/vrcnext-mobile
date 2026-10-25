import { describe, expect, it } from 'vitest';
import { pipelineActivity } from './session-activity';
import type { User } from '../api';
const self: User = { id: 'usr_self', displayName: 'Me' };
const friend: User = { id: 'usr_friend', displayName: 'Luna', location: 'wrld_old:1~hidden(usr_host)' };
describe('session activity navigation targets', () => {
  it('keeps the real user and both disclosed world locations before updating a friend', () => {
    expect(pipelineActivity({ type: 'friend-location', content: { userId: friend.id, location: 'wrld_new:2' } }, [friend], self)).toEqual({
      title: 'Друг сменил мир', detail: 'Luna', userId: friend.id, displayName: 'Luna', beforeLocation: friend.location, location: 'wrld_new:2', worldId: 'wrld_new',
    });
  });
  it('distinguishes another instance of the same world from changing worlds', () => {
    expect(pipelineActivity({ type: 'friend-location', content: { userId: friend.id, location: 'wrld_old:2' } }, [friend], self)?.title).toBe('Друг сменил инстанс');
  });
  it('records hidden locations without inventing a destination world or an unknown origin', () => {
    expect(pipelineActivity({ type: 'friend-location', content: { userId: 'usr_unknown', location: 'private' } }, [], self)).toMatchObject({ location: 'private', userId: 'usr_unknown' });
    expect(pipelineActivity({ type: 'friend-location', content: { userId: 'usr_unknown', location: 'private' } }, [], self)).not.toHaveProperty('worldId');
    expect(pipelineActivity({ type: 'friend-location', content: { userId: 'usr_unknown', location: 'private' } }, [], self)).not.toHaveProperty('beforeLocation');
  });
  it('uses actual alternate ID fields and partial display names without requiring a cached friend', () => {
    expect(pipelineActivity({ type: 'friend-online', content: { userid: 'usr_new', user: { displayName: 'New friend' } } }, [], self)).toMatchObject({ userId: 'usr_new', displayName: 'New friend' });
    expect(pipelineActivity({ type: 'friend-update', content: { user: { id: 'usr_new', displayName: 'Name' } } }, [], self)).toMatchObject({ userId: 'usr_new' });
  });
  it('does not make targets from unknown events, arbitrary URLs or missing notification senders', () => {
    expect(pipelineActivity({ type: 'unknown', content: {} }, [], self)).toBeUndefined();
    expect(pipelineActivity({ type: 'friend-online', content: { userId: 'https://bad.example' } }, [], self)).not.toHaveProperty('userId');
    expect(pipelineActivity({ type: 'notification', content: { userId: friend.id } }, [friend], self)).not.toHaveProperty('userId');
  });
});
