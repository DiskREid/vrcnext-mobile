import type { User } from '../api';

export type ObservationSource = 'api' | 'pipeline';
export type VisitEndReason = 'location-change' | 'offline' | 'observation-gap';
export interface GameParticipant {
  userId: string;
  displayName: string;
  start: string;
  end?: string;
  lastObserved: string;
}
export interface GameVisit {
  id: string;
  sessionId: string;
  location: string;
  worldId: string;
  start: string;
  end?: string;
  lastObserved: string;
  reason: VisitEndReason;
  source: ObservationSource;
  participants: GameParticipant[];
}
export interface GameSession {
  id: string;
  start: string;
  end?: string;
  lastObserved: string;
}
export interface GameData { visits: GameVisit[]; sessions: GameSession[]; }
export interface FriendStatistics { encounters: number; totalMs: number; lastMeeting?: string; }

const empty = (): GameData => ({ visits: [], sessions: [] });
const copyVisit = (visit: GameVisit): GameVisit => ({ ...visit, participants: visit.participants.map((p) => ({ ...p })) });
export function realLocation(value: unknown): value is string {
  return typeof value === 'string' && /^wrld_[a-zA-Z0-9-]+:[a-zA-Z0-9~_().+\-]+$/.test(value)
    && !['offline', 'private', 'traveling'].includes(value.slice(value.indexOf(':') + 1).split('~')[0]);
}
/** Compose only fields disclosed together in this sample; explicit hidden/offline values win. */
export function observedLocation(user: Pick<User, 'location' | 'worldId' | 'instanceId'>): string | undefined {
  if (user.location !== undefined) return realLocation(user.location) ? user.location : undefined;
  if (typeof user.worldId !== 'string' || !/^wrld_[a-zA-Z0-9-]+$/.test(user.worldId)
    || typeof user.instanceId !== 'string') return;
  const location = `${user.worldId}:${user.instanceId}`;
  return realLocation(location) ? location : undefined;
}
/** Never extrapolate an unfinished interval beyond its last actual sample. */
export function intervalMs(interval: { start: string; end?: string; lastObserved: string }) {
  const start = Date.parse(interval.start), observed = Date.parse(interval.lastObserved);
  const end = Math.min(interval.end ? Date.parse(interval.end) : observed, observed);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}
export function closeInterrupted(data: GameData, activeVisit?: string, activeSession?: string): GameData {
  return {
    visits: data.visits.filter((visit) => !visit.end && visit.id !== activeVisit).map((visit) => ({
      ...copyVisit(visit), end: visit.lastObserved, reason: 'observation-gap',
      participants: visit.participants.map((participant) => participant.end ? { ...participant } : { ...participant, end: participant.lastObserved }),
    })),
    sessions: data.sessions.filter((session) => !session.end && session.id !== activeSession).map((session) => ({ ...session, end: session.lastObserved })),
  };
}

/** Samples describe observed locations, not access to the game's private logs or all occupants. */
export class GameObserver {
  private visit?: GameVisit;
  private session?: GameSession;
  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly id: () => string = () => crypto.randomUUID(),
    private readonly maximumSampleGapMs = 5 * 60_000,
  ) {}
  get activeVisit() { return this.visit?.id; }
  get activeSession() { return this.session?.id; }

  private endVisit(reason: VisitEndReason): GameVisit | undefined {
    if (!this.visit) return;
    const closed: GameVisit = {
      ...copyVisit(this.visit), end: this.visit.lastObserved, reason,
      participants: this.visit.participants.map((p) => p.end ? { ...p } : { ...p, end: p.lastObserved }),
    };
    this.visit = undefined;
    return closed;
  }
  pause(reason: VisitEndReason = 'observation-gap'): GameData {
    const changes = empty();
    const visit = this.endVisit(reason);
    if (visit) changes.visits.push(visit);
    if (this.session) changes.sessions.push({ ...this.session, end: this.session.lastObserved });
    this.session = undefined;
    return changes;
  }
  observe(self: User, friends: User[], source: ObservationSource): GameData {
    const time = this.now();
    const stamp = Date.parse(time);
    if (!Number.isFinite(stamp)) return empty();
    const changes = empty();
    if (this.session) {
      const gap = stamp - Date.parse(this.session.lastObserved);
      // Handles process suspension, lost visibility events, clock reversal and late queued samples.
      if (gap > this.maximumSampleGapMs || gap < 0) {
        const closed = this.pause(); changes.visits.push(...closed.visits); changes.sessions.push(...closed.sessions);
      }
    }
    const location = observedLocation(self);
    if (!location) {
      const offline = [self.location, self.worldId, self.instanceId].includes('offline');
      const closed = this.pause(offline ? 'offline' : 'observation-gap');
      changes.visits.push(...closed.visits); changes.sessions.push(...closed.sessions);
      return changes;
    }
    if (!this.session) this.session = { id: this.id(), start: time, lastObserved: time };
    else this.session = { ...this.session, lastObserved: time };
    changes.sessions.push({ ...this.session });
    if (this.visit && this.visit.location !== location) {
      const old = this.endVisit('location-change'); if (old) changes.visits.push(old);
    }
    if (!this.visit) this.visit = {
      id: this.id(), sessionId: this.session.id, location,
      worldId: location.split(':')[0], start: time, lastObserved: time,
      reason: 'observation-gap', source, participants: [],
    };
    const seen = new Map(friends.filter((friend) => friend.id !== self.id && observedLocation(friend) === location && friend.state !== 'offline').map((friend) => [friend.id, friend]));
    const participants = this.visit.participants.map((prior): GameParticipant => {
      if (prior.end) return { ...prior };
      const friend = seen.get(prior.userId);
      if (!friend) return { ...prior, end: prior.lastObserved };
      seen.delete(prior.userId);
      return { ...prior, displayName: friend.displayName || prior.displayName, lastObserved: time };
    });
    for (const friend of seen.values()) participants.push({ userId: friend.id, displayName: friend.displayName || friend.id, start: time, lastObserved: time });
    this.visit = { ...this.visit, lastObserved: time, participants };
    changes.visits.push(copyVisit(this.visit));
    return changes;
  }
}

/** Sum the union of known intervals, preventing duplicate/overlapping samples inflating a total. */
export function unionDuration(intervals: { start: string; end?: string; lastObserved: string }[]): number {
  const sorted = intervals.map((interval) => {
    const start = Date.parse(interval.start), last = Date.parse(interval.lastObserved);
    const end = Math.min(interval.end ? Date.parse(interval.end) : last, last);
    return [start, end] as const;
  }).filter(([start,end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start).sort((a,b) => a[0] - b[0]);
  let total = 0, start: number | undefined, end = 0;
  for (const [nextStart,nextEnd] of sorted) {
    if (start === undefined) { start = nextStart; end = nextEnd; }
    else if (nextStart > end) { total += end - start; start = nextStart; end = nextEnd; }
    else end = Math.max(end,nextEnd);
  }
  return total + (start === undefined ? 0 : end - start);
}
export function friendStatistics(visits: GameVisit[], userId: string): FriendStatistics {
  const intervals = new Map<string, GameParticipant>();
  for (const visit of visits) for (const p of visit.participants)
    if (p.userId === userId) intervals.set(`${visit.id}:${p.userId}:${p.start}`,p);
  const values = [...intervals.values()];
  const lastMeeting = values.map((p) => p.lastObserved).sort().at(-1);
  return { encounters: values.length, totalMs: unionDuration(values), ...(lastMeeting ? { lastMeeting } : {}) };
}
