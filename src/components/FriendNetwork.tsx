import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { App as AndroidApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { GitBranch, Minus, Plus, RefreshCw, RotateCcw, Search, Square, Users } from 'lucide-react';
import { api, isNative } from '../api';
import { boundNetworkObservations, buildKnownGraph, isObservationFresh, readNetworkCache, scanMutualFriends, writeNetworkCache } from '../data/friend-network';
import type { GraphNode, GraphObservation } from '../data/friend-network';
import { useApp } from '../state';
import { Empty, ErrorState, SearchField } from './ui';
import './FriendNetwork.css';

const colors = ['#b3a4ff', '#88d6bc', '#f0b28e', '#e4a8d2', '#85bdf3', '#e4ce85', '#8bd4dc', '#d5a8f1'];
type Transform = { x: number; y: number; scale: number };
type Point = { x: number; y: number };
type PositionedNode = GraphNode & Point;
const initialView: Transform = { x: 0, y: 0, scale: 1 };
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const colorOf = (component: number) => colors[Math.abs(component) % colors.length];
const shortName = (value: string) => Array.from(value).length > 18 ? Array.from(value).slice(0, 17).join('') + '…' : value;
const initials = (value: string) => Array.from(value).slice(0, 2).join('').toLocaleUpperCase();
const dateLabel = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' }) : 'Дата неизвестна';

/** Layout depends on identities and confirmed components, not changing presence/status fields. */
function positions(nodes: GraphNode[]): PositionedNode[] {
  const self = nodes.find((node) => node.self);
  if (nodes.length > 12) {
    // Spaced coordinates remain separate when zoomed; a dense ring would overlap permanently.
    const remaining = nodes.filter((node) => !node.self);
    return [
      ...(self ? [{ ...self, x: 400, y: 300 }] : []),
      ...remaining.map((node, index) => {
        const angle = index * 2.399963229728653, radius = 64 * Math.sqrt(index + 2);
        return { ...node, x: 400 + Math.cos(angle) * radius, y: 300 + Math.sin(angle) * radius };
      }),
    ];
  }
  const groups = new Map<number, GraphNode[]>();
  for (const node of nodes) if (!node.self) {
    const group = groups.get(node.component) || [];
    group.push(node); groups.set(node.component, group);
  }
  const components = [...groups.keys()].sort((a, b) => a - b);
  const result: PositionedNode[] = self ? [{ ...self, x: 400, y: 300 }] : [];
  components.forEach((component, index) => {
    const members = groups.get(component)!;
    const angle = index * Math.PI * 2 / Math.max(1, components.length) - Math.PI / 2;
    const radius = components.length > 1 ? 190 : self ? 130 : 0;
    const center = { x: 400 + Math.cos(angle) * radius, y: 300 + Math.sin(angle) * radius };
    members.forEach((node, child) => {
      const distance = members.length > 1 ? Math.min(150, 24 * Math.sqrt(child + 1)) : 0;
      const childAngle = child * 2.399963229728653;
      result.push({ ...node, x: center.x + Math.cos(childAngle) * distance, y: center.y + Math.sin(childAngle) * distance });
    });
  });
  return result;
}

/** Only explicit API checks add mutual edges. A first friend list proves only links to yourself. */
export function FriendNetwork() {
  const ctx = useApp();
  const account = ctx.demo ? 'demo' : ctx.user.id;
  const [cache, setCache] = useState<{ account: string; observations: GraphObservation[] }>({ account, observations: [] });
  const [cacheError, setCacheError] = useState('');
  const [scanError, setScanError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [limit, setLimit] = useState(200);
  const [view, setView] = useState<Transform>(initialView);
  const viewRef = useRef(view);
  const layoutRef = useRef<PositionedNode[]>([]);
  const generation = useRef(0);
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ view: Transform; points: Point[]; client: Point[]; node?: string; moved: boolean } | undefined>(undefined);
  const observations = cache.account === account ? cache.observations : [];
  const observationRef = useRef(observations);
  observationRef.current = observations;

  const changeView = (next: Transform) => {
    const value = { x: clamp(next.x, -4000, 4000), y: clamp(next.y, -3000, 3000), scale: clamp(next.scale, .15, 5) };
    viewRef.current = value; setView(value);
  };
  const resetView = () => {
    const current = layoutRef.current;
    if (current.length <= 12) { changeView(initialView); return; }
    const left = Math.min(...current.map((node) => node.x)) - 70, right = Math.max(...current.map((node) => node.x)) + 70;
    const top = Math.min(...current.map((node) => node.y)) - 70, bottom = Math.max(...current.map((node) => node.y)) + 85;
    const scale = clamp(Math.min(1, 760 / (right - left), 560 / (bottom - top)), .15, 5);
    changeView({ scale, x: 400 - (left + right) / 2 * scale, y: 300 - (top + bottom) / 2 * scale });
  };
  const cancelScan = () => { generation.current++; setBusy(false); setNotice('Проверка остановлена. Полученные ранее снимки сохранены.'); };
  useEffect(() => {
    generation.current++; setBusy(false); setSelected(''); setCacheError(''); setScanError(''); setNotice('');
    setCache({ account, observations: [] });
    resetView();
    if (!ctx.demo) {
      try { setCache({ account, observations: readNetworkCache(account) }); }
      catch (failure) { setCacheError(failure instanceof Error ? failure.message : 'Не удалось прочитать кеш связей.'); }
    }
    return () => { generation.current++; };
  }, [account, ctx.demo]);
  useEffect(() => {
    let retired = false;
    let handle: PluginListenerHandle | undefined;
    const stop = () => { if (!retired) { generation.current++; setBusy(false); } };
    const visibility = () => { if (document.visibilityState !== 'visible') stop(); };
    document.addEventListener('visibilitychange', visibility);
    if (isNative) void AndroidApp.addListener('appStateChange', ({ isActive }) => { if (!isActive) stop(); }).then((result) => {
      if (retired) void result.remove(); else handle = result;
    }).catch(() => {});
    return () => { retired = true; generation.current++; void handle?.remove(); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => { if (!ctx.online || ctx.pageActive === false) cancelScan(); }, [ctx.online, ctx.pageActive]);
  useEffect(() => { setLimit(200); resetView(); }, [query, filter]);

  const graph = useMemo(() => buildKnownGraph(ctx.user, ctx.friends.data, observations), [ctx.user, ctx.friends.data, observations]);
  const needle = query.trim().toLocaleLowerCase();
  const matches = graph.nodes.filter((node) => {
    if (needle && !`${node.displayName} ${node.id} ${node.statusDescription || ''}`.toLocaleLowerCase().includes(needle)) return false;
    return filter === 'all' || filter === 'friends' && (node.friend || node.self)
      || filter === 'online' && node.status !== undefined && node.status !== 'offline'
      || filter === 'offline' && node.status === 'offline';
  });
  const visible = [...matches.filter((node) => node.self), ...matches.filter((node) => !node.self)].slice(0, limit);
  // An unchanged identity/component key keeps every coordinate fixed during status updates.
  const layoutKey = visible.map((node) => `${node.id}:${node.component}`).join('|');
  const layout = useMemo(() => positions(visible), [layoutKey]);
  layoutRef.current = layout;
  useEffect(() => { resetView(); }, [layoutKey]);
  const liveNodes = new Map(visible.map((node) => [node.id, node]));
  const points = new Map(layout.map((node) => [node.id, node]));
  const edges = graph.edges.filter((edge) => points.has(edge.source) && points.has(edge.target));
  const selectedObservation = observations.find((observation) => observation.userId === selected);
  const scanCandidates = ctx.friends.data.filter((friend) => !needle || `${friend.displayName} ${friend.id}`.toLocaleLowerCase().includes(needle));

  async function scan() {
    if (ctx.demo || busy || !selected || !ctx.online) return;
    const friend = ctx.friends.data.find((person) => person.id === selected);
    if (!friend) { setScanError('Выберите друга из актуального списка.'); return; }
    const previous = observationRef.current.find((observation) => observation.userId === selected);
    if (!force && previous && isObservationFresh(previous)) {
      setNotice('Используется снимок за последние 15 минут. Для нового запроса включите «Запросить заново».'); return;
    }
    const current = ++generation.current;
    setBusy(true); setProgress(0); setScanError(''); setNotice('');
    try {
      const result = await scanMutualFriends(selected, api.mutualFriends, {
        cancelled: () => current !== generation.current || document.visibilityState !== 'visible',
        onProgress: (count) => { if (current === generation.current) setProgress(count); },
      });
      if (current !== generation.current) return;
      result.displayName = friend.displayName;
      if (!result.complete) {
        setScanError(result.error || 'Проверка завершилась не полностью.');
        if (previous?.complete) {
          setNotice('Сохранён предыдущий полный снимок. Ошибка новой проверки не означает отсутствия связей.'); return;
        }
      }
      const next = boundNetworkObservations([...observationRef.current.filter((observation) => observation.userId !== result.userId), result]);
      setCache({ account, observations: next });
      try { writeNetworkCache(account, next); setCacheError(''); }
      catch (failure) { setCacheError(failure instanceof Error ? failure.message : 'Связи пока не сохранены.'); }
      if (result.complete) setNotice(`Получено общих друзей: ${result.mutuals.length}. Снимок сохранён на этом устройстве.`);
    } catch (failure) {
      if (current === generation.current && !(failure instanceof Error && failure.name === 'AbortError'))
        setScanError(failure instanceof Error ? failure.message : 'Не удалось проверить связи.');
    } finally { if (current === generation.current) setBusy(false); }
  }
  function saveAgain() {
    try { writeNetworkCache(account, observations); setCacheError(''); }
    catch (failure) { setCacheError(failure instanceof Error ? failure.message : 'Не удалось сохранить кеш.'); }
  }

  function canvasPoint(point: Point): Point {
    const element = svg.current;
    const matrix = element?.getScreenCTM();
    if (matrix && typeof DOMPoint !== 'undefined') {
      const translated = new DOMPoint(point.x, point.y).matrixTransform(matrix.inverse());
      return { x: translated.x, y: translated.y };
    }
    const rect = element?.getBoundingClientRect();
    return rect ? { x: (point.x - rect.left) * 800 / rect.width, y: (point.y - rect.top) * 600 / rect.height } : point;
  }
  function beginGesture(node?: string, moved = false) {
    const clients = [...pointers.current.values()];
    gesture.current = { view: viewRef.current, points: clients.map(canvasPoint), client: clients, node, moved: moved || clients.length > 1 };
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const node = (event.target as Element).closest('[data-network-id]')?.getAttribute('data-network-id') || undefined;
    beginGesture(node, gesture.current?.moved || false);
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* The pointer may already have been released by Android. */ }
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = gesture.current;
    const clients = [...pointers.current.values()];
    const now = clients.map(canvasPoint);
    if (clients.length >= 2 && start.points.length >= 2) {
      const previousDistance = Math.hypot(start.points[1].x - start.points[0].x, start.points[1].y - start.points[0].y);
      const distance = Math.hypot(now[1].x - now[0].x, now[1].y - now[0].y);
      if (previousDistance < 1) return;
      const before = { x: (start.points[0].x + start.points[1].x) / 2, y: (start.points[0].y + start.points[1].y) / 2 };
      const after = { x: (now[0].x + now[1].x) / 2, y: (now[0].y + now[1].y) / 2 };
      const scale = clamp(start.view.scale * distance / previousDistance, .15, 5);
      changeView({ scale, x: after.x - (before.x - start.view.x) * scale / start.view.scale, y: after.y - (before.y - start.view.y) * scale / start.view.scale });
      start.moved = true;
    } else if (now.length === 1 && start.points.length === 1) {
      if (Math.hypot(clients[0].x - start.client[0].x, clients[0].y - start.client[0].y) > 6) start.moved = true;
      if (start.moved) changeView({ ...start.view, x: start.view.x + now[0].x - start.points[0].x, y: start.view.y + now[0].y - start.points[0].y });
    }
  }
  function pointerEnd(event: PointerEvent<SVGSVGElement>, cancelled = false) {
    if (!pointers.current.has(event.pointerId)) return;
    const before = gesture.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size) beginGesture(undefined, true);
    else {
      gesture.current = undefined;
      if (!cancelled && before?.node && !before.moved) ctx.openUser(before.node);
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function zoom(factor: number) {
    const current = viewRef.current, scale = clamp(current.scale * factor, .15, 5);
    changeView({ scale, x: 400 - (400 - current.x) * scale / current.scale, y: 300 - (300 - current.y) * scale / current.scale });
  }
  function keyboard(event: KeyboardEvent<SVGSVGElement>) {
    const current = viewRef.current;
    const movement: Record<string, Point> = { ArrowLeft: { x: 30, y: 0 }, ArrowRight: { x: -30, y: 0 }, ArrowUp: { x: 0, y: 30 }, ArrowDown: { x: 0, y: -30 } };
    if (movement[event.key]) { event.preventDefault(); changeView({ ...current, x: current.x + movement[event.key].x, y: current.y + movement[event.key].y }); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.25); }
    else if (event.key === '-') { event.preventDefault(); zoom(.8); }
    else if (event.key === '0') { event.preventDefault(); resetView(); }
  }

  return <section className="friend-network">
    <div className="network-heading"><div><h2>Mutual Friend Network</h2><p className="muted">Связи, которые действительно вернул VRChat</p></div><GitBranch size={25} /></div>
    <p className="network-explanation">Линии к вам известны из списка друзей. Связи между остальными появляются только после проверки общих друзей. Пропущенная линия означает отсутствие данных. Цвета объединяют компоненты известных связей без вашего узла.</p>
    <div className="network-filters">
      <SearchField value={query} onChange={setQuery} placeholder="Найти пользователя в графе" />
      <label className="field">Фильтр<select aria-label="Фильтр пользователей графа" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Все пользователи</option><option value="friends">Мои друзья</option><option value="online">Известный статус: в сети</option><option value="offline">Известный статус: не в сети</option></select></label>
    </div>
    {ctx.friends.error && <ErrorState error={ctx.friends.error} retry={ctx.friends.reload} />}
    {cacheError && <ErrorState error={cacheError} retry={saveAgain} />}
    <div className="network-counts"><span><Users size={14} />{graph.nodes.length} известных пользователей</span><span><GitBranch size={14} />{graph.edges.length} известных связей</span><span>Показано: {visible.length}{matches.length > limit ? ` из ${matches.length}` : ''}</span></div>
    {!visible.length ? <Empty icon={<Search size={30} />} title="Пользователи не найдены" text="Измените поиск или фильтр. Новые связи можно загрузить для выбранного друга." /> : <div className="network-frame card">
      <div className="network-zoom"><button className="icon-button" aria-label="Увеличить граф" onClick={() => zoom(1.25)}><Plus size={18} /></button><span aria-live="polite">{Math.round(view.scale * 100)}%</span><button className="icon-button" aria-label="Уменьшить граф" onClick={() => zoom(.8)}><Minus size={18} /></button><button className="icon-button" aria-label="Сбросить граф" onClick={resetView}><RotateCcw size={16} /></button></div>
      <svg ref={svg} role="img" aria-label="Граф общих друзей" viewBox="0 0 800 600" tabIndex={0} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={(event) => pointerEnd(event)} onPointerCancel={(event) => pointerEnd(event, true)} onLostPointerCapture={(event) => pointerEnd(event, true)} onKeyDown={keyboard}>
        <g className="network-scene" transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          <g className="network-edges">{edges.map((edge) => { const from = points.get(edge.source)!, to = points.get(edge.target)!; return <line key={[edge.source, edge.target].sort().join(':')} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={edge.sourceType === 'friends' ? 'self-edge' : 'mutual-edge'} stroke={edge.sourceType === 'friends' ? '#70809b' : colorOf(from.component)}><title>{liveNodes.get(edge.source)?.displayName} — {liveNodes.get(edge.target)?.displayName}{edge.observedAt ? ` · Проверено ${dateLabel(edge.observedAt)}` : ' · Список друзей'}</title></line>; })}</g>
          {layout.map((position) => { const node = liveNodes.get(position.id)!; return <g key={node.id} role="button" tabIndex={0} aria-label={`Открыть профиль ${node.displayName}`} data-network-id={node.id} className={`network-node ${node.self ? 'self' : ''}`} transform={`translate(${position.x} ${position.y})`} onClick={(event) => { if (event.detail === 0) ctx.openUser(node.id); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); ctx.openUser(node.id); } }}>
            <title>{node.displayName}{node.self ? ' · Вы' : ''}{node.statusDescription ? ` · ${node.statusDescription}` : ''}</title><circle className="network-hit" r={Math.max(node.self ? 32 : 28, 52 / Math.max(1, view.scale))} /><circle className="network-node-disc" r={node.self ? 29 : 24} fill={node.self ? '#282941' : colorOf(node.component)} stroke={node.self ? '#b3a4ff' : '#10131c'} /><text className="network-initials" textAnchor="middle" y="5" fill={node.self ? '#eeeef5' : '#18202b'}>{initials(node.displayName)}</text><text className="network-label" textAnchor="middle" y={node.self ? 48 : 43}>{shortName(node.displayName)}{node.self ? ' · Вы' : ''}</text>
          </g>; })}
        </g>
      </svg>
    </div>}
    <p className="network-gesture-help muted small">Перемещайте граф пальцем, масштабируйте двумя пальцами. Нажатие открывает профиль. Клавиатура: стрелки, +/− и 0.</p>
    {matches.length > limit && <button className="button secondary load-more" disabled={limit >= 600} onClick={() => setLimit((count) => Math.min(600, count + 100))}>{limit >= 600 ? 'Для остальных пользователей используйте поиск' : `Показать ещё (${matches.length - limit})`}</button>}
    <div className="network-scan card">
      <h3>Проверить общих друзей</h3>
      <p className="muted small">Один выбранный друг за запрос. Снимки сохраняются локально, кеш действует 15 минут. Статус в сохранённом снимке относится к моменту его получения.</p>
      <label className="field">Друг<select aria-label="Друг для проверки связей" value={selected} disabled={busy} onChange={(event) => { setSelected(event.target.value); setScanError(''); setNotice(''); }}><option value="">Выберите друга</option>{selected && !scanCandidates.some((friend) => friend.id === selected) && <option value={selected}>{ctx.friends.data.find((friend) => friend.id === selected)?.displayName || selected}</option>}{scanCandidates.slice(0, 1000).map((friend) => <option key={friend.id} value={friend.id}>{friend.displayName}</option>)}</select></label>
      {scanCandidates.length > 1000 && <p className="muted small">Для остальных друзей введите имя в поиск графа.</p>}
      <label className="network-force"><input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} disabled={busy} />Запросить заново</label>
      <div className="network-scan-actions"><button className="button secondary" disabled={busy || !selected || ctx.demo || !ctx.online} onClick={() => void scan()}><RefreshCw className={busy ? 'spin' : ''} size={16} />{busy ? `Получено: ${progress}` : 'Проверить связи'}</button>{busy && <button className="button secondary" onClick={cancelScan}><Square size={14} />Остановить</button>}</div>
      {ctx.demo && <p className="muted small">Деморежим показывает только пример списка друзей. Взаимные связи не придуманы и не запрашиваются.</p>}
      {selectedObservation && <p className="network-observation muted small">Последний снимок: {dateLabel(selectedObservation.observedAt)} · {selectedObservation.mutuals.length} общих друзей{selectedObservation.complete ? '' : ' · Неполные данные'}{isObservationFresh(selectedObservation) ? '' : ' · Требуется обновление'}</p>}
      {scanError && <ErrorState error={scanError} />}{notice && <p className="network-notice" role="status">{notice}</p>}
      {observations.length > 0 && <details className="network-snapshots"><summary>Сохранённые проверки ({observations.length})</summary>{observations.map((observation) => <p className="muted small" key={observation.userId}><button className="text-button" onClick={() => ctx.openUser(observation.userId)}>{observation.displayName || ctx.friends.data.find((friend) => friend.id === observation.userId)?.displayName || observation.userId}</button> · {dateLabel(observation.observedAt)} · {observation.mutuals.length}{observation.complete ? '' : ' · неполный снимок'}</p>)}</details>}
    </div>
  </section>;
}
