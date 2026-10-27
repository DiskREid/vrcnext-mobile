import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { App as AndroidApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { ArrowUpRight, GitBranch, LocateFixed, Maximize2, Minus, Plus, RefreshCw, RotateCcw, Search, Square, Users, X } from 'lucide-react';
import { api, isNative } from '../api';
import type { User } from '../api';
import { boundNetworkObservations, buildKnownGraph, isObservationFresh, knownConnections, readNetworkCache, scanMutualFriends, writeNetworkCache } from '../data/friend-network';
import type { GraphNode, GraphObservation } from '../data/friend-network';
import { useApp } from '../state';
import { AvatarImage, Empty, ErrorState, imageOf, Modal, SearchField, Segmented } from './ui';
import './FriendNetwork.css';

const colors = ['#b3a4ff', '#88d6bc', '#f0b28e', '#e4a8d2', '#85bdf3', '#e4ce85', '#8bd4dc', '#d5a8f1'];
type Transform = { x: number; y: number; scale: number };
type Point = { x: number; y: number };
type PositionedNode = GraphNode & Point;
const initialView: Transform = { x: 0, y: 0, scale: 1 };
const holdDelay = 500;
const dragThreshold = 8;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const colorOf = (component: number) => colors[Math.abs(component) % colors.length];
const shortName = (value: string) => Array.from(value).length > 18 ? Array.from(value).slice(0, 17).join('') + '…' : value;
const dateLabel = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' }) : 'Дата неизвестна';
const presenceText = (node: GraphNode) => node.self ? 'Вы' : ({ game: 'В VRChat', website: 'На сайте / в приложении', offline: 'Не в сети', unknown: 'Присутствие неизвестно' })[node.presence];

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
  // Small neighborhoods need individually spaced names, not a tight component spiral.
  const ordered = [...nodes.filter((node) => node.self), ...nodes.filter((node) => !node.self)];
  const columns = ordered.length <= 4 ? 2 : 3;
  const rows = Math.ceil(ordered.length / columns);
  return ordered.map((node, index) => {
    const row = Math.floor(index / columns);
    const rowSize = Math.min(columns, ordered.length - row * columns);
    return { ...node, x: 400 + (index % columns - (rowSize - 1) / 2) * 240, y: 300 + (row - (rows - 1) / 2) * 170 };
  });
}

type AvatarSource = { src?: string; fallback?: string };
type EdgePath = { key: string; d: string; count: number; color: string; className: string };

