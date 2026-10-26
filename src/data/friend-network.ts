import type { User } from '../api';
import { presenceMode } from './presence';
import type { PresenceMode } from './presence';

export interface GraphPerson {
  id: string;
  displayName: string;
  status?: string;
  statusDescription?: string;
}
export interface GraphObservation {
  userId: string;
  displayName?: string;
  mutuals: GraphPerson[];
  observedAt: string;
  complete: boolean;
  error?: string;
  status?: number;
}
export interface GraphNode extends GraphPerson {
  self: boolean;
  friend: boolean;
  component: number;
  /** Current friend data only; saved graph labels cannot establish live presence. */
  presence: PresenceMode;
}
export interface GraphEdge {
  source: string;
  target: string;
  sourceType: 'friends' | 'mutual';
  observedAt?: string;
}
export interface KnownGraph { nodes: GraphNode[]; edges: GraphEdge[]; }
export interface MutualScanOptions {
  now?: () => string;
  cancelled?: () => boolean;
  onProgress?: (loaded: number) => void;
}

const MAX_PAGES = 25;
const PAGE_SIZE = 100;
const MAX_RECORDS = MAX_PAGES * PAGE_SIZE;
const MAX_OBSERVATIONS = 20;
const MAX_CACHE_RECORDS = 5000;
const MAX_CACHE_CHARACTERS = 2_000_000;
const CACHE_TTL = 15 * 60_000;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const validId = (id: unknown): id is string => typeof id === 'string' && /^usr_[a-zA-Z0-9-]{1,128}$/.test(id);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Persist only documented public graph labels, never arbitrary user/auth response fields. */
export function normalizeGraphPerson(value: unknown): GraphPerson | undefined {
  const person = record(value);
  if (!person || !validId(person.id)) return;
  return {
    id: person.id,
    displayName: typeof person.displayName === 'string' && person.displayName.trim()
      ? person.displayName.slice(0, 128) : person.id,
    ...(typeof person.status === 'string' ? { status: person.status.slice(0, 64) } : {}),
    ...(typeof person.statusDescription === 'string' ? { statusDescription: person.statusDescription.slice(0, 256) } : {}),
  };
}

function observation(value: unknown): GraphObservation | undefined {
  const source = record(value);
  if (!source || !validId(source.userId) || !Array.isArray(source.mutuals)
    || typeof source.observedAt !== 'string' || !Number.isFinite(Date.parse(source.observedAt))
    || typeof source.complete !== 'boolean') return;
  const mutuals = new Map<string, GraphPerson>();
  for (const item of source.mutuals.slice(0, MAX_RECORDS)) {
    const person = normalizeGraphPerson(item);
    if (!person) return;
    if (person.id !== source.userId) mutuals.set(person.id, person);
  }
  const truncated = source.mutuals.length > MAX_RECORDS;
  const status = typeof source.status === 'number' && Number.isInteger(source.status)
    && source.status >= 100 && source.status <= 599 ? source.status : undefined;
  return {
    userId: source.userId,
    ...(typeof source.displayName === 'string' ? { displayName: source.displayName.slice(0, 128) } : {}),
    mutuals: [...mutuals.values()],
    observedAt: new Date(source.observedAt).toISOString(),
    complete: source.complete && !truncated,
    ...(status ? { status } : {}),
    // API messages are not persisted: they can contain unrelated response data.
    ...(!source.complete || truncated ? { error: status === 403
      ? 'Список общих друзей закрыт пользователем.'
      : 'Сохранённый снимок связей неполный. Повторите проверку.' } : {}),
  };
}

