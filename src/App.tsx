import SecureImage, { clearImageCache } from './components/SecureImage';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Home,
  Users,
  Compass,
  Bell,
  Grid2X2,
  ChevronRight,
  Globe2,
  ArrowUpRight,
  Heart,
  RefreshCw,
  Search,
  CalendarDays,
  Images,
  MessageSquare,
  Activity,
  SlidersHorizontal,
  UserRound,
  Settings,
  Radio,
  LogOut,
  Menu,
  WifiOff,
  X,
  Check,
  Send,
  ShieldCheck,
  ArrowLeft,
  Star,
  MapPin,
  Plus,
} from 'lucide-react';
import type { User, World, Notification, Group, CalendarEvent } from './api';
import { App as AndroidApp } from '@capacitor/app';
import { api, native, ApiError, isNative } from './api';
import type { PluginListenerHandle } from '@capacitor/core';
import { AppProvider, PageScope, useApp, useLoad } from './state';
import type { Activity as ActivityItem } from './state';
import { demoUser, demoWorlds, demoEvents } from './demo';
import { useFriends } from './data/friends';
import { useHistory } from './data/history';
import { useObservation } from './data/observation';
import { useCalendarSync } from './data/calendar-sync';
import { parseCalendarLink } from './api/calendar';
import { presenceLabel } from './data/locations';
import { reconcilePage } from './hooks/paged-data';
import Feed from './pages/Feed';
import FavoritesPage from './pages/Favorites';
import Locations from './pages/Locations';
import Social from './pages/Social';
const GameLogPage = lazy(() => import('./pages/GameLog'));
const ChartsPage = lazy(() => import('./pages/Charts'));
import { clearFavoriteEntityCache } from './api/favorites';
import PullRefresh from './components/PullRefresh';
import {
  PageHeader,
  Section,
  AvatarImage,
  imageOf,
  Badge,
  MoreButton,
  SearchField,
  Segmented,
  Loading,
  Empty,
  ErrorState,
  Modal,
} from './components/ui';
import Auth from './pages/Auth';
import Explore, { GroupDetail } from './pages/Explore';
import { CalendarPage, CalendarEventDetail, InventoryPage, MessengerPage } from './pages/Collections';
import { ProfilePage, SettingsPage, TimelinePage, ModerationPage } from './pages/Personal';
import { UserDetails, WorldDetails, statusName, rankOf } from './pages/Details';
type Screen =
  | 'home'
  | 'friends'
  | 'explore'
  | 'notifications'
  | 'more'
  | 'profile'
  | 'calendar'
  | 'inventory'
  | 'messenger'
  | 'timeline'
  | 'settings'
  | 'moderation'
  | 'feed'
  | 'locations'
  | 'favorites'
  | 'social'
  | 'gameLog'
  | 'charts';