/** Static SVG content never re-renders for a pointer frame; only its parent transform moves. */
const NetworkScene = memo(function NetworkScene({ sceneRef, layout, nodes, images, paths, selected, neighborhood, actualScale, busy, openProfile }: {
  sceneRef: RefObject<SVGGElement | null>;
  layout: PositionedNode[];
  nodes: Map<string, GraphNode>;
  images: Map<string, AvatarSource>;
  paths: EdgePath[];
  selected: string;
  neighborhood: Set<string>;
  actualScale: number;
  busy: boolean;
  openProfile: (id: string) => void;
}) {
  return <g ref={sceneRef} className="network-scene">
    <g className="network-edges" aria-label="Подтверждённые связи">{paths.map((path) => <path key={path.key} d={path.d} data-edge-count={path.count} fill="none" className={path.className} stroke={path.color} />)}</g>
    {layout.map((position) => {
      const node = nodes.get(position.id)!;
      const avatar = images.get(node.id);
      const radius = Math.max(node.self ? 29 : 24, layout.length <= 12 ? 20 / actualScale : 0);
      return <g key={node.id} role="button" tabIndex={0} aria-label={`Открыть профиль ${node.displayName}`} aria-disabled={busy} data-network-id={node.id} className={`network-node ${node.self ? 'self' : ''} ${selected === node.id ? 'selected' : selected ? neighborhood.has(node.id) ? 'neighbor' : 'dimmed' : ''}`} transform={`translate(${position.x} ${position.y})`} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (!busy) openProfile(node.id); } }}>
        <title>{node.displayName}{node.self ? ' · Вы' : ''}</title>
        <circle className="network-hit" r={Math.max(node.self ? 32 : 28, radius, 52 / Math.max(1, actualScale))} />
        <circle className="network-node-disc" r={radius + 2} fill={node.self ? '#282941' : colorOf(node.component)} stroke={node.self ? '#b3a4ff' : '#10131c'} />
        <foreignObject className="network-avatar" x={-radius} y={-radius} width={radius * 2} height={radius * 2} pointerEvents="none"><AvatarImage name={node.displayName} src={avatar?.src} fallbackSrc={avatar?.fallback} size={radius * 2} /></foreignObject>
        <text className="network-label" style={{ fontSize: layout.length <= 12 ? 12 / actualScale : 12, strokeWidth: layout.length <= 12 ? 3 / actualScale : 3 }} textAnchor="middle" y={radius + (layout.length <= 12 ? 18 / actualScale : 18)}>{shortName(node.displayName)}{node.self ? ' · Вы' : ''}</text>
      </g>;
    })}
  </g>;
});

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
  const [highlighted, setHighlighted] = useState('');
  const [mode, setMode] = useState(() => window.matchMedia('(max-width: 600px)').matches ? 'list' : 'graph');
  const [fullscreen, setFullscreen] = useState(false);
  const [focusOnly, setFocusOnly] = useState(false);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [limit, setLimit] = useState(200);
  const [view, setView] = useState<Transform>(initialView);
  const [canvasScale, setCanvasScale] = useState(1);
  const [scanImages, setScanImages] = useState<{ account: string; images: Map<string, AvatarSource> }>(() => ({ account, images: new Map() }));
  const viewRef = useRef(view);
  const layoutRef = useRef<PositionedNode[]>([]);
  const generation = useRef(0);
  const svg = useRef<SVGSVGElement>(null);
  const scene = useRef<SVGGElement>(null);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const animation = useRef<number | undefined>(undefined);
  const commitPending = useRef(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ view: Transform; points: Point[]; client: Point[]; node?: string; moved: boolean; held: boolean } | undefined>(undefined);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingClick = useRef<{ node?: string; expiresAt: number } | undefined>(undefined);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const observations = cache.account === account ? cache.observations : [];
  const observationRef = useRef(observations);
  observationRef.current = observations;

  function cancelHold() { clearTimeout(holdTimer.current); holdTimer.current = undefined; }
  function cancelGesture() { cancelHold(); pointers.current.clear(); gesture.current = undefined; pendingClick.current = undefined; }
  useEffect(() => {
    const cancel = () => { cancelGesture(); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => { cancelGesture(); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', cancel); };
  }, []);
  useEffect(() => { cancelGesture(); }, [account, mode, fullscreen, busy, ctx.pageActive]);

  const changeView = useCallback((next: Transform, commit = true) => {
    viewRef.current = { x: clamp(next.x, -4000, 4000), y: clamp(next.y, -3000, 3000), scale: clamp(next.scale, .15, 5) };
    commitPending.current ||= commit;
    if (animation.current !== undefined) return;
    animation.current = requestAnimationFrame(() => {
      animation.current = undefined;
      const value = viewRef.current;
      scene.current?.setAttribute('transform', `translate(${value.x} ${value.y}) scale(${value.scale})`);
      if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(value.scale * 100)}%`;
      if (commitPending.current) { commitPending.current = false; setView(value); }
    });
  }, []);
  useEffect(() => () => { if (animation.current !== undefined) cancelAnimationFrame(animation.current); }, []);
  const resetView = () => {
    const current = layoutRef.current;
    if (!current.length) { changeView(initialView); return; }
    const bounds = svg.current?.getBoundingClientRect();
    const width = bounds?.width || 800, height = bounds?.height || 600;
    const ratio = Math.min(width / 800, height / 600);
    setCanvasScale(ratio);
    const left = Math.min(...current.map((node) => node.x)), right = Math.max(...current.map((node) => node.x));
    const top = Math.min(...current.map((node) => node.y)), bottom = Math.max(...current.map((node) => node.y));
    // Reserve real pixels for names and zoom controls even in the narrow portrait canvas.
    const physicalScale = Math.min(1.5, (width - 130) / Math.max(1, right - left), (height - 155) / Math.max(1, bottom - top));
    const scale = clamp(physicalScale / ratio, .15, 5);
    const centerX = 400, centerY = (height / 2 + 15 - (height - 600 * ratio) / 2) / ratio;
    changeView({ scale, x: centerX - (left + right) / 2 * scale, y: centerY - (top + bottom) / 2 * scale });
  };
  const cancelScan = () => { generation.current++; setBusy(false); setNotice('Проверка остановлена. Полученные ранее снимки сохранены.'); };
  useEffect(() => {
    generation.current++; setBusy(false); setSelected(''); setHighlighted(''); setFullscreen(false); setFocusOnly(false); setCacheError(''); setScanError(''); setNotice('');
    setCache({ account, observations: [] }); setScanImages({ account, images: new Map() });
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
  useEffect(() => { setLimit(200); }, [query, filter]);

  const graph = useMemo(() => buildKnownGraph(ctx.user, ctx.friends.data, observations), [ctx.user, ctx.friends.data, observations]);
  const selectedNode = graph.nodes.find((node) => node.id === selected);
  const connections = useMemo(() => knownConnections(graph, selected), [graph, selected]);
  const neighborhood = useMemo(() => new Set([selected, ...connections.map((node) => node.id)]), [selected, connections]);
  // Holding emphasizes a node without moving the selected-person card or changing a focused map.
  const emphasized = highlighted || selected;
  const emphasizedNode = graph.nodes.find((node) => node.id === emphasized);
  const emphasizedConnections = useMemo(() => knownConnections(graph, emphasized), [graph, emphasized]);
  const emphasizedNeighborhood = useMemo(() => new Set([emphasized, ...emphasizedConnections.map((node) => node.id)]), [emphasized, emphasizedConnections]);
  const liveProfiles = useMemo(() => new Map(ctx.friends.data.map((friend) => [friend.id, friend])), [ctx.friends.data]);
  const images = useMemo(() => {
    const result = new Map(scanImages.account === account ? scanImages.images : []);
    for (const user of [ctx.user, ...ctx.friends.data]) result.set(user.id, { src: imageOf(user), fallback: user.currentAvatarThumbnailImageUrl || user.currentAvatarImageUrl });
    return result;
  }, [scanImages, account, ctx.user, ctx.friends.data]);
  const selectedProfile = liveProfiles.get(selected);
  const degrees = useMemo(() => {
    const result = new Map<string, number>();
    for (const edge of graph.edges) {
      result.set(edge.source, (result.get(edge.source) || 0) + 1);
      result.set(edge.target, (result.get(edge.target) || 0) + 1);
    }
    return result;
  }, [graph]);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => graph.nodes.filter((node) => {
    return filter === 'all' || filter === 'friends' && (node.friend || node.self)
      || filter === 'online' && (node.presence === 'game' || node.presence === 'website')
      || filter === 'game' && node.presence === 'game' || filter === 'web' && node.presence === 'website'
      || filter === 'offline' && node.presence === 'offline' || filter === 'unknown' && node.presence === 'unknown';
  }), [graph, filter]);
  const matches = useMemo(() => filtered.filter((node) => !needle || `${node.displayName} ${node.id} ${node.statusDescription || ''}`.toLocaleLowerCase().includes(needle)), [filtered, needle]);
  // Search gives readable results without removing surrounding graph context.
  const candidates = useMemo(() => mode === 'list' ? matches : focusOnly && selectedNode ? graph.nodes.filter((node) => neighborhood.has(node.id)) : filtered, [mode, matches, focusOnly, selectedNode, graph, neighborhood, filtered]);
  const visible = useMemo(() => {
    const ordered = [...candidates.filter((node) => node.self), ...candidates.filter((node) => !node.self)];
    const firstPage = ordered.slice(0, limit);
    return selectedNode && candidates.some((node) => node.id === selected) && !firstPage.some((node) => node.id === selected)
      ? [...firstPage.slice(0, -1), selectedNode] : firstPage;
  }, [candidates, limit, selectedNode, selected]);
  // An unchanged identity/component key keeps every coordinate fixed during status updates.
  const layoutKey = visible.map((node) => `${node.id}:${node.component}`).join('|');
  const layout = useMemo(() => positions(visible), [layoutKey]);
  layoutRef.current = layout;
  useEffect(() => { resetView(); }, [layoutKey, mode]);
  useEffect(() => {
    if (mode !== 'graph' || !svg.current) return;
    const observer = new ResizeObserver(() => resetView());
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, [mode, fullscreen]);
  const actualScale = Math.max(.05, view.scale * canvasScale);
  const liveNodes = useMemo(() => new Map(visible.map((node) => [node.id, node])), [visible]);
  const edgePaths = useMemo(() => {
    const points = new Map(layout.map((node) => [node.id, node]));
    const paths = new Map<string, EdgePath>();
    for (const edge of graph.edges) {
      const from = points.get(edge.source), to = points.get(edge.target);
      if (!from || !to) continue;
      const direct = emphasized === edge.source || emphasized === edge.target;
      const className = `${edge.sourceType === 'friends' ? 'self-edge' : 'mutual-edge'} ${emphasizedNode ? direct ? 'selected-edge' : 'dimmed' : ''}`;
      const color = edge.sourceType === 'friends' ? '#70809b' : colorOf(from.component);
      const key = `${className}:${color}`;
      const path = paths.get(key) || { key, d: '', count: 0, color, className };
      path.d += `M${from.x},${from.y}L${to.x},${to.y}`;
      path.count++;
      paths.set(key, path);
    }
    return [...paths.values()];
  }, [layout, graph.edges, emphasized, emphasizedNode]);
  const openGraphProfile = useCallback((id: string) => ctx.openUser(id), [ctx.openUser]);
  const selectedObservation = observations.find((observation) => observation.userId === selected);
  const scanCandidates = ctx.friends.data.filter((friend) => !needle || `${friend.displayName} ${friend.id}`.toLocaleLowerCase().includes(needle));

  function selectPerson(id: string) {
    if (busy) return;
    setSelected(id); setHighlighted(''); setFocusOnly(false); setScanError(''); setNotice('');
  }
  function focusConnections() {
    if (!selectedNode) return;
    setHighlighted(''); setQuery(''); setFilter('all'); setFocusOnly(true); setMode('graph'); setLimit(200);
  }

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
        onUsers: (users) => { if (current === generation.current) setScanImages((old) => { const next = new Map(old.account === account ? old.images : []); for (const user of users) next.set(user.id, { src: imageOf(user), fallback: user.currentAvatarThumbnailImageUrl || user.currentAvatarImageUrl }); while (next.size > 1000) next.delete(next.keys().next().value!); return { account, images: next }; }); },
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
    gesture.current = { view: viewRef.current, points: clients.map(canvasPoint), client: clients, node, moved: moved || clients.length > 1, held: false };
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    cancelHold();
    pendingClick.current = undefined;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const node = (event.target as Element).closest('[data-network-id]')?.getAttribute('data-network-id') || undefined;
    beginGesture(node, gesture.current?.moved || false);
    const started = gesture.current!;
    if (node && pointers.current.size === 1 && !started.moved && !busy) {
      holdTimer.current = setTimeout(() => {
        holdTimer.current = undefined;
        if (gesture.current !== started || started.moved || pointers.current.size !== 1 || busyRef.current || document.visibilityState !== 'visible') return;
        started.held = true;
        // Selection changes emphasis only: do not re-layout or request more API data.
        setHighlighted(node);
      }, holdDelay);
    }
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* The pointer may already have been released by Android. */ }
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = gesture.current;
    const clients = [...pointers.current.values()];
    const now = clients.map(canvasPoint);
    if (clients.length >= 2 && start.points.length >= 2) {
      cancelHold();
      const previousDistance = Math.hypot(start.points[1].x - start.points[0].x, start.points[1].y - start.points[0].y);
      const distance = Math.hypot(now[1].x - now[0].x, now[1].y - now[0].y);
      if (previousDistance < 1) return;
      const before = { x: (start.points[0].x + start.points[1].x) / 2, y: (start.points[0].y + start.points[1].y) / 2 };
      const after = { x: (now[0].x + now[1].x) / 2, y: (now[0].y + now[1].y) / 2 };
      const scale = clamp(start.view.scale * distance / previousDistance, .15, 5);
      changeView({ scale, x: after.x - (before.x - start.view.x) * scale / start.view.scale, y: after.y - (before.y - start.view.y) * scale / start.view.scale }, false);
      start.moved = true;
    } else if (now.length === 1 && start.points.length === 1) {
      if (Math.hypot(clients[0].x - start.client[0].x, clients[0].y - start.client[0].y) > dragThreshold) { start.moved = true; cancelHold(); }
      if (start.moved) changeView({ ...start.view, x: start.view.x + now[0].x - start.points[0].x, y: start.view.y + now[0].y - start.points[0].y }, false);
    }
  }
  function pointerEnd(event: PointerEvent<SVGSVGElement>, cancelled = false) {
    if (!pointers.current.has(event.pointerId)) return;
    cancelHold();
    const before = gesture.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size) beginGesture(undefined, true);
    else {
      gesture.current = undefined;
      changeView(viewRef.current);
      // Wait for the browser click: opening on pointerup lets that same click hit
      // a new profile's backdrop, close button, or invitation controls instead.
      pendingClick.current = {
        node: !cancelled && before?.node && !before.moved && !before.held && !busy ? before.node : undefined,
        expiresAt: performance.now() + 1000,
      };
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function canvasClick(event: MouseEvent<SVGSVGElement>) {
    event.preventDefault(); event.stopPropagation();
    const pending = pendingClick.current;
    pendingClick.current = undefined;
    if (busy) return;
    if (pending && performance.now() <= pending.expiresAt) {
      if (pending.node) ctx.openUser(pending.node);
      return; // Holds, drags, pinch and cancelled pointers also consume their click.
    }
    // Assistive technology can activate a node without sending pointer events.
    if (event.detail === 0) {
      const node = (event.target as Element).closest('[data-network-id]')?.getAttribute('data-network-id');
      if (node) ctx.openUser(node);
    }
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

  const graphCanvas = <div className="network-frame card">
    <div className="network-zoom"><button className="icon-button" aria-label="Увеличить граф" onClick={() => zoom(1.25)}><Plus size={18} /></button><span ref={zoomLabel} aria-live="polite">{Math.round(view.scale * 100)}%</span><button className="icon-button" aria-label="Уменьшить граф" onClick={() => zoom(.8)}><Minus size={18} /></button><button className="icon-button" aria-label="Сбросить граф" onClick={resetView}><RotateCcw size={16} /></button>{!fullscreen && <button className="icon-button" aria-label="На весь экран" onClick={() => setFullscreen(true)}><Maximize2 size={18} /></button>}</div>
    <svg ref={svg} role="img" aria-label="Граф общих друзей" viewBox="0 0 800 600" tabIndex={0} onClick={canvasClick} onContextMenu={(event) => event.preventDefault()} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={(event) => pointerEnd(event)} onPointerCancel={(event) => pointerEnd(event, true)} onLostPointerCapture={(event) => pointerEnd(event, true)} onKeyDown={keyboard}>
      <NetworkScene sceneRef={scene} layout={layout} nodes={liveNodes} images={images} paths={edgePaths} selected={emphasized} neighborhood={emphasizedNeighborhood} actualScale={actualScale} busy={busy} openProfile={openGraphProfile} />
    </svg>
  </div>;

  return <section className="friend-network">
    <div className="network-heading">
      <div><h2>Mutual Friend Network</h2><p className="muted">Ваши друзья и известные связи между ними</p></div><GitBranch size={25} />
    </div>
    <p className="network-explanation">Нажатие на круг открывает полный профиль. Удержание выделяет его связи. Для проверки общих друзей выберите человека в списке.</p>
    <div className="network-toolbar">
      <Segmented value={mode} onChange={setMode} items={[{ id: 'graph', label: 'Граф' }, { id: 'list', label: 'Список' }]} />
      {focusOnly && <button className="button secondary compact" onClick={() => { setFocusOnly(false); setQuery(''); setFilter('all'); }}><X size={16} />Все связи</button>}
    </div>
    <div className="network-filters">
      <SearchField value={query} onChange={setQuery} placeholder="Найти пользователя в графе" />
      <label className="field">Присутствие<select aria-label="Фильтр пользователей графа" value={filter} onChange={(event) => { setFocusOnly(false); setFilter(event.target.value); }}>
        <option value="all">Все пользователи</option><option value="friends">Мои друзья</option>
        <option value="online">Сейчас в сети</option><option value="game">В VRChat</option><option value="web">На сайте</option>
        <option value="offline">Не в сети</option><option value="unknown">Присутствие неизвестно</option>
      </select></label>
    </div>
    {ctx.friends.error && <ErrorState error={ctx.friends.error} retry={ctx.friends.reload} />}
    {cacheError && <ErrorState error={cacheError} retry={saveAgain} />}
    <div className="network-selection card" role="region" aria-label="Выбранный пользователь">
      {selectedNode ? <>
        <div className="network-person-heading">
          <AvatarImage name={selectedNode.displayName} src={selectedProfile && imageOf(selectedProfile)} fallbackSrc={selectedProfile?.currentAvatarThumbnailImageUrl || selectedProfile?.currentAvatarImageUrl} user={selectedProfile} size={48} />
          <div><h3>{selectedNode.displayName}</h3><p>{presenceText(selectedNode)} · {connections.length} известных связей</p></div>
          <button className="icon-button" aria-label="Снять выбор пользователя" disabled={busy} onClick={() => { setSelected(''); setHighlighted(''); setFocusOnly(false); }}><X size={18} /></button>
        </div>
        <div className="network-person-actions">
          <button className="button secondary compact" onClick={() => ctx.openUser(selectedNode.id)}><ArrowUpRight size={16} />Открыть профиль</button>
          <button className="button secondary compact" onClick={focusConnections}><LocateFixed size={16} />Показать связи</button>
          {selectedNode.friend && <button className="button compact" disabled={busy || ctx.demo || !ctx.online} onClick={() => void scan()}><RefreshCw size={16} className={busy ? 'spin' : ''} />{busy ? `Получено: ${progress}` : 'Проверить общих друзей'}</button>}
        </div>
        {!selectedNode.friend && !selectedNode.self && <p className="muted small network-person-note">Из сохранённого списка общих друзей. Актуальное присутствие неизвестно.</p>}
        {selectedObservation && <p className="muted small network-person-note">Общие друзья: {selectedObservation.mutuals.length} · Проверено {dateLabel(selectedObservation.observedAt)}{selectedObservation.complete ? '' : ' · Неполный снимок'}</p>}
      </> : <div className="network-select-prompt"><Users size={24} /><div><strong>Выберите человека</strong><p>Выберите имя в списке для проверки связей. Нажатие на круг графа сразу открывает профиль.</p></div></div>}
    </div>
    {scanError && <ErrorState error={scanError} />}{notice && <p className="network-notice" role="status">{notice}</p>}
    <div className="network-counts"><span><Users size={14} />{graph.nodes.length} пользователей</span><span><GitBranch size={14} />{graph.edges.length} известных связей</span><span>Показано: {visible.length}{candidates.length > limit ? ` из ${candidates.length}` : ''}</span></div>
    {mode === 'graph' && needle && <div className="network-search-results" role="region" aria-label="Результаты поиска в графе">
      <p className="muted small">Найдено: {matches.length}. Выберите имя — окружающие связи останутся на графе.</p>
      <div>{matches.slice(0, 8).map((node) => <button className="button secondary compact" key={node.id} disabled={busy} aria-label={`Выбрать ${node.displayName}`} onClick={() => selectPerson(node.id)}>{node.displayName}</button>)}</div>
      {matches.length > 8 && <button className="text-button" onClick={() => setMode('list')}>Все результаты списком</button>}
    </div>}
    {!visible.length ? <Empty icon={<Search size={30} />} title="Пользователи не найдены" text="Измените поиск или фильтр." /> : mode === 'list' ? <div className="network-people" role="list" aria-label="Пользователи сети друзей">
      {visible.map((node) => {
        const profile = liveProfiles.get(node.id);
        const count = degrees.get(node.id) || 0;
        return <div role="listitem" key={node.id}><button className={`network-person-row ${selected === node.id ? 'selected' : ''}`} aria-label={`Выбрать ${node.displayName}`} aria-pressed={selected === node.id} disabled={busy} onClick={() => selectPerson(node.id)}>
          <AvatarImage name={node.displayName} src={profile && imageOf(profile)} fallbackSrc={profile?.currentAvatarThumbnailImageUrl || profile?.currentAvatarImageUrl} user={profile} size={44} />
          <span><strong>{node.displayName}{node.self ? ' · Вы' : ''}</strong><small>{presenceText(node)}{!node.friend && !node.self ? ' · Сохранённый список' : ''}</small></span>
          <span className="network-person-count" title="Известные связи"><GitBranch size={14} />{count}</span>
        </button></div>;
      })}
    </div> : fullscreen ? createPortal(<div className="network-fullscreen-host"><Modal title="Граф общих друзей на весь экран" className="fullscreen-network" closeLabel="Выйти из полного экрана" closeOnBackdrop={false} onClose={() => setFullscreen(false)}>
      {graphCanvas}
      <div className="network-fullscreen-caption" role="status"><span>{emphasizedNode ? `${emphasizedNode.displayName} · ${emphasizedConnections.length} известных связей` : 'Удерживайте круг, чтобы выделить связи. Нажмите, чтобы открыть профиль.'}</span>{emphasizedNode && <button className="icon-button" aria-label="Снять выделение связей" disabled={busy} onClick={() => { setSelected(''); setHighlighted(''); setFocusOnly(false); }}><X size={20} /></button>}</div>
    </Modal></div>, document.body) : graphCanvas}
    {mode === 'graph' && !fullscreen && highlighted && emphasizedNode && <div className="network-fullscreen-caption" role="status"><span>{emphasizedNode.displayName} · {emphasizedConnections.length} известных связей</span><button className="icon-button" aria-label="Снять выделение связей" disabled={busy} onClick={() => { setHighlighted(''); setSelected(''); setFocusOnly(false); }}><X size={20} /></button></div>}
    {mode === 'graph' && <p className="network-gesture-help muted small">Перемещение — одним пальцем, масштаб — двумя. Нажатие открывает полный профиль, удержание выделяет прямые связи. «На весь экран» разворачивает карту. Кнопка «Показать связи» убирает лишние узлы. Клавиатура: стрелки, +/− и 0.</p>}
    {candidates.length > limit && <button className="button secondary load-more" disabled={limit >= 600} onClick={() => setLimit((count) => Math.min(600, count + 100))}>{limit >= 600 ? 'Для остальных пользователей используйте поиск' : `Показать ещё (${candidates.length - limit})`}</button>}
    <details className="network-legend"><summary>Что означают линии и цвета</summary><p className="muted small">Линии к вам известны из списка друзей. Другие линии добавляются после проверки общих друзей. Пропущенная линия означает отсутствие данных. Цвета объединяют известные связанные группы людей. Сохранённые проверки могут устареть.</p></details>
    <div className="network-scan card">
      <h3>Параметры проверки</h3>
      <p className="muted small">Выберите друга. Единственная кнопка «Проверить общих друзей» находится в его карточке сверху. Результат сохраняется на устройстве на 15 минут перед следующим запросом.</p>
      <label className="field">Друг<select aria-label="Друг для проверки связей" value={selectedNode?.friend ? selected : ''} disabled={busy} onChange={(event) => selectPerson(event.target.value)}><option value="">Выберите друга</option>{selectedNode?.friend && !scanCandidates.some((friend) => friend.id === selected) && <option value={selected}>{selectedNode.displayName}</option>}{scanCandidates.slice(0, 1000).map((friend) => <option key={friend.id} value={friend.id}>{friend.displayName}</option>)}</select></label>
      {scanCandidates.length > 1000 && <p className="muted small">Для остальных друзей введите имя в поиск графа.</p>}
      <label className="network-force"><input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} disabled={busy} />Запросить заново</label>
      <div className="network-scan-actions">{busy && <button className="button secondary" onClick={cancelScan}><Square size={14} />Остановить</button>}</div>
      {ctx.demo && <p className="muted small">Деморежим показывает только пример списка друзей. Взаимные связи не придуманы и не запрашиваются.</p>}
      {selectedObservation && <p className="network-observation muted small">Последний снимок: {dateLabel(selectedObservation.observedAt)} · {selectedObservation.mutuals.length} общих друзей{selectedObservation.complete ? '' : ' · Неполные данные'}{isObservationFresh(selectedObservation) ? '' : ' · Требуется обновление'}</p>}
      {observations.length > 0 && <details className="network-snapshots"><summary>Сохранённые проверки ({observations.length})</summary>{observations.map((observation) => <p className="muted small" key={observation.userId}><button className="text-button" onClick={() => selectPerson(observation.userId)}>{observation.displayName || ctx.friends.data.find((friend) => friend.id === observation.userId)?.displayName || observation.userId}</button> · {dateLabel(observation.observedAt)} · {observation.mutuals.length}{observation.complete ? '' : ' · неполный снимок'}</p>)}</details>}
    </div>
  </section>;
}