/** Each mutual response proves its two stated links; it does not prove links between other results. */
export function buildKnownGraph(self: User, friends: User[], observations: GraphObservation[]): KnownGraph {
  const people = new Map<string, GraphPerson>();
  const friendIds = new Set<string>();
  const liveFriends = new Map(friends.map((friend) => [friend.id, friend]));
  const edges = new Map<string, GraphEdge>();
  const own = normalizeGraphPerson(self);
  if (!own) return { nodes: [], edges: [] };
  const put = (person: GraphPerson) => people.set(person.id, { ...people.get(person.id), ...person });
  const link = (first: string, second: string, sourceType: GraphEdge['sourceType'], observedAt?: string) => {
    if (first === second) return;
    const [source, target] = [first, second].sort(compare), key = `${source}\0${target}`;
    const previous = edges.get(key);
    if (previous?.sourceType === 'friends') return;
    if (sourceType === 'friends' || !previous || compare(observedAt || '', previous.observedAt || '') > 0)
      edges.set(key, { source, target, sourceType, ...(observedAt ? { observedAt } : {}) });
  };
  put(own);
  // Old snapshots contribute historical labels; current known profiles take priority below.
  for (const raw of [...observations].sort((a, b) => compare(a.observedAt, b.observedAt))) {
    const snapshot = observation(raw);
    if (!snapshot) continue;
    put({ id: snapshot.userId, displayName: snapshot.displayName || snapshot.userId });
    for (const person of snapshot.mutuals) {
      if (person.id === own.id) continue;
      put(person);
      link(snapshot.userId, person.id, 'mutual', snapshot.observedAt);
      link(own.id, person.id, 'mutual', snapshot.observedAt);
    }
  }
  for (const user of friends) {
    const person = normalizeGraphPerson(user);
    if (!person || person.id === own.id) continue;
    put(person); friendIds.add(person.id); link(own.id, person.id, 'friends');
  }
  put(own);
  const ordered = [...people.keys()].sort(compare);
  const neighbors = new Map(ordered.filter((id) => id !== own.id).map((id) => [id, new Set<string>()]));
  for (const edge of edges.values()) {
    // Excluding the own-account star reveals only actually observed components among other people.
    if (edge.source !== own.id && edge.target !== own.id) {
      neighbors.get(edge.source)?.add(edge.target);
      neighbors.get(edge.target)?.add(edge.source);
    }
  }
  const components = new Map<string, number>();
  let component = 0;
  for (const id of ordered) {
    if (id === own.id || components.has(id)) continue;
    const pending = [id]; components.set(id, component);
    while (pending.length) {
      const current = pending.pop()!;
      for (const next of neighbors.get(current) || []) if (!components.has(next)) {
        components.set(next, component); pending.push(next);
      }
    }
    component++;
  }
  return {
    nodes: ordered.map((id) => ({
      ...people.get(id)!, self: id === own.id, friend: friendIds.has(id), component: components.get(id) ?? -1,
      // /auth/user.state is always offline: only its disclosed game location proves self presence.
      presence: id === own.id ? presenceMode(self) === 'game' ? 'game' : 'unknown'
        : liveFriends.has(id) ? presenceMode(liveFriends.get(id)!) : 'unknown',
    })),
    edges: [...edges.values()].sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target)),
  };
}

/** Direct known neighbors only: selecting a person must not invent links among their friends. */
export function knownConnections(graph: KnownGraph, userId: string): GraphNode[] {
  const neighbors = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === userId) neighbors.add(edge.target);
    if (edge.target === userId) neighbors.add(edge.source);
  }
  return graph.nodes.filter((node) => neighbors.has(node.id));
}

export function isObservationFresh(value: GraphObservation, now = Date.now()): boolean {
  const elapsed = now - Date.parse(value.observedAt);
  return value.complete && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < CACHE_TTL;
}

const cacheKey = (account: string) => {
  if (!validId(account)) throw new Error('Не удалось определить аккаунт кеша связей.');
  return `vrcnext-mobile.network.v1.${account}`;
};

export function boundNetworkObservations(values: GraphObservation[]): GraphObservation[] {
  const unique = new Map<string, GraphObservation>();
  for (const value of values) {
    const item = observation(value);
    if (!item) continue;
    const previous = unique.get(item.userId);
    if (!previous || compare(item.observedAt, previous.observedAt) >= 0) unique.set(item.userId, item);
  }
  const ordered = [...unique.values()].sort((a, b) => compare(b.observedAt, a.observedAt) || compare(a.userId, b.userId));
  const result: GraphObservation[] = [];
  let records = 0;
  for (const item of ordered) {
    if (result.length >= MAX_OBSERVATIONS || records + item.mutuals.length > MAX_CACHE_RECORDS) continue;
    result.push(item); records += item.mutuals.length;
  }
  return result;
}

