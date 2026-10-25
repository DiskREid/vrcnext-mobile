import { describe, expect, it } from 'vitest';
import type { User, World } from '../api';
import { buildWorldInstances, disclosedInstanceLocation, disclosedInstanceRegion } from './world-instances';

const id = 'wrld_test';
const location = `${id}:123~region(eu)`;
const user = (id: string, location?: string, extra: Partial<User> = {}): User => ({ id, displayName: id, location, ...extra });
const world = (instances: World['instances'] = []): Pick<World, 'id' | 'instances'> => ({ id, instances });

describe('world instance friends', () => {
  it('preserves API order and matches full instance locations, not the world or short number', () => {
    const rows = buildWorldInstances(world([['456~region(jp)', 12], ['123~region(eu)', 20]]), [
      user('usr_same', location),
      user('usr_other-instance', `${id}:456~region(jp)`),
      user('usr_other-world', 'wrld_other:123~region(eu)'),
      user('usr_other-access', `${id}:123~friends(usr_host)~region(eu)`),
    ]);
    expect(rows.map((row) => row.location)).toEqual([`${id}:456~region(jp)`, location, `${id}:123~friends(usr_host)~region(eu)`]);
    expect(rows[0]).toMatchObject({ count: 12, region: 'jp', source: 'api' });
    expect(rows[1].friends.map((friend) => friend.id)).toEqual(['usr_same']);
    expect(rows[2].friends.map((friend) => friend.id)).toEqual(['usr_other-access']);
  });
  it('appends disclosed Friends+, group and invite instances missing from the public list without inventing totals', () => {
    const hidden = `${id}:456~hidden(usr_host)~region(eu)`;
    const group = `${id}:789~group(grp_a)~groupAccessType(public)~region(use)`;
    const invite = `${id}:999~private(usr_host)~canRequestInvite`;
    const rows = buildWorldInstances(world([['123~region(eu)', 2]]), [user('usr_hidden', hidden), user('usr_group', group), user('usr_invite', invite)]);
    expect(rows.map((row) => row.source)).toEqual(['api', 'friends', 'friends', 'friends']);
    expect(rows.slice(1).map((row) => row.type)).toEqual(['Friends+', 'Group · public', 'Invite+']);
    expect(rows.slice(1).every((row) => row.count === undefined)).toBe(true);
    expect(rows[3].region).toBeUndefined();
  });
  it('does not turn private/offline/traveling or missing locations into a shared instance', () => {
    const fields = { worldId: id, instanceId: '123~region(eu)' };
    const rows = buildWorldInstances(world(), [
      user('usr_private', 'private', fields), user('usr_private2', 'private'), user('usr_offline', 'offline', fields),
      user('usr_traveling', 'traveling'), user('usr_empty', '', fields), user('usr_unknown'),
      user('usr_false', location, { isFriend: false }),
    ]);
    expect(rows).toEqual([]);
  });
  it('uses worldId and instanceId disclosed together when location is absent', () => {
    const rows = buildWorldInstances(world([['123~region(eu)', 2]]), [user('usr_fields', undefined, { worldId: id, instanceId: '123~region(eu)' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].friends.map((friend) => friend.id)).toEqual(['usr_fields']);
  });
  it('deduplicates by friend ID and lets a fresh private/offline or non-friend row replace an old location', () => {
    const old = user('usr_changed', location);
    const rows = buildWorldInstances(world([['123~region(eu)', 2]]), [old, user('usr_changed', 'private'),
      user('usr_offline', location), user('usr_offline', 'offline'), user('usr_removed', location), user('usr_removed', location, { isFriend: false }),
      user('usr_live', location), user('usr_live', location, { displayName: 'Fresh name' }),
    ]);
    expect(rows[0].friends).toEqual([user('usr_live', location, { displayName: 'Fresh name' })]);
  });
  it('normalizes full locations without double-prefixing and deduplicates API tuples in first-seen order', () => {
    const rows = buildWorldInstances(world([['123~region(eu)', 2, { eng: 0.8 }], [location, 3], ['789', 1], ['wrld_other:123', 99]]), []);
    expect(rows.map((row) => [row.location, row.count])).toEqual([[location, 3], [`${id}:789`, 1]]);
  });
  it('keeps unknown counts unknown rather than using the friend count or coercing strings', () => {
    const invalid = [-1, 1.5, NaN, Infinity, '7', null, undefined];
    const tuples = invalid.map((count, index) => [`${index}`, count]) as World['instances'];
    const rows = buildWorldInstances(world([['zero', 0], ...tuples!]), [user('usr_one', `${id}:1`)]);
    expect(rows[0].count).toBe(0);
    expect(rows.slice(1).every((row) => row.count === undefined)).toBe(true);
    expect(rows.find((row) => row.instanceId === '1')?.friends).toHaveLength(1);
  });
  it('rejects malformed IDs and external syntax without losing legitimate rows', () => {
    const tuples = [['../auth', 1], ['123?x=y', 2], ['123#fragment', 3], ['private', 4], ['offline', 5],
      ['123:456', 6], ['', 7], ['a'.repeat(4097), 8], ['valid', 9], null] as unknown as World['instances'];
    const rows = buildWorldInstances(world(tuples), [user('https://bad.example', `${id}:valid`), user('usr_bad', 'https://bad.example')]);
    expect(rows.map((row) => row.instanceId)).toEqual(['valid']);
    expect(buildWorldInstances({ id: 'https://bad.example', instances: [['valid', 9]] }, [])).toEqual([]);
  });
});

describe('disclosed instance region', () => {
  it('keeps an absent/ambiguous region unknown instead of assuming US', () => {
    expect(disclosedInstanceRegion(location)).toBe('eu');
    expect(disclosedInstanceRegion(`${id}:1~region(jp)`)).toBe('jp');
    expect(disclosedInstanceRegion(`${id}:1`)).toBeUndefined();
    expect(disclosedInstanceRegion(`${id}:1~region(eu)~region(jp)`)).toBeUndefined();
  });
});

describe('returned group instance location', () => {
  it('uses disclosed complete locations or fields from the same returned object', () => {
    expect(disclosedInstanceLocation({ location })).toBe(location);
    expect(disclosedInstanceLocation({ id: location })).toBe(location);
    expect(disclosedInstanceLocation({ instanceId: location })).toBe(location);
    expect(disclosedInstanceLocation({ worldId: id, instanceId: '123~region(eu)' })).toBe(location);
    expect(disclosedInstanceLocation({ world: { id, name: 'World' }, id: '123~region(eu)' })).toBe(location);
    expect(disclosedInstanceLocation({ location: 'private', id: location, worldId: id, instanceId: '123~region(eu)' })).toBeUndefined();
    expect(disclosedInstanceLocation({ id: location, instanceId: 'private' })).toBeUndefined();
    expect(disclosedInstanceLocation({ id: location, worldId: 'wrld_other' })).toBeUndefined();
    expect(disclosedInstanceLocation({ location, worldId: 'wrld_other' })).toBeUndefined();
    expect(disclosedInstanceLocation({ id: location, instanceId: `${id}:456` })).toBeUndefined();
    expect(disclosedInstanceLocation({ instanceId: '123' })).toBeUndefined();
    expect(disclosedInstanceLocation({ id: 'https://bad.example', worldId: id })).toBeUndefined();
  });
});
