import type { GameParticipant, GameVisit } from './game-history';

export interface NumericRange {
  start: number;
  end: number;
}
export interface ClippedInterval extends NumericRange {
  ms: number;
}
export interface TimelineParticipant extends ClippedInterval {
  participant: GameParticipant;
}
export interface TimelineVisit extends ClippedInterval {
  visit: GameVisit;
  participants: TimelineParticipant[];
}
export interface ChartAnalytics {
  activeMs: number;
  visitCount: number;
  worldCount: number;
  instanceCount: number;
  worlds: { id: string; visits: number; totalMs: number }[];
  friends: {
    id: string;
    displayName: string;
    encounters: number;
    totalMs: number;
    lastMeeting?: string;
  }[];
}

export function localDayKey(date = new Date()): string {
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

/** Calendar midnights, rather than an assumed 24 hours, preserve local DST boundaries. */
export function dayBounds(day: string): NumericRange | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return;
  const year = Number(match[1]), month = Number(match[2]) - 1, date = Number(match[3]);
  const start = new Date(0);
  start.setFullYear(year, month, date);
  start.setHours(0, 0, 0, 0);
  if (start.getFullYear() !== year || start.getMonth() !== month || start.getDate() !== date) return;
  const end = new Date(start);
  end.setDate(date + 1);
  end.setHours(0, 0, 0, 0);
  if (!Number.isFinite(start.getTime()) || end <= start) return;
  return { start: start.getTime(), end: end.getTime() };
}

/** A single observation is a point; missing samples are never extended to the current time. */
export function clippedInterval(
  interval: { start: string; end?: string; lastObserved: string },
  range?: NumericRange,
): ClippedInterval | undefined {
  const originalStart = Date.parse(interval.start), observed = Date.parse(interval.lastObserved);
  const originalEnd = Math.min(interval.end === undefined ? observed : Date.parse(interval.end), observed);
  if (!Number.isFinite(originalStart) || !Number.isFinite(originalEnd) || originalEnd < originalStart) return;
  if (!range) return { start: originalStart, end: originalEnd, ms: originalEnd - originalStart };
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end < range.start) return;
  if (range.start === range.end) {
    return originalStart <= range.start && originalEnd >= range.start
      ? { start: range.start, end: range.start, ms: 0 }
      : undefined;
  }
  // Days are half-open. An interval ending at midnight belongs to the preceding day;
  // an actual point observed at that midnight belongs to the new day.
  if (originalStart >= range.end || originalEnd < range.start
    || (originalEnd === range.start && originalStart < range.start)) return;
  const start = Math.max(originalStart, range.start), end = Math.min(originalEnd, range.end);
  return end >= start ? { start, end, ms: end - start } : undefined;
}

function uniqueVisits(visits: GameVisit[]): GameVisit[] {
  const unique = new Map<string, GameVisit>();
  for (const visit of visits) {
    const previous = unique.get(visit.id);
    const time = Date.parse(visit.lastObserved), oldTime = previous ? Date.parse(previous.lastObserved) : -Infinity;
    if (!Number.isFinite(time)) continue;
    if (!previous || time > oldTime || (time === oldTime && (visit.end !== undefined || previous.end === undefined))) unique.set(visit.id, visit);
  }
  return [...unique.values()];
}

function visitsInRange(visits: GameVisit[], range?: NumericRange): TimelineVisit[] {
  const result: TimelineVisit[] = [];
  for (const visit of uniqueVisits(visits)) {
    const clipped = clippedInterval(visit, range);
    if (!clipped) continue;
    const participants = new Map<string, TimelineParticipant>();
    for (const participant of visit.participants) {
      const bounds = clippedInterval(participant, clipped);
      if (!bounds || !participant.userId) continue;
      const key = `${participant.userId}:${participant.start}`;
      const previous = participants.get(key);
      if (!previous || bounds.end >= previous.end) participants.set(key, { participant, ...bounds });
    }
    result.push({ visit, ...clipped, participants: [...participants.values()] });
  }
  return result.sort((a, b) => a.start - b.start || a.visit.id.localeCompare(b.visit.id));
}

export function timelineVisits(visits: GameVisit[], day: string): TimelineVisit[] {
  const range = dayBounds(day);
  return range ? visitsInRange(visits, range) : [];
}

function union(intervals: NumericRange[]): number {
  const sorted = intervals.slice().sort((a, b) => a.start - b.start);
  let total = 0, start: number | undefined, end = 0;
  for (const interval of sorted) {
    if (start === undefined) { start = interval.start; end = interval.end; }
    else if (interval.start > end) { total += end - start; start = interval.start; end = interval.end; }
    else end = Math.max(end, interval.end);
  }
  return total + (start === undefined ? 0 : end - start);
}

export function analytics(visits: GameVisit[], day?: string): ChartAnalytics {
  const range = day === undefined ? undefined : dayBounds(day);
  const rows = day !== undefined && !range ? [] : visitsInRange(visits, range);
  const worlds = new Map<string, TimelineVisit[]>();
  const friends = new Map<string, { names: { time: number; name: string }; intervals: TimelineParticipant[]; encounters: Set<string> }>();
  for (const row of rows) {
    const group = worlds.get(row.visit.worldId) || [];
    group.push(row); worlds.set(row.visit.worldId, group);
    for (const participant of row.participants) {
      const id = participant.participant.userId, time = Date.parse(participant.participant.lastObserved);
      const known = friends.get(id) || { names: { time, name: participant.participant.displayName || id }, intervals: [], encounters: new Set<string>() };
      if (time >= known.names.time) known.names = { time, name: participant.participant.displayName || id };
      known.intervals.push(participant);
      known.encounters.add(`${row.visit.id}:${participant.participant.start}`);
      friends.set(id, known);
    }
  }
  return {
    activeMs: union(rows), visitCount: rows.length, worldCount: worlds.size,
    instanceCount: new Set(rows.map((row) => row.visit.location)).size,
    worlds: [...worlds].map(([id, group]) => ({ id, visits: group.length, totalMs: union(group) }))
      .sort((a, b) => b.totalMs - a.totalMs || b.visits - a.visits || a.id.localeCompare(b.id)),
    friends: [...friends].map(([id, friend]) => {
      const lastMeeting = friend.intervals.reduce((latest, interval) => Math.max(latest, interval.end), -Infinity);
      return {
        id, displayName: friend.names.name, encounters: friend.encounters.size,
        totalMs: union(friend.intervals),
        ...(Number.isFinite(lastMeeting) ? { lastMeeting: new Date(lastMeeting).toISOString() } : {}),
      };
    }).sort((a, b) => b.encounters - a.encounters || b.totalMs - a.totalMs || a.id.localeCompare(b.id)),
  };
}

const colors = ['#a398ff', '#82c9b3', '#dfaf8b', '#83bbef', '#e4a3c0', '#72c6ce', '#c5b481', '#ad9dc7'];
export function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return colors[hash % colors.length];
}