export function readNetworkCache(account: string, storage?: Pick<Storage, 'getItem'>): GraphObservation[] {
  try {
    const text = (storage || localStorage).getItem(cacheKey(account));
    if (!text) return [];
    if (text.length > MAX_CACHE_CHARACTERS) throw new Error();
    const payload = record(JSON.parse(text));
    if (payload?.version !== 1 || payload.account !== account || !Array.isArray(payload.observations)) throw new Error();
    if (payload.observations.some((item) => !observation(item))) throw new Error();
    return boundNetworkObservations(payload.observations as GraphObservation[]);
  } catch {
    throw new Error('Не удалось прочитать кеш связей этого аккаунта. Можно выполнить новую проверку.');
  }
}

export function writeNetworkCache(account: string, values: GraphObservation[], storage?: Pick<Storage, 'setItem'>): void {
  try {
    const observations = boundNetworkObservations(values);
    let text = JSON.stringify({ version: 1, account, observations });
    while (text.length > MAX_CACHE_CHARACTERS && observations.length > 1) {
      observations.pop(); text = JSON.stringify({ version: 1, account, observations });
    }
    if (text.length > MAX_CACHE_CHARACTERS) throw new Error();
    (storage || localStorage).setItem(cacheKey(account), text);
  } catch {
    throw new Error('Не удалось сохранить кеш связей. Проверьте свободное место; текущий граф остаётся открыт.');
  }
}

function abort() { const error = new Error('Проверка связей отменена.'); error.name = 'AbortError'; return error; }
function failure(error: unknown): { error: string; status?: number } {
  const raw = record(error), status = typeof raw?.status === 'number' && Number.isInteger(raw.status)
    && raw.status >= 100 && raw.status <= 599 ? raw.status : undefined;
  if (status === 403) return { status, error: 'Пользователь закрыл список общих друзей или доступ запрещён.' };
  if (status === 401) return { status, error: 'Сессия VRChat недействительна. Войдите снова для проверки связей.' };
  if (status === 429) {
    const delay = typeof raw?.retryAfter === 'number' ? Math.max(1, Math.ceil(raw.retryAfter)) : undefined;
    return { status, error: `VRChat ограничил запросы.${delay ? ` Повторите через ${delay} сек.` : ' Повторите позже.'}` };
  }
  if (status && status >= 400) return { status, error: `Не удалось получить общих друзей: VRChat ${status}.` };
  return { error: 'Не удалось получить общих друзей. Проверьте подключение и повторите проверку.' };
}

/** An explicit, bounded, sequential read. A failed page is never represented as a complete empty result. */
export async function scanMutualFriends(
  userId: string,
  loadPage: (userId: string, offset: number) => Promise<User[]>,
  options: MutualScanOptions = {},
): Promise<GraphObservation> {
  if (!validId(userId)) throw new Error('Нет корректного идентификатора друга.');
  const people = new Map<string, GraphPerson>();
  const now = options.now || (() => new Date().toISOString());
  const result = (complete: boolean, problem?: { error: string; status?: number }): GraphObservation => ({
    userId, observedAt: now(), mutuals: [...people.values()], complete, ...problem,
  });
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (options.cancelled?.()) throw abort();
    let rows: User[];
    try { rows = await loadPage(userId, offset); }
    catch (error) { if (options.cancelled?.()) throw abort(); return result(false, failure(error)); }
    if (options.cancelled?.()) throw abort();
    if (!Array.isArray(rows) || rows.length > PAGE_SIZE)
      return result(false, { error: 'VRChat вернул некорректную страницу общих друзей.' });
    let additions = 0;
    for (const raw of rows) {
      const person = normalizeGraphPerson(raw);
      if (!person) return result(false, { error: 'VRChat вернул пользователя без корректного ID. Снимок неполный.' });
      if (person.id === userId) continue;
      if (!people.has(person.id)) additions++;
      people.set(person.id, person);
    }
    offset += rows.length;
    options.onProgress?.(people.size);
    if (rows.length < PAGE_SIZE) return result(true);
    if (!additions) return result(false, { error: 'VRChat повторил страницу общих друзей. Снимок неполный.' });
  }
  return result(false, { error: 'Достигнут предел проверки 2500 общих друзей. Показана только полученная часть.' });
}
