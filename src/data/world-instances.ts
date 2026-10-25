import type { Instance, User, World } from '../api';
import { instanceCount } from './instance-location';
import { accessibleLocation, disclosedUserLocation, instanceType } from './locations';

export interface WorldInstanceRow {
  location: string;
  instanceId: string;
  count?: number;
  friends: User[];
  source: 'api' | 'friends';
  type: string;
  region?: string;
}

/** Accept bare API instance IDs or an already complete location for this exact world. */
function worldLocation(worldId: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return;
  const location = value.includes(':') ? value : `${worldId}:${value}`;
  if (!accessibleLocation(location) || location.slice(0, location.indexOf(':')) !== worldId) return;
  return location;
}

/** No region is inferred from the absence of a tag or from another user's location. */
export function disclosedInstanceRegion(location: string): string | undefined {
  const regions = new Set([...location.matchAll(/~region\(([a-zA-Z0-9_-]+)\)(?=~|$)/g)].map((match) => match[1]));
  return regions.size === 1 ? [...regions][0] : undefined;
}

/** Resolve one returned instance object without borrowing location fields from another row. */
export function disclosedInstanceLocation(instance: Instance): string | undefined {
  const expectedWorld = instance.worldId ?? instance.world?.id;
  if (expectedWorld !== undefined && (typeof expectedWorld !== 'string' || !/^wrld_[a-zA-Z0-9-]+$/.test(expectedWorld))) return;
  if (instance.location !== undefined) return typeof instance.location === 'string'
    && instance.location.length <= 4096 && accessibleLocation(instance.location)
    && (expectedWorld === undefined || instance.location.split(':')[0] === expectedWorld) ? instance.location : undefined;
  const candidates = [instance.id, instance.instanceId];
  if (candidates.some((value) => typeof value === 'string' && ['private', 'offline', 'traveling', ''].includes(value))) return;
  const full = new Set<string>();
  for (const value of candidates) {
    if (typeof value !== 'string' || !value.includes(':')) continue;
    if (value.length > 4096 || !accessibleLocation(value)) return;
    if (expectedWorld !== undefined && value.slice(0, value.indexOf(':')) !== expectedWorld) return;
    full.add(value);
  }
  if (full.size > 1) return;
  if (full.size === 1) return [...full][0];
  if (!expectedWorld) return;
  return worldLocation(expectedWorld, instance.instanceId ?? instance.id);
}

/** Merge actual listed instances with disclosed friend locations without fetching every instance. */
export function buildWorldInstances(world: Pick<World, 'id' | 'instances'>, friends: User[]): WorldInstanceRow[] {
  if (typeof world.id !== 'string' || !/^wrld_[a-zA-Z0-9-]+$/.test(world.id)) return [];
  const rows = new Map<string, WorldInstanceRow>();
  const makeRow = (location: string, source: WorldInstanceRow['source'], count?: number): WorldInstanceRow => ({
    location,
    instanceId: location.slice(location.indexOf(':') + 1),
    ...(count === undefined ? {} : { count }),
    friends: [],
    source,
    type: instanceType(location),
    region: disclosedInstanceRegion(location),
  });
  if (Array.isArray(world.instances)) for (const value of world.instances) {
    if (!Array.isArray(value)) continue;
    const location = worldLocation(world.id, value[0]);
    if (!location) continue;
    const count = instanceCount(value[1]);
    const previous = rows.get(location);
    if (!previous) rows.set(location, makeRow(location, 'api', count));
    else if (count !== undefined) previous.count = count;
  }
  // Resolve duplicate IDs before matching, so a fresh private/offline row removes old evidence.
  const latest = new Map<string, User>();
  for (const friend of friends) {
    if (!friend || typeof friend !== 'object' || typeof friend.id !== 'string' || !/^usr_[a-zA-Z0-9-]+$/.test(friend.id)) continue;
    latest.set(friend.id, friend);
  }
  for (const friend of latest.values()) {
    if (friend.isFriend === false) continue;
    const location = worldLocation(world.id, disclosedUserLocation(friend));
    if (!location) continue;
    let row = rows.get(location);
    if (!row) { row = makeRow(location, 'friends'); rows.set(location, row); }
    row.friends.push(friend);
  }
  return [...rows.values()];
}
