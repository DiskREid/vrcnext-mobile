import { useAppearanceRuntime } from './data/appearance';
import HolidayDecor from './components/HolidayDecor';
import GlassRefraction from './components/GlassRefraction';
import BrandLogo from './components/BrandLogo';
import { useLauncherIconRuntime } from './data/launcher-icons';
import './appearance.css';
import './hero-artwork.css';
import './components/GlassSurfaces.css';
import type { UiMessage } from './i18n';
import { t, useI18n, dateLocale } from './i18n';
import SecureImage, { clearImageCache } from './components/SecureImage';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Home,
  Info,
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
import type { User, World, Group, CalendarEvent } from './api';
import { App as AndroidApp } from '@capacitor/app';
import { api, native, ApiError, isNative } from './api';
import type { PluginListenerHandle } from '@capacitor/core';
import { AppProvider, PageScope, useApp, useLoad } from './state';
import type { Activity as ActivityItem } from './state';
import { demoUser, demoWorlds, demoEvents } from './demo';
import { useFriends } from './data/friends';
import {
  clearFriendFavoritesCache,
  invalidateFriendFavoritesCache,
  useFriendFavorites,
} from './data/favorite-friends';
import { useHistory } from './data/history';
import { useAvatarHistoryResolver } from './data/use-avatar-history-resolver';
import { useObservation } from './data/observation';
import { useCalendarSync } from './data/calendar-sync';
import { disclosedUserLocation, presenceLabel } from './data/locations';
import { presenceMode } from './data/presence';
import { normalizeSelfUser, selfUserUpdate } from './data/self-user';
import { reconcilePage } from './hooks/paged-data';
import { pipelineActivity } from './data/session-activity';
import Feed from './pages/Feed';
import FavoritesPage from './pages/Favorites';
import Locations from './pages/Locations';
import Social from './pages/Social';
import NotificationsPage from './pages/Notifications';
const ChartsPage = lazy(() => import('./pages/Charts'));
import { clearFavoriteEntityCache } from './api/favorites';
import PullRefresh from './components/PullRefresh';
import {
  PageHeader,
  Section,
  AvatarImage,
  PresenceIndicator,
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
import {
  CalendarPage,
  CalendarEventDetail,
  InventoryPage,
  MessengerPage,
} from './pages/Collections';
import AboutPage from './pages/About';
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
  | 'about'
  | 'settings'
  | 'moderation'
  | 'feed'
  | 'locations'
  | 'favorites'
  | 'social'
  | 'charts';
const tabs: { id: Screen; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'friends', label: 'Друзья', icon: Users },
  { id: 'explore', label: 'Открыть', icon: Compass },
  { id: 'notifications', label: 'События', icon: Bell },
  { id: 'more', label: 'Ещё', icon: Grid2X2 },
];
export default function App() {
  useI18n();
  useAppearanceRuntime();
  useLauncherIconRuntime();
  const [user, setUser] = useState<User | null>(null),
    [demo, setDemo] = useState(false),
    [screen, setScreen] = useState<Screen>('home'),
    [previous, setPrevious] = useState<Screen>('home'),
    [visited, setVisited] = useState<Screen[]>(['home']),
    [pageRevisions, setPageRevisions] = useState<Partial<Record<Screen, number>>>({}),
    [mutationRevision, setMutationRevision] = useState(0),
    [selectedUser, setSelectedUser] = useState<User | string | null>(null),
    [selectedWorld, setSelectedWorld] = useState<World | string | null>(null),
    [selectedWorldLocation, setSelectedWorldLocation] = useState<string>(),
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
  const avatarHistory = useAvatarHistoryResolver(user?.id, demo, online, history);
  const calendarSync = useCalendarSync(user?.id, demo, online);
  const observation = useObservation(
    user,
    demo,
    online,
    pipeline === 'connected',
    friends,
    history,
    setUser,
  );
  const pipelineSnapshot = useRef({ friends, user, history, avatarHistory });
  pipelineSnapshot.current = { friends, user, history, avatarHistory };
  useEffect(() => {
    // The list establishes missing baselines. Feed changes are observed from
    // the actual update event, not manufactured by checking the whole list.
    history.seedUsers(friends.data);
  }, [friends.data, history.seedUsers]);
  const notify = (text: string) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(''), 5000);
  };
  const record = (
    title: string,
    detail = '',
    targets: Partial<
      Pick<
        ActivityItem,
        'userId' | 'displayName' | 'beforeLocation' | 'location' | 'worldId' | 'titleParams'
      >
    > = {},
  ) =>
    setActivity((a) =>
      [
        {
          id: crypto.randomUUID(),
          title,
          detail,
          time: new Date().toISOString(),
          ...targets,
        },
        ...a,
      ].slice(0, 200),
    );
  const refresh = () => {
    clearFavoriteEntityCache();
    invalidateFriendFavoritesCache();
    setRevision((v) => v + 1);
    setPageRevisions((current) => ({ ...current, [screen]: (current[screen] || 0) + 1 }));
    if (screen === 'charts') observation.refresh();
    if (screen === 'calendar' || screen === 'notifications') calendarSync.refresh();
  };
  const login = (u: User) => {
    clearImageCache();
    clearFavoriteEntityCache();
    clearFriendFavoritesCache();
    setDemo(false);
    setUser(normalizeSelfUser(u));
    setScreen('home');
    setVisited(['home']);
    setPageRevisions({});
    scrollPositions.current = {};
    record('Вход в аккаунт', u.displayName);
  };
  const logout = async () => {
    if (!demo) {
      try {
        const result = await api.logout();
        if (!result.serverLoggedOut)
          notify(t('Сессия удалена с устройства. Сервер VRChat недоступен.'));
      } catch {
        notify(t('Не удалось удалить локальную сессию. Повторите выход.'));
        return;
      }
    }
    clearImageCache();
    clearFavoriteEntityCache();
    clearFriendFavoritesCache();
    setUser(null);
    setDemo(false);
    setActivity([]);
    setScreen('home');
    setVisited(['home']);
    setPageRevisions({});
    scrollPositions.current = {};
    setSelectedUser(null);
    setSelectedWorld(null);
    setSelectedGroup(null);
    setSelectedEvent(null);
  };
  const act = async <T,>(
    operation: () => Promise<T>,
    success?: string | UiMessage,
  ): Promise<T | undefined> => {
    if (demo) {
      notify(t('Деморежим: для этого действия войдите в аккаунт в Android APK.'));
      return;
    }
    if (mutationLock.current) {
      notify(t('Дождитесь завершения текущего действия.'));
      return;
    }
    mutationLock.current = true;
    setPending((v) => v + 1);
    try {
      const result = await operation();
      if (success) {
        notify(typeof success === 'string' ? t(success) : t(success.key, success.params));
        record(
          typeof success === 'string' ? success : success.key,
          '',
          typeof success === 'string' ? {} : { titleParams: success.params },
        );
      }
      refresh();
      setMutationRevision((value) => value + 1);
      return result;
    } catch (e) {
      notify(e instanceof Error ? e.message : t('Не удалось выполнить действие'));
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
    setVisited((current) => (current.includes(s) ? current : [...current, s]));
    setScreen(s);
  };
  useLayoutEffect(() => {
    contentRef.current?.scrollTo({
      top: scrollPositions.current[screen] || 0,
      behavior: 'instant',
    });
  }, [screen]);
  useEffect(() => {
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
        const latest = pipelineSnapshot.current;
        if (latest.user) {
          const item = pipelineActivity(event, latest.friends.data, latest.user);
          if (item) record(item.title, item.detail, item);
        }
        if (latest.user)
          latest.avatarHistory.observe(
            latest.history.observePipeline(event, latest.friends.data, latest.user),
          );
        latest.friends.apply(event);
        const ownUpdate = latest.user && selfUserUpdate(event, latest.user);
        if (ownUpdate) {
          // Consecutive pipeline messages can arrive before React renders again.
          latest.user = ownUpdate.user;
          setUser((current) =>
            current?.id === ownUpdate.user.id
              ? { ...current, ...ownUpdate.patch, id: current.id }
              : current,
          );
          if (ownUpdate.locationChanged)
            latest.history.observeSession(
              ownUpdate.user,
              latest.friends.refreshing ? [] : latest.friends.data,
              'pipeline',
            );
        }
        if (event.type.startsWith('notification')) {
          clearTimeout(notificationTimer.current);
          notificationTimer.current = setTimeout(() => setNotificationsRefresh((v) => v + 1), 1000);
        }
      });
      if (!live) {
        await h.remove();
        return;
      }
      handles.push(h);
      const c = await native.addListener('connection', (event) => {
        if (live) {
          setPipeline(event.state);
          if (event.state !== 'connected') pipelineSnapshot.current.history.pauseSession();
          else if (pipelineConnected.current) pipelineSnapshot.current.friends.reload();
        }
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
        <GlassRefraction />
        <Auth
          onLogin={login}
          onDemo={() => {
            setDemo(true);
            setUser(demoUser);
            setScreen('home');
            setShowDemo(true);
            setVisited(['home']);
            setPageRevisions({});
            scrollPositions.current = {};
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
        onUserUpdated: (updated) => setUser(normalizeSelfUser(updated)),
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
        openWorld: (target, instanceLocation) => {
          setSelectedUser(null);
          setSelectedGroup(null);
          setSelectedEvent(null);
          setSelectedWorldLocation(instanceLocation);
          setSelectedWorld(target);
        },
        openGroup: (target) => {
          setSelectedUser(null);
          setSelectedWorld(null);
          setSelectedEvent(null);
          setSelectedGroup(target);
        },
        openCalendarEvent: (target) => {
          setSelectedUser(null);
          setSelectedWorld(null);
          setSelectedGroup(null);
          setSelectedEvent(target);
        },
        onRefresh: refresh,
        logout,
        activity,
      }}
    >
      <GlassRefraction />
      <div className="app-shell">
        <aside className="sidebar">
          <button
            className="brand"
            onClick={() => navigate('home')}
            aria-label={t('VRCNext Mobile, главная')}
          >
            <BrandLogo />
            <div>
              VRCNext <span>Mobile</span>
            </div>
          </button>
          <span className="nav-caption">{t('ВАШЕ ПРОСТРАНСТВО')}</span>
          <nav className="side-nav" aria-label={t('Основная навигация')}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                aria-label={t(tab.label)}
                className={navScreen === tab.id ? 'active' : ''}
                onClick={() => navigate(tab.id)}
                aria-current={navScreen === tab.id ? 'page' : undefined}
              >
                <tab.icon size={21} />
                <span>{t(tab.label)}</span>
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
                  ? t('Демонстрация')
                  : !online
                    ? t('Нет подключения')
                    : pipeline === 'connected'
                      ? t('VRChat подключён')
                      : t('Обновление по запросу')}
              </span>
            </div>
            <button className="account-button" onClick={() => navigate('profile')}>
              <AvatarImage
                src={imageOf(user)}
                name={user.displayName}
                size={38}
                user={user}
                fallbackSrc={user.currentAvatarThumbnailImageUrl || user.currentAvatarImageUrl}
              />
              <div>
                <strong>{user.displayName}</strong>
                <span>{demo ? t('Деморежим') : t(presenceLabel(user))}</span>
              </div>
              <Settings size={17} />
            </button>
          </div>
        </aside>
        <div className="workspace">
          <HolidayDecor />
          <header className="topbar">
            <div className="topbar-left">
              {!topLevel ? (
                <button
                  className="icon-button"
                  aria-label={t('Назад')}
                  onClick={() => navigate(previous === screen ? 'more' : previous)}
                >
                  <ArrowLeft size={21} />
                </button>
              ) : (
                <BrandLogo className="mobile-mark" alt="VRCNext Mobile" />
              )}
              <div className="breadcrumb">
                VRCNext <span>/</span>{' '}
                <strong>
                  {t(tabs.find((tab) => tab.id === screen)?.label || '') ||
                    {
                      profile: t('Профиль'),
                      calendar: t('Календарь'),
                      inventory: t('Медиатека'),
                      messenger: t('Сообщения'),
                      timeline: t('Активность'),
                      feed: t('Лента'),
                      locations: 'Friends Locations',
                      favorites: t('Избранное'),
                      social: 'Social',
                      charts: t('Диаграммы'),
                      settings: t('Настройки'),
                      about: t('О проекте'),
                      moderation: t('Модерация'),
                    }[screen as string as 'profile']}
                </strong>
              </div>
            </div>
            <div className="row">
              {demo && <Badge className="demo-badge">DEMO</Badge>}
              <button
                className="icon-button"
                aria-label={t('Обновить данные')}
                onClick={() => {
                  refresh();
                  notify(t('Обновляем данные'));
                }}
              >
                <RefreshCw size={18} />
              </button>
              <button
                className="avatar-button"
                aria-label={t('Мой профиль')}
                onClick={() => navigate('profile')}
              >
                <AvatarImage src={imageOf(user)} name={user.displayName} size={34} />
              </button>
            </div>
          </header>
          {!online && (
            <div className="offline-banner" role="status">
              <WifiOff size={16} />
              {t('Нет подключения к интернету. Данные могут быть устаревшими.')}
            </div>
          )}
          {demo && showDemo && (
            <div className="demo-banner">
              <span>{t('Вы в деморежиме. Данные примеров не связаны с VRChat.')}</span>
              <button
                onClick={() => setShowDemo(false)}
                className="icon-button"
                aria-label={t('Скрыть подсказку деморежима')}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {calendarSync.reminders[0] && (
            <div className="calendar-reminder-banner" role="status">
              <button
                onClick={() => {
                  setSelectedUser(null);
                  setSelectedWorld(null);
                  setSelectedGroup(null);
                  setSelectedEvent(calendarSync.reminders[0].event);
                  calendarSync.dismissReminder(calendarSync.reminders[0].id);
                }}
              >
                <CalendarDays size={17} />
                <span>
                  {t('Скоро:')} {calendarSync.reminders[0].event.title || t('Событие группы')}
                </span>
              </button>
              <button
                className="icon-button"
                aria-label={t('Скрыть напоминание события')}
                onClick={() => calendarSync.dismissReminder(calendarSync.reminders[0].id)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {pending > 0 && (
            <div className="progress-line" aria-label={t('Выполняется действие')} role="status" />
          )}
          <PullRefresh mainRef={contentRef} onRefresh={refresh}>
            {visited.map((page) => (
              <section
                key={page}
                hidden={screen !== page}
                className="retained-screen"
                data-screen={page}
              >
                <PageScope
                  active={screen === page}
                  refresh={mutationRevision + (pageRevisions[page] || 0)}
                >
                  <Suspense fallback={<Loading />}>
                    {page === 'home' ? (
                      <HomePage navigate={navigate} />
                    ) : page === 'friends' ? (
                      <FriendsPage />
                    ) : page === 'explore' ? (
                      <Explore />
                    ) : page === 'notifications' ? (
                      <NotificationsPage />
                    ) : page === 'more' ? (
                      <MorePage navigate={navigate} />
                    ) : page === 'profile' ? (
                      <ProfilePage onUpdated={setUser} />
                    ) : page === 'calendar' ? (
                      <CalendarPage />
                    ) : page === 'inventory' ? (
                      <InventoryPage />
                    ) : page === 'messenger' ? (
                      <MessengerPage />
                    ) : page === 'charts' ? (
                      <ChartsPage />
                    ) : page === 'social' ? (
                      <Social />
                    ) : page === 'favorites' ? (
                      <FavoritesPage />
                    ) : page === 'locations' ? (
                      <Locations />
                    ) : page === 'feed' ? (
                      <Feed />
                    ) : page === 'timeline' ? (
                      <TimelinePage />
                    ) : page === 'moderation' ? (
                      <ModerationPage />
                    ) : page === 'about' ? (
                      <AboutPage />
                    ) : (
                      <SettingsPage />
                    )}
                  </Suspense>
                </PageScope>
              </section>
            ))}
            <footer className="page-footer">
              VRCNext Mobile <span>✦</span> {t('Рядом с вашими мирами')}
            </footer>
          </PullRefresh>
          <nav className="bottom-nav" aria-label={t('Основная навигация')}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                aria-label={t(tab.label)}
                className={navScreen === tab.id ? 'active' : ''}
                onClick={() => navigate(tab.id)}
                aria-current={navScreen === tab.id ? 'page' : undefined}
              >
                <span>
                  <tab.icon size={21} />
                </span>
                <small>{t(tab.label)}</small>
              </button>
            ))}
          </nav>
        </div>
      </div>
      {selectedEvent && (
        <CalendarEventDetail initial={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
      {selectedGroup && (
        <GroupDetail
          initial={selectedGroup}
          onClose={() => setSelectedGroup(null)}
          onChanged={refresh}
        />
      )}
      {selectedUser && <UserDetails target={selectedUser} onClose={() => setSelectedUser(null)} />}
      {selectedWorld && (
        <WorldDetails
          target={selectedWorld}
          initialLocation={selectedWorldLocation}
          onClose={() => setSelectedWorld(null)}
        />
      )}
      {toast && (
        <div role="status" className="toast">
          <Check size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label={t('Закрыть уведомление')}
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
  const { locale } = useI18n();
  const ctx = useApp();
  const worldSnapshot = useRef<World[]>([]);
  const data = {
    ...ctx.friends,
    data: ctx.friends.data.filter((f) => ['game', 'website'].includes(presenceMode(f))),
  };
  const online = data.data.filter((f) => presenceMode(f) === 'game');
  const friendWorldIds = [
    ...new Set(
      online.flatMap((f) => {
        const location = disclosedUserLocation(f);
        return location ? [location.split(':')[0]] : [];
      }),
    ),
  ].sort();
  const worlds = useLoad(async () => {
    if (ctx.demo) return demoWorlds;
    const result = await Promise.allSettled(friendWorldIds.slice(0, 8).map((id) => api.world(id)));
    const incoming = result.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (result.length && !incoming.length)
      throw new Error(t('Не удалось загрузить миры друзей. Повторите обновление.'));
    worldSnapshot.current = reconcilePage(worldSnapshot.current, incoming);
    return worldSnapshot.current;
  }, [friendWorldIds.join(','), ctx.demo, ctx.refresh]);
  return (
    <>
      <PageHeader
        eyebrow={t('ВАШЕ ПРОСТРАНСТВО')}
        title={t('Привет, {value0} ✦', { value0: ctx.user.displayName })}
        subtitle={t('Следующая встреча ближе, чем кажется.')}
        actions={
          <span className="date-label">
            {new Date().toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' })}
          </span>
        }
      />
      <section className="hero">
        <div className="hero-shade" />
        <HolidayDecor area="hero" />
        <div className="hero-content">
          <span className="hero-kicker">
            <span className="live-dot" />
            {t('СНОВА ВМЕСТЕ')}
          </span>
          <h2>
            {t('Хороший мир —')}
            <br />
            {t('там, где ваши друзья.')}
          </h2>
          <p>
            {ctx.demo
              ? t('Luna и ещё 3 друга уже исследуют миры.')
              : online.length
                ? t('{value0} друзей в VRChat. Загляните к ним.', { value0: online.length })
                : t('Найдите новое место для следующей встречи.')}
          </p>
          <button className="button light" onClick={() => navigate('friends')}>
            {t('Найти свою компанию')}
            <ArrowUpRight size={18} />
          </button>
        </div>
        <span className="hero-world">
          <MapPin size={13} />
          {t('Ваш портал в VRChat')}
          {ctx.demo ? t(' · Демо') : ''}
        </span>
      </section>
      <div className="dashboard-stats">
        <button onClick={() => navigate('friends')}>
          <span className="stat-icon green">
            <Users size={20} />
          </span>
          <div>
            <strong>{data.loading ? '—' : online.length}</strong>
            <span>{t('друзей в VRChat')}</span>
          </div>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => navigate('explore')}>
          <span className="stat-icon purple">
            <Globe2 size={20} />
          </span>
          <div>
            <strong>{worlds.loading ? '—' : worlds.data?.length || 0}</strong>
            <span>{t('миров с друзьями')}</span>
          </div>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => navigate('calendar')}>
          <span className="stat-icon peach">
            <CalendarDays size={20} />
          </span>
          <div>
            <strong>{t('Календарь')}</strong>
            <span>{t('следующая встреча')}</span>
          </div>
          <ChevronRight size={16} />
        </button>
      </div>
      <Section
        title={t('Друзья рядом')}
        action={<MoreButton onClick={() => navigate('friends')} />}
      >
        {data.loading ? (
          <Loading />
        ) : data.error ? (
          <ErrorState error={data.error} retry={data.reload} />
        ) : data.data?.length ? (
          <div className="friends-strip">
            {data.data.slice(0, 7).map((f) => (
              <button className="friend-bubble" key={f.id} onClick={() => ctx.openUser(f)}>
                <AvatarImage
                  src={imageOf(f)}
                  name={f.displayName}
                  size={58}
                  user={f}
                  fallbackSrc={f.currentAvatarThumbnailImageUrl || f.currentAvatarImageUrl}
                />
                <strong>{f.displayName}</strong>
                <span>{t(presenceLabel(f))}</span>
              </button>
            ))}
          </div>
        ) : (
          <Empty title={t('Пока никого нет')} text={t('Найдите друзей на вкладке «Друзья».')} />
        )}
      </Section>
      <Section
        title={t('Где сейчас друзья')}
        action={
          <MoreButton onClick={() => navigate('locations')}>
            {t('Миры')}
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
              const users = online.filter((f) => disclosedUserLocation(f)?.startsWith(`${w.id}:`));
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
                      {(w.occupants || 0).toLocaleString(dateLocale())}
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
                          ? t('{value0} {value1} здесь', {
                              value0: users.length,
                              value1:
                                users.length === 1
                                  ? t('друг')
                                  : locale === 'ru'
                                    ? 'друга'
                                    : t('друзей'),
                            })
                          : t('Открыть мир')}
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
            title={t('Здесь появятся миры друзей')}
            text={t('Миры отображаются, когда их местоположение доступно.')}
          />
        )}
      </Section>
      <section className="discover-banner">
        <Compass size={30} />
        <div>
          <h3>{t('За пределами привычного')}</h3>
          <p>{t('Найдите мир, в котором ещё не были.')}</p>
        </div>
        <button
          className="icon-button"
          aria-label={t('Исследовать миры')}
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
    () =>
      ctx.demo
        ? Promise.resolve(ctx.friends.data)
        : search && debounced
          ? api.searchUsers(debounced, page * 50)
          : Promise.resolve([]),
    [ctx.refresh, search, debounced, page],
  );
  const favorites = useFriendFavorites(
    ctx.user.id,
    ctx.demo,
    ctx.refresh,
    ctx.pageActive !== false,
  );
  const favoriteIds = new Set(favorites.records.map((record) => record.favoriteId));
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
        (filter === 'online' && presenceMode(f) === 'game') ||
        (filter === 'web' && presenceMode(f) === 'website') ||
        (filter === 'offline' && ['offline', 'unknown'].includes(presenceMode(f)))),
  );
  return (
    <>
      <PageHeader
        eyebrow={t('ВАШ КРУГ')}
        title={search ? t('Найти людей') : t('Друзья')}
        subtitle={t('Хорошая компания всегда рядом')}
        actions={
          <button
            className="button secondary compact"
            onClick={() => {
              setSearch(!search);
              setQuery('');
            }}
          >
            {search ? <Users size={17} /> : <Plus size={17} />}
            {search ? t('Мои друзья') : t('Найти людей')}
          </button>
        }
      />
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={search ? t('Имя пользователя VRChat') : t('Поиск по друзьям')}
      />
      {!search && (
        <Segmented
          value={filter}
          onChange={setFilter}
          items={[
            { id: 'all', label: t('Все') },
            { id: 'online', label: t('В VRChat') },
            { id: 'web', label: t('На сайте') },
            { id: 'offline', label: t('Не в сети') },
          ]}
        />
      )}
      <div className="section-heading">
        <h2>{search ? t('Результаты поиска') : t('Ваша компания')}</h2>
        <span className="count-label">{items.length}</span>
      </div>
      {friends.loading && !items.length ? (
        <Loading />
      ) : friends.error ? (
        <ErrorState error={friends.error} retry={friends.reload} />
      ) : items.length ? (
        <div className="friend-grid">
          {items.map((f) => (
            <button
              className={`friend-card card ${favoriteIds.has(f.id) ? 'is-favorite' : ''}`}
              key={f.id}
              onClick={() => ctx.openUser(f)}
            >
              <AvatarImage
                name={f.displayName}
                src={imageOf(f)}
                size={54}
                user={f}
                fallbackSrc={f.currentAvatarThumbnailImageUrl || f.currentAvatarImageUrl}
              />
              <div className="friend-card-text">
                <div className="friend-card-title">
                  <h3>{f.displayName}</h3>
                  {favoriteIds.has(f.id) && (
                    <span className="friend-favorite-badge" aria-label={t('Избранный друг')}>
                      <Star size={13} fill="currentColor" />
                    </span>
                  )}
                </div>
                <p>{f.statusDescription || t(statusName(f.status))}</p>
                <span className="friend-location">
                  <PresenceIndicator user={f} />
                  {t(presenceLabel(f))}
                </span>
              </div>
              <span className="friend-rank">{rankOf(f.tags)}</span>
              <ChevronRight size={17} />
            </button>
          ))}
        </div>
      ) : (
        <Empty
          title={search && !query ? t('Кого ищем?') : t('Никого не найдено')}
          text={
            search
              ? t('Введите имя пользователя, чтобы найти человека в VRChat.')
              : t('Попробуйте другой фильтр или поисковый запрос.')
          }
        />
      )}{' '}
      {search && friends.data?.length === 50 && (
        <button
          className="button secondary load-more"
          disabled={friends.loading}
          onClick={() => setPage((p) => p + 1)}
        >
          {t('Загрузить ещё')}
        </button>
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
    {
      id: 'charts',
      title: t('Диаграммы'),
      text: t('Время, встречи и известные связи'),
      icon: Activity,
      color: 'purple',
    },
    {
      id: 'feed',
      title: t('Лента'),
      text: t('История наблюдаемых событий'),
      icon: Activity,
      color: 'purple',
    },
    {
      id: 'locations',
      title: 'Friends Locations',
      text: t('Друзья по мирам и инстансам'),
      icon: MapPin,
      color: 'green',
    },
    {
      id: 'favorites',
      title: t('Избранное'),
      text: t('Друзья, миры и аватары'),
      icon: Star,
      color: 'peach',
    },
    {
      id: 'social',
      title: 'Social',
      text: t('Друзья, журнал и модерация'),
      icon: Users,
      color: 'blue',
    },
    {
      id: 'profile',
      title: t('Мой профиль'),
      text: t('Статус, описание и ссылки'),
      icon: UserRound,
      color: 'purple',
    },
    {
      id: 'messenger',
      title: t('Сообщения'),
      text: t('Короткое сообщение другу'),
      icon: MessageSquare,
      color: 'green',
    },
    {
      id: 'calendar',
      title: t('Календарь'),
      text: t('События и встречи'),
      icon: CalendarDays,
      color: 'peach',
    },
    {
      id: 'inventory',
      title: t('Медиатека'),
      text: t('Фото, emoji и инвентарь'),
      icon: Images,
      color: 'blue',
    },
    {
      id: 'timeline',
      title: t('Действия'),
      text: t('Действия текущей сессии'),
      icon: Activity,
      color: 'purple',
    },
    {
      id: 'moderation',
      title: t('Блокировки'),
      text: t('Списки block и mute'),
      icon: ShieldCheck,
      color: 'peach',
    },
    {
      id: 'about',
      title: t('О проекте'),
      text: t('О приложении, авторе и поддержке'),
      icon: Info,
      color: 'purple',
    },
    {
      id: 'settings',
      title: t('Настройки'),
      text: t('Внешний вид и приложение'),
      icon: Settings,
      color: 'blue',
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow={t('ВСЁ ПОД РУКОЙ')}
        title={t('Ваш VRCNext')}
        subtitle={t('Аккаунт, события и ваши коллекции')}
      />
      <button className="card more-profile" onClick={() => navigate('profile')}>
        <AvatarImage
          name={user.displayName}
          src={imageOf(user)}
          size={60}
          user={user}
          fallbackSrc={user.currentAvatarThumbnailImageUrl || user.currentAvatarImageUrl}
        />
        <div>
          <h2>{user.displayName}</h2>
          <p className="muted">{demo ? t('Демонстрационный аккаунт') : t(presenceLabel(user))}</p>
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