const tabs: { id: Screen; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'friends', label: 'Друзья', icon: Users },
  { id: 'explore', label: 'Открыть', icon: Compass },
  { id: 'notifications', label: 'События', icon: Bell },
  { id: 'more', label: 'Ещё', icon: Grid2X2 },
];
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [demo, setDemo] = useState(false),
    [screen, setScreen] = useState<Screen>('home'),
    [previous, setPrevious] = useState<Screen>('home'),
    [visited, setVisited] = useState<Screen[]>(['home']),
    [pageRevisions, setPageRevisions] = useState<Partial<Record<Screen, number>>>({}),
    [mutationRevision, setMutationRevision] = useState(0),
    [selectedUser, setSelectedUser] = useState<User | string | null>(null),
    [selectedWorld, setSelectedWorld] = useState<World | string | null>(null),
    [selectedGroup, setSelectedGroup] = useState<Group | null>(null),
    [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null),
    [toast, setToast] = useState(''),
    [revision, setRevision] = useState(0),
    [notificationsRefresh, setNotificationsRefresh] = useState(0),
    [online, setOnline] = useState(navigator.onLine),
    [pipeline, setPipeline] = useState('connecting'),
    [activity, setActivity] = useState<ActivityItem[]>([]),
    [pending, setPending] = useState(0),
    [showDemo, setShowDemo] = useState(true);
  const contentRef = useRef<HTMLElement>(null),
    scrollPositions = useRef<Partial<Record<Screen, number>>>({}),
    mutationLock = useRef(false),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    notificationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    pipelineConnected = useRef(false);
  const friends = useFriends(user?.id, demo, revision);
  const history = useHistory(user?.id, demo);
  const calendarSync = useCalendarSync(user?.id, demo, online);
  const observation = useObservation(user, demo, online, pipeline === 'connected', friends, history, setUser);
  const pipelineSnapshot = useRef({friends, user, history});
  pipelineSnapshot.current = {friends, user, history};
  useEffect(() => { history.seedUsers(friends.data); }, [friends.data, history.seedUsers]);
  const notify = (text: string) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(''), 5000);
  };
  const record = (title: string, detail = '') =>
    setActivity((a) =>
      [{ id: crypto.randomUUID(), title, detail, time: new Date().toISOString() }, ...a].slice(
        0,
        200,
      ),
    );
  const refresh = () => {
    clearFavoriteEntityCache();
    setRevision((v) => v + 1);
    setPageRevisions((current) => ({ ...current, [screen]: (current[screen] || 0) + 1 }));
    if (screen === 'gameLog' || screen === 'charts') observation.refresh();
    if (screen === 'calendar' || screen === 'notifications') calendarSync.refresh();
  };
  const login = (u: User) => {
    clearImageCache();
    clearFavoriteEntityCache();
    setDemo(false);
    setUser(u);
    setScreen('home');
    setVisited(['home']); setPageRevisions({}); scrollPositions.current = {};
    record('Вход в аккаунт', u.displayName);
  };
  const logout = async () => {
    if (!demo) {
      try {
        const result = await api.logout();
        if (!result.serverLoggedOut)
          notify('Сессия удалена с устройства. Сервер VRChat недоступен.');
      } catch {
        notify('Не удалось удалить локальную сессию. Повторите выход.');
        return;
      }
    }
    clearImageCache();
    clearFavoriteEntityCache();
    setUser(null);
    setDemo(false);
    setActivity([]);
    setScreen('home');
    setVisited(['home']); setPageRevisions({}); scrollPositions.current = {};
    setSelectedUser(null);
    setSelectedWorld(null);
    setSelectedGroup(null);
    setSelectedEvent(null);
  };
  const act = async <T,>(operation: () => Promise<T>, success?: string): Promise<T | undefined> => {
    if (demo) {
      notify('Деморежим: для этого действия войдите в аккаунт в Android APK.');
      return;
    }
    if (mutationLock.current) {
      notify('Дождитесь завершения текущего действия.');
      return;
    }
    mutationLock.current = true;
    setPending((v) => v + 1);
    try {
      const result = await operation();
      if (success) {
        notify(success);
        record(success);
      }
      refresh();
      setMutationRevision((value) => value + 1);
      return result;
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Не удалось выполнить действие');
      if (e instanceof ApiError && e.status === 401) record('Требуется повторный вход');
      return;
    } finally {
      mutationLock.current = false;
      setPending((v) => Math.max(0, v - 1));
    }
  };
  const navigate = (s: Screen) => {
    scrollPositions.current[screen] = contentRef.current?.scrollTop || 0;
    setPrevious(screen);
    setVisited((current) => current.includes(s) ? current : [...current, s]);
    setScreen(s);
  };
  useLayoutEffect(() => {
    contentRef.current?.scrollTo({ top: scrollPositions.current[screen] || 0, behavior: 'instant' });
  }, [screen]);
  useEffect(() => {
    const c = localStorage.getItem('accent');
    if (c) document.documentElement.style.setProperty('--accent', c);
    const yes = () => setOnline(true),
      no = () => setOnline(false);
    window.addEventListener('online', yes);
    window.addEventListener('offline', no);
    return () => {
      window.removeEventListener('online', yes);
      window.removeEventListener('offline', no);
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!user || demo) return;
    let live = true;
    const handles: PluginListenerHandle[] = [];
    const reg = async () => {
      const h = await native.addListener('pipeline', (event) => {
        if (!live) return;
        const userId = String(event.content.userId || '');
        const labels: Record<string, string> = {
          'friend-online': 'Друг в VRChat',
          'friend-offline': 'Друг вышел',
          'friend-active': 'Друг на сайте',
          'friend-location': 'Друг сменил мир',
          'friend-update': 'Профиль друга обновлён',
          notification: 'Новое уведомление',
        };
        const label = labels[event.type];
        if (label)
          record(
            label,
            String(
              (event.content.user as Record<string, unknown> | undefined)?.displayName || userId,
            ),
          );
        const latest = pipelineSnapshot.current;
        if (latest.user) latest.history.observePipeline(event, latest.friends.data, latest.user);
        latest.friends.apply(event);
        if (event.type === 'user-update' && latest.user) {
          const partial = event.content.user as Partial<User> | undefined;
          const id = String(event.content.userId || partial?.id || '');
          if (partial && id === latest.user.id) {
            setUser((current) => current ? { ...current, ...partial, id: current.id } : current);
            if (typeof partial.location === 'string') latest.history.observeSession({ ...partial, id, displayName: partial.displayName || latest.user.displayName }, latest.friends.refreshing ? [] : latest.friends.data, 'pipeline');
          }
        }
        if (event.type.startsWith('notification')) { clearTimeout(notificationTimer.current); notificationTimer.current = setTimeout(() => setNotificationsRefresh((v) => v + 1), 1000); }
      });
      if (!live) {
        await h.remove();
        return;
      }
      handles.push(h);
      const c = await native.addListener('connection', (event) => {
        if (live) { setPipeline(event.state); if (event.state !== 'connected') pipelineSnapshot.current.history.pause(); else if (pipelineConnected.current) pipelineSnapshot.current.friends.reload(); }
      });
      if (!live) {
        await c.remove();
        return;
      }
      handles.push(c);
      await native.connectPipeline();
      pipelineConnected.current = true;
    };
    reg().catch(() => {
      if (live) setPipeline('disconnected');
    });
    const onVisible = () => {
      if (document.visibilityState !== 'visible') pipelineSnapshot.current.history.pause();
      if (document.visibilityState === 'visible') {
        if (!pipelineConnected.current) void native.connectPipeline().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      handles.forEach((h) => void h.remove());
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(notificationTimer.current);
      void native.disconnectPipeline();
      pipelineConnected.current = false;
    };
  }, [user?.id, demo]);
  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    let handle: PluginListenerHandle | undefined;
    void AndroidApp.addListener('backButton', () => {
      if (document.querySelector('[role="dialog"]')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return;
      }
      if (user && screen !== 'home') {
        navigate('home');
        return;
      }
      void AndroidApp.exitApp();
    }).then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    });
    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [screen, user?.id]);
  if (!user)
    return (
      <>
        <Auth
          onLogin={login}
          onDemo={() => {
            setDemo(true);
            setUser(demoUser);
            setScreen('home');
            setShowDemo(true);
            setVisited(['home']); setPageRevisions({}); scrollPositions.current = {};
          }}
        />
        {toast && (
          <div role="status" className="toast">
            {toast}
          </div>
        )}
      </>
    );
  const topLevel = tabs.some((t) => t.id === screen),
    navScreen = topLevel ? screen : 'more';
  return (
    <AppProvider
      value={{
        user,
        onUserUpdated: setUser,
        demo,
        online,
        refresh: revision,
        friends,
        history,
        observation,
        calendarSync,
        notificationsRefresh,
        notify,
        act,
        openUser: (target) => {
          setSelectedWorld(null);
          setSelectedGroup(null);
          setSelectedEvent(null);
          setSelectedUser(target);
        },
        openWorld: (target) => {
          setSelectedUser(null);
          setSelectedGroup(null);
          setSelectedEvent(null);
          setSelectedWorld(target);
        },
        openGroup: (target) => { setSelectedUser(null); setSelectedWorld(null); setSelectedEvent(null); setSelectedGroup(target); },
        openCalendarEvent: (target) => { setSelectedUser(null); setSelectedWorld(null); setSelectedGroup(null); setSelectedEvent(target); },
        onRefresh: refresh,
        logout,
        activity,
      }}
    >
      <div className="app-shell">
        <aside className="sidebar">
          <button
            className="brand"
            onClick={() => navigate('home')}
            aria-label="VRCNext Mobile, главная"
          >
            <SecureImage src="/mark.svg" alt="" />
            <div>
              VRCNext <span>Mobile</span>
            </div>
          </button>
          <span className="nav-caption">ВАШЕ ПРОСТРАНСТВО</span>
          <nav className="side-nav" aria-label="Основная навигация">
            {tabs.map((t) => (
              <button
                key={t.id}
                aria-label={t.label}
                className={navScreen === t.id ? 'active' : ''}
                onClick={() => navigate(t.id)}
                aria-current={navScreen === t.id ? 'page' : undefined}
              >
                <t.icon size={21} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="connection">
              <i
                className={`connection-dot ${!online ? 'offline' : pipeline === 'connected' || demo ? 'connected' : ''}`}
              />
              <span>
                {demo
                  ? 'Демонстрация'
                  : !online
                    ? 'Нет подключения'
                    : pipeline === 'connected'
                      ? 'VRChat подключён'
                      : 'Обновление по запросу'}
              </span>
            </div>
            <button className="account-button" onClick={() => navigate('profile')}>
              <AvatarImage
                src={imageOf(user)}
                name={user.displayName}
                size={38}
                status={user.status}
              />
              <div>
                <strong>{user.displayName}</strong>
                <span>{demo ? 'Деморежим' : statusName(user.status)}</span>
              </div>
              <Settings size={17} />
            </button>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="topbar-left">
              {!topLevel ? (
                <button
                  className="icon-button"
                  aria-label="Назад"
                  onClick={() => navigate(previous === screen ? 'more' : previous)}
                >
                  <ArrowLeft size={21} />
                </button>
              ) : (
                <SecureImage className="mobile-mark" src="/mark.svg" alt="VRCNext Mobile" />
              )}
              <div className="breadcrumb">
                VRCNext <span>/</span>{' '}
                <strong>
                  {tabs.find((t) => t.id === screen)?.label ||
                    {
                      profile: 'Профиль',
                      calendar: 'Календарь',
                      inventory: 'Медиатека',
                      messenger: 'Сообщения',
                      timeline: 'Активность',
                      feed: 'Лента', locations: 'Friends Locations', favorites: 'Избранное', social: 'Social', gameLog: 'Журнал игры', charts: 'Диаграммы',
                      settings: 'Настройки',
                      moderation: 'Модерация',
                    }[screen as string as 'profile']}
                </strong>
              </div>
            </div>
            <div className="row">
              {demo && <Badge className="demo-badge">DEMO</Badge>}
              <button
                className="icon-button"
                aria-label="Обновить данные"
                onClick={() => {
                  refresh();
                  notify('Обновляем данные');
                }}
              >
                <RefreshCw size={18} />
              </button>
              <button
                className="avatar-button"
                aria-label="Мой профиль"
                onClick={() => navigate('profile')}
              >
                <AvatarImage src={imageOf(user)} name={user.displayName} size={34} />
              </button>
            </div>
          </header>
          {!online && (
            <div className="offline-banner" role="status">
              <WifiOff size={16} />
              Нет подключения к интернету. Данные могут быть устаревшими.
            </div>
          )}
          {demo && showDemo && (
            <div className="demo-banner">
              <span>Вы в деморежиме. Данные примеров не связаны с VRChat.</span>
              <button
                onClick={() => setShowDemo(false)}
                className="icon-button"
                aria-label="Скрыть подсказку деморежима"
              >
                <X size={15} />
              </button>
            </div>
          )}
          {calendarSync.reminders[0] && <div className="calendar-reminder-banner" role="status">
            <button onClick={() => { setSelectedUser(null); setSelectedWorld(null); setSelectedGroup(null); setSelectedEvent(calendarSync.reminders[0].event); calendarSync.dismissReminder(calendarSync.reminders[0].id); }}><CalendarDays size={17} /><span>Скоро: {calendarSync.reminders[0].event.title || 'Событие группы'}</span></button>
            <button className="icon-button" aria-label="Скрыть напоминание события" onClick={() => calendarSync.dismissReminder(calendarSync.reminders[0].id)}><X size={16} /></button>
          </div>}
          {pending > 0 && (
            <div className="progress-line" aria-label="Выполняется действие" role="status" />
          )}
          <PullRefresh mainRef={contentRef} onRefresh={refresh}>
            {visited.map((page) => <section key={page} hidden={screen !== page} className="retained-screen" data-screen={page}>
              <PageScope active={screen === page} refresh={mutationRevision + (pageRevisions[page] || 0)}>
                <Suspense fallback={<Loading />}>
                  {page === 'home' ? <HomePage navigate={navigate} />
                    : page === 'friends' ? <FriendsPage />
                    : page === 'explore' ? <Explore />
                    : page === 'notifications' ? <NotificationsPage />
                    : page === 'more' ? <MorePage navigate={navigate} />
                    : page === 'profile' ? <ProfilePage onUpdated={setUser} />
                    : page === 'calendar' ? <CalendarPage />
                    : page === 'inventory' ? <InventoryPage />
                    : page === 'messenger' ? <MessengerPage />
                    : page === 'charts' ? <ChartsPage />
                    : page === 'gameLog' ? <GameLogPage />
                    : page === 'social' ? <Social />
                    : page === 'favorites' ? <FavoritesPage />
                    : page === 'locations' ? <Locations />
                    : page === 'feed' ? <Feed />
                    : page === 'timeline' ? <TimelinePage />
                    : page === 'moderation' ? <ModerationPage /> : <SettingsPage />}
                </Suspense>
              </PageScope>
            </section>)}
            <footer className="page-footer">
              VRCNext Mobile <span>✦</span> Рядом с вашими мирами
            </footer>
          </PullRefresh>
          <nav className="bottom-nav" aria-label="Основная навигация">
            {tabs.map((t) => (
              <button
                key={t.id}
                aria-label={t.label}
                className={navScreen === t.id ? 'active' : ''}
                onClick={() => navigate(t.id)}
                aria-current={navScreen === t.id ? 'page' : undefined}
              >
                <span>
                  <t.icon size={21} />
                </span>
                <small>{t.label}</small>
              </button>
            ))}
          </nav>
        </div>
      </div>
      {selectedEvent && <CalendarEventDetail initial={selectedEvent} onClose={() => setSelectedEvent(null)} />}
      {selectedGroup && <GroupDetail initial={selectedGroup} onClose={() => setSelectedGroup(null)} onChanged={refresh} />}
      {selectedUser && <UserDetails target={selectedUser} onClose={() => setSelectedUser(null)} />}
      {selectedWorld && (
        <WorldDetails target={selectedWorld} onClose={() => setSelectedWorld(null)} />
      )}
      {toast && (
        <div role="status" className="toast">
          <Check size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="Закрыть уведомление"
            onClick={() => setToast('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </AppProvider>
  );
}
function HomePage({ navigate }: { navigate: (s: Screen) => void }) {
  const ctx = useApp();
  const worldSnapshot = useRef<World[]>([]);
  const data = { ...ctx.friends, data: ctx.friends.data.filter((f) => f.location !== 'offline' && f.state !== 'offline') };
  const online = data.data?.filter((f) => f.location && f.location !== 'offline') || [];
  const worlds = useLoad(async () => {
    if (ctx.demo) return demoWorlds;
    const unique = [
      ...new Set(
        (data.data || [])
          .map((f) => f.location?.split(':')[0])
          .filter((x): x is string => !!x && x.startsWith('wrld_')),
      ),
    ];
    const result = await Promise.allSettled(unique.slice(0, 8).map((id) => api.world(id)));
    const incoming = result.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (result.length && !incoming.length) throw new Error('Не удалось загрузить миры друзей. Повторите обновление.');
    worldSnapshot.current = reconcilePage(worldSnapshot.current, incoming);
    return worldSnapshot.current;
  }, [[...new Set((data.data || []).map((f) => f.location?.split(':')[0]).filter((x) => x?.startsWith('wrld_')))].sort().join(','), ctx.demo, ctx.refresh]);
  return (
    <>
      <PageHeader
        eyebrow="ВАШЕ ПРОСТРАНСТВО"
        title={`Привет, ${ctx.user.displayName} ✦`}
        subtitle="Следующая встреча ближе, чем кажется."
        actions={
          <span className="date-label">
            {new Date().toLocaleDateString('ru', { day: 'numeric', month: 'long' })}
          </span>
        }
      />
      <section className="hero">
        <div className="hero-shade" />
        <div className="hero-content">
          <span className="hero-kicker">
            <span className="live-dot" />
            СНОВА ВМЕСТЕ
          </span>
          <h2>
            Хороший мир —<br />
            там, где ваши друзья.
          </h2>
          <p>
            {ctx.demo
              ? 'Luna и ещё 3 друга уже исследуют миры.'
              : online.length
                ? `${online.length} друзей в VRChat. Загляните к ним.`
                : 'Найдите новое место для следующей встречи.'}
          </p>
          <button className="button light" onClick={() => navigate('friends')}>
            Найти свою компанию
            <ArrowUpRight size={18} />
          </button>
        </div>
        <span className="hero-world">
          <MapPin size={13} />
          Beyond the Clouds{ctx.demo ? ' · Демо' : ''}
        </span>
      </section>
      <div className="dashboard-stats">
        <button onClick={() => navigate('friends')}>
          <span className="stat-icon green">
            <Users size={20} />
          </span>
          <div>
            <strong>{data.loading ? '—' : online.length}</strong>
            <span>друзей в VRChat</span>
          </div>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => navigate('explore')}>
          <span className="stat-icon purple">
            <Globe2 size={20} />
          </span>
          <div>
            <strong>{worlds.loading ? '—' : worlds.data?.length || 0}</strong>
            <span>миров с друзьями</span>
          </div>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => navigate('calendar')}>
          <span className="stat-icon peach">
            <CalendarDays size={20} />
          </span>
          <div>
            <strong>Календарь</strong>
            <span>следующая встреча</span>
          </div>
          <ChevronRight size={16} />
        </button>
      </div>
      <Section title="Друзья рядом" action={<MoreButton onClick={() => navigate('friends')} />}>
        {data.loading ? (
          <Loading />
        ) : data.error ? (
          <ErrorState error={data.error} retry={data.reload} />
        ) : data.data?.length ? (
          <div className="friends-strip">
            {data.data.slice(0, 7).map((f) => (
              <button className="friend-bubble" key={f.id} onClick={() => ctx.openUser(f)}>
                <AvatarImage src={imageOf(f)} name={f.displayName} size={58} status={f.status} />
                <strong>{f.displayName}</strong>
                <span>
                  {f.location?.startsWith('wrld_')
                    ? 'В VRChat'
                    : f.state === 'online'
                      ? 'На сайте'
                      : statusName(f.status)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <Empty title="Пока никого нет" text="Найдите друзей на вкладке «Друзья»." />
        )}
      </Section>
      <Section
        title="Где сейчас друзья"
        action={
          <MoreButton onClick={() => navigate('locations')}>
            Миры
            <ChevronRight size={16} />
          </MoreButton>
        }
      >
        {worlds.error && <ErrorState error={worlds.error} retry={worlds.reload} />}
        {worlds.loading ? (
          <Loading />
        ) : worlds.data?.length ? (
          <div className="world-grid">
            {worlds.data.map((w, i) => {
              const users = (data.data || []).filter((f) => f.location?.startsWith(`${w.id}:`));
              return (
                <button
                  className="media-card world-card"
                  key={w.id}
                  onClick={() => ctx.openWorld(w)}
                >
                  <div className="media-cover">
                    <SecureImage src={w.thumbnailImageUrl || w.imageUrl} alt="" loading="lazy" />
                    {w.unityPackages?.some((p) => p.platform === 'android') && (
                      <span className="platform-tag">ANDROID</span>
                    )}
                    <span className="world-population">
                      <Users size={12} />
                      {(w.occupants || 0).toLocaleString('ru')}
                    </span>
                  </div>
                  <div className="card-body">
                    <h3>{w.name}</h3>
                    <p className="muted small">by {w.authorName}</p>
                    <div className="world-friend-row">
                      <span className="mini-avatars">
                        {users.slice(0, 3).map((f) => (
                          <AvatarImage key={f.id} name={f.displayName} src={imageOf(f)} size={24} />
                        ))}
                      </span>
                      <span>
                        {users.length
                          ? `${users.length} ${users.length === 1 ? 'друг' : 'друга'} здесь`
                          : 'Открыть мир'}
                      </span>
                      <ArrowUpRight size={15} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <Empty
            title="Здесь появятся миры друзей"
            text="Миры отображаются, когда их местоположение доступно."
          />
        )}
      </Section>
      <section className="discover-banner">
        <Compass size={30} />
        <div>
          <h3>За пределами привычного</h3>
          <p>Найдите мир, в котором ещё не были.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Исследовать миры"
          onClick={() => navigate('explore')}
        >
          <ArrowUpRight size={24} />
        </button>
      </section>
    </>
  );
}
function FriendsPage() {
  const ctx = useApp(),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [search, setSearch] = useState(false),
    [page, setPage] = useState(0),
    [people, setPeople] = useState<User[]>([]),
    [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query);
      setPage(0);
      setPeople([]);
    }, 350);
    return () => clearTimeout(t);
  }, [query, search]);
  const results = useLoad(
    () => ctx.demo ? Promise.resolve(ctx.friends.data) : search && debounced ? api.searchUsers(debounced, page * 50) : Promise.resolve([]),
    [ctx.refresh, search, debounced, page],
  );
  const friends = search ? results : ctx.friends;
  useEffect(() => {
    if (search && friends.data)
      setPeople((p) =>
        page === 0
          ? friends.data!
          : Array.from(new Map([...p, ...friends.data!].map((x) => [x.id, x])).values()),
      );
  }, [friends.data]);
  const items = (search ? people : friends.data || []).filter(
    (f) =>
      f.displayName.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'online' && (f.location === 'private' || f.location?.startsWith('wrld_'))) ||
        (filter === 'web' && (f.state === 'online' || f.state === 'active') && f.location !== 'private' && !f.location?.startsWith('wrld_')) ||
        (filter === 'offline' && !f.location?.startsWith('wrld_') && f.location !== 'private' && f.state !== 'online' && f.state !== 'active')),
  );
  return (
    <>
      <PageHeader
        eyebrow="ВАШ КРУГ"
        title={search ? 'Найти людей' : 'Друзья'}
        subtitle="Хорошая компания всегда рядом"
        actions={
          <button
            className="button secondary compact"
            onClick={() => {
              setSearch(!search);
              setQuery('');
            }}
          >
            {search ? <Users size={17} /> : <Plus size={17} />}
            {search ? 'Мои друзья' : 'Найти людей'}
          </button>
        }
      />
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={search ? 'Имя пользователя VRChat' : 'Поиск по друзьям'}
      />
      {!search && (
        <Segmented
          value={filter}
          onChange={setFilter}
          items={[
            { id: 'all', label: 'Все' },
            { id: 'online', label: 'В VRChat' },
            { id: 'web', label: 'На сайте' },
            { id: 'offline', label: 'Не в сети' },
          ]}
        />
      )}
      <div className="section-heading">
        <h2>{search ? 'Результаты поиска' : 'Ваша компания'}</h2>
        <span className="count-label">{items.length}</span>
      </div>
      {friends.loading && !items.length ? (
        <Loading />
      ) : friends.error ? (
        <ErrorState error={friends.error} retry={friends.reload} />
      ) : items.length ? (
        <div className="friend-grid">
          {items.map((f) => (
            <button className="friend-card card" key={f.id} onClick={() => ctx.openUser(f)}>
              <AvatarImage name={f.displayName} src={imageOf(f)} size={54} status={f.status} />
              <div className="friend-card-text">
                <h3>{f.displayName}</h3>
                <p>{f.statusDescription || statusName(f.status)}</p>
                <span className="friend-location">
                  <i className={`status-dot status-${f.status}`} />
                  {presenceLabel(f)}
                </span>
              </div>
              <span className="friend-rank">{rankOf(f.tags)}</span>
              <ChevronRight size={17} />
            </button>
          ))}
        </div>
      ) : (
        <Empty
          title={search && !query ? 'Кого ищем?' : 'Никого не найдено'}
          text={
            search
              ? 'Введите имя пользователя, чтобы найти человека в VRChat.'
              : 'Попробуйте другой фильтр или поисковый запрос.'
          }
        />
      )}{' '}
      {search && friends.data?.length === 50 && (
        <button
          className="button secondary load-more"
          disabled={friends.loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Загрузить ещё
        </button>
      )}
    </>
  );
}
const notificationLabel = (type: string) =>
  ({
    boop: 'Boop от друга',
    friendRequest: 'Заявка в друзья',
    invite: 'Приглашение',
    requestInvite: 'Запрос приглашения',
    inviteResponse: 'Ответ на приглашение',
    requestInviteResponse: 'Ответ на запрос',
    'group.announcement': 'Объявление группы',
    'group.event.created': 'Новое событие группы',
    'group.event.starting': 'Событие группы скоро начнётся',
    'event.announcement': 'Объявление мероприятия',
    'group.invite': 'Приглашение в группу',
    'group.joinRequest': 'Запрос в группу',
    groupAnnouncement: 'Объявление группы',
  })[type] || 'Уведомление VRChat';
function GroupEventNotices() {
  const ctx = useApp();
  const upcoming = ctx.calendarSync.events.filter((event) => Date.parse(event.startsAt || event.startDate || '') > Date.now()).sort((a,b) => Date.parse(a.startsAt || a.startDate || '') - Date.parse(b.startsAt || b.startDate || ''));
  if (ctx.demo) return null;
  return <section className="section group-event-notices">
    <div className="section-heading"><h2>Предстоящие события групп</h2><button className="text-button" disabled={ctx.calendarSync.loading} onClick={ctx.calendarSync.refresh}>Обновить события</button></div>
    {ctx.calendarSync.error && <ErrorState error={ctx.calendarSync.error} retry={ctx.calendarSync.refresh} />}
    <p className="muted small">Синхронизация раз в 5 минут при открытом приложении.{ctx.calendarSync.lastSync ? ` Последняя: ${new Date(ctx.calendarSync.lastSync).toLocaleString('ru')}.` : ''}</p>
    {ctx.calendarSync.loading && !upcoming.length ? <Loading /> : !upcoming.length ? <p className="muted">Предстоящих событий в полученных данных нет.</p> : upcoming.slice(0, 8).map((event) => <button key={event.id} className="card group-event-notice" onClick={() => ctx.openCalendarEvent(event)}><CalendarDays size={19} /><span><strong>{event.title || event.name || 'Событие группы'}</strong><small>{event.group?.name || event.groupId || 'Группа'} · {new Date(event.startsAt || event.startDate!).toLocaleString('ru')}</small>{event.description && <small className="group-event-excerpt">{event.description}</small>}</span><ChevronRight size={17} /></button>)}
  </section>;
}
function NotificationsPage() {
  const ctx = useApp(),
    [offset, setOffset] = useState(0),
    [items, setItems] = useState<Notification[]>([]),
    [response, setResponse] = useState<Notification | null>(null),
    [text, setText] = useState('');
  const scope = `${ctx.pageActive !== false}:${ctx.refresh}:${ctx.notificationsRefresh}:${offset}`;
  const observation = useRef({ scope, generation: 0 });
  if (observation.current.scope !== scope) observation.current = { scope, generation: observation.current.generation + 1 };
  const load = useLoad(
    async () => {
      if (ctx.demo) return {items: [
            {
              id: 'demo_invite',
              type: 'invite',
              senderUsername: 'Luna',
              senderUserId: 'usr_1',
              message: 'Присоединяйся, мы на крыше! ✦',
              created_at: new Date().toISOString(),
              details: { worldId: 'wrld_demo1:demo' },
            },
          ] as Notification[], hasMore: false};
      const generation = observation.current.generation;
      const isCurrent = () => observation.current.generation === generation;
      const page = await api.notificationPage(offset, isCurrent);
      if (!isCurrent()) return { items: [], hasMore: false };
      // Modern V2 is a recent snapshot. Refresh it even while older V1 pages are open.
      const head = offset ? (await api.notificationPage(0, isCurrent)).items : [];
      return { items: [...head, ...page.items], hasMore: page.hasMore };
    },
    [ctx.refresh, ctx.notificationsRefresh, offset],
  );
  useEffect(() => {
    if (load.data)
      setItems((p) =>
        offset === 0
          ? load.data!.items
          : Array.from(new Map([...p, ...load.data!.items].map((n) => [n.id, n])).values()),
      );
  }, [load.data]);
  const action = (operation: () => Promise<unknown>, success: string, id: string) =>
    void ctx.act(async () => {
      await operation();
      setItems((p) => p.filter((i) => i.id !== id));
    }, success);
  const locationOf = (n: Notification) => {
    const d = n.details || {};
    const raw = String(d.worldId || d.instanceId || '');
    return raw.startsWith('wrld_') ? raw : '';
  };
  return (
    <>
      <PageHeader
        eyebrow="НЕ ПРОПУСТИТЕ"
        title="Уведомления"
        subtitle="Приглашения, друзья и события групп"
      />
      <GroupEventNotices />
      {load.loading && !items.length ? (
        <Loading />
      ) : load.error ? (
        <ErrorState error={load.error} retry={load.reload} />
      ) : !items.length ? (
        <Empty
          title="Вы всё посмотрели"
          text="Новые приглашения и заявки появятся здесь."
          icon={<Bell size={32} />}
        />
      ) : (
        <div className="notification-list">
          {items.map((n) => (
            <article className="card notification-card" key={n.id}>
              <div className="notification-icon">
                {n.type === 'friendRequest' ? (
                  <Users size={21} />
                ) : n.type.includes('group') ? (
                  <Globe2 size={21} />
                ) : (
                  <Send size={21} />
                )}
              </div>
              <div className="notification-body">
                <div className="notification-meta">
                  <Badge>{notificationLabel(n.type)}</Badge>
                  <time>
                    {n.created_at || n.createdAt ? new Date(n.created_at || n.createdAt!).toLocaleString('ru', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    }) : 'Время не передано'}
                  </time>
                </div>
                <button
                  className="text-button person-link"
                  onClick={() => n.senderUserId && ctx.openUser(n.senderUserId)}
                >
                  {n.senderUsername || 'VRChat'}
                </button>
                <p>{n.message || 'Новое событие в вашем аккаунте.'}</p>
                <div className="detail-actions">
                  {['friendRequest', 'group.invite', 'group.joinRequest'].includes(n.type) && (
                    <button
                      className="button primary compact"
                      onClick={() =>
                        action(
                          async () => { await api.acceptNotification(n, ctx.user.location); if (n.type === 'friendRequest' && n.senderUserId) ctx.history.recordFriendAction(n.senderUserId, n.senderUsername || n.senderUserId, 'friend-add'); },
                          'Запрос принят',
                          n.id,
                        )
                      }
                    >
                      Принять
                    </button>
                  )}
                  {n.type === 'invite' && locationOf(n) && (
                    <button
                      className="button primary compact"
                      onClick={() =>
                        action(() => api.acceptNotification(n), 'Приглашение принято', n.id)
                      }
                    >
                      Принять приглашение
                    </button>
                  )}
                  {(n.type === 'invite' || n.type === 'requestInvite') && (
                    <button className="button secondary compact" onClick={() => setResponse(n)}>
                      Ответить
                    </button>
                  )}
                  {n.type === 'requestInvite' && n.senderUserId && (
                    <button
                      className="button primary compact"
                      onClick={() =>
                        action(
                          () => api.invite(n.senderUserId!, ctx.user.location || ''),
                          'Приглашение отправлено',
                          n.id,
                        )
                      }
                    >
                      Пригласить
                    </button>
                  )}
                  {parseCalendarLink(n._link || n.link) && <button className="button secondary compact" onClick={() => {
                    const link = parseCalendarLink(n._link || n.link)!;
                    ctx.openCalendarEvent({ id: link.eventId, groupId: link.groupId, title: n.title || 'Событие группы' });
                  }}>Открыть мероприятие</button>}
                  {n.seen !== true && <button className="button secondary compact" onClick={() => void ctx.act(async () => { await api.readNotification(n); setItems((current) => current.map((item) => item.id === n.id ? {...item, seen:true} : item)); }, 'Уведомление прочитано')}>Прочитано</button>}
                  <button
                    className="button secondary compact"
                    disabled={n.canDelete === false}
                    title={n.canDelete === false ? 'VRChat не разрешает удаление этого уведомления' : undefined}
                    onClick={() =>
                      action(() => api.dismissNotification(n), 'Уведомление скрыто', n.id)
                    }
                  >
                    {n.type === 'friendRequest' ? 'Отклонить' : 'Скрыть'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {load.data?.hasMore && (
        <button className="button secondary load-more" disabled={load.loading} onClick={() => setOffset((o) => o + 100)}>
          Загрузить ещё
        </button>
      )}
      {response && (
        <Modal title="Ответ на приглашение" onClose={() => setResponse(null)}>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void ctx.act(async () => {
                await api.respondToInvite(
                  ctx.user.id,
                  response.id,
                  response.type as 'invite' | 'requestInvite',
                  text,
                );
                setResponse(null);
                setText('');
              }, 'Ответ отправлен');
            }}
          >
            <p className="muted">
              Ответ использует шаблон VRChat и доступный слот. Частоту изменений ограничивает
              VRChat.
            </p>
            <label className="field">
              Ваш ответ
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={64}
                required
              />
            </label>
            <button className="button primary" type="submit">
              Отправить
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function MorePage({ navigate }: { navigate: (s: Screen) => void }) {
  const { user, demo } = useApp();
  const options: {
    id: Screen;
    title: string;
    text: string;
    icon: ComponentType<{ size?: number }>;
    color: string;
  }[] = [
    { id: 'charts', title: 'Диаграммы', text: 'Время, встречи и известные связи', icon: Activity, color: 'purple' },
    { id: 'gameLog', title: 'Журнал игры', text: 'Наблюдения миров и встреч', icon: Radio, color: 'green' },
    { id: 'feed', title: 'Лента', text: 'История наблюдаемых событий', icon: Activity, color: 'purple' },
    { id: 'locations', title: 'Friends Locations', text: 'Друзья по мирам и инстансам', icon: MapPin, color: 'green' },
    { id: 'favorites', title: 'Избранное', text: 'Друзья, миры и аватары', icon: Star, color: 'peach' },
    { id: 'social', title: 'Social', text: 'Друзья, журнал и модерация', icon: Users, color: 'blue' },
    {
      id: 'profile',
      title: 'Мой профиль',
      text: 'Статус, описание и ссылки',
      icon: UserRound,
      color: 'purple',
    },
    {
      id: 'messenger',
      title: 'Сообщения',
      text: 'Короткое сообщение другу',
      icon: MessageSquare,
      color: 'green',
    },
    {
      id: 'calendar',
      title: 'Календарь',
      text: 'События и встречи',
      icon: CalendarDays,
      color: 'peach',
    },
    {
      id: 'inventory',
      title: 'Медиатека',
      text: 'Фото, emoji и инвентарь',
      icon: Images,
      color: 'blue',
    },
    {
      id: 'timeline',
      title: 'Действия',
      text: 'Действия текущей сессии',
      icon: Activity,
      color: 'purple',
    },
    {
      id: 'moderation',
      title: 'Блокировки',
      text: 'Списки block и mute',
      icon: ShieldCheck,
      color: 'peach',
    },
    {
      id: 'settings',
      title: 'Настройки',
      text: 'Внешний вид и приложение',
      icon: Settings,
      color: 'blue',
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="ВСЁ ПОД РУКОЙ"
        title="Ваш VRCNext"
        subtitle="Аккаунт, события и ваши коллекции"
      />
      <button className="card more-profile" onClick={() => navigate('profile')}>
        <AvatarImage name={user.displayName} src={imageOf(user)} size={60} status={user.status} />
        <div>
          <h2>{user.displayName}</h2>
          <p className="muted">{demo ? 'Демонстрационный аккаунт' : statusName(user.status)}</p>
        </div>
        <ChevronRight size={22} />
      </button>
      <div className="more-grid">
        {options.map((o) => (
          <button className="card more-card" onClick={() => navigate(o.id)} key={o.id}>
            <span className={`stat-icon ${o.color}`}>
              <o.icon size={23} />
            </span>
            <h3>{o.title}</h3>
            <p>{o.text}</p>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
    </>
  );
}
