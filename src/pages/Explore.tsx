import { uiMessage } from '../i18n';
import { t, useI18n, dateLocale } from '../i18n';
import SecureImage from '../components/SecureImage';
import { FullscreenImageViewer } from '../components/FullscreenImageViewer';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Compass,
  Globe2,
  Heart,
  Image,
  Layers3,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  Sparkles,
  Users,
} from 'lucide-react';
import { api } from '../api';
import type { Avatar, Group, World, FavoriteType, GroupPost, VrcFile } from '../api';
import { demoAvatars, demoGroups, demoWorlds } from '../demo';
import { PageScope, useApp, useLoad } from '../state';
import { usePaged } from '../hooks/usePaged';
import {
  clearFavoriteEntityCache,
  loadFavoriteGroups,
  loadFavoriteWorlds,
  loadFavoriteAvatars,
} from '../api/favorites';
import { FavoriteCategoryPicker, demoFavoriteGroups } from './Favorites';
import { InstanceFriends } from '../components/WorldInstances';
import { disclosedInstanceLocation } from '../data/world-instances';
import { groupMembership } from '../api/groups';
import { friendsInInstance, instanceCount } from '../data/instance-location';
import {
  AvatarImage,
  Badge,
  Empty,
  ErrorState,
  imageOf,
  Loading,
  Modal,
  PageHeader,
  SearchField,
  Segmented,
} from '../components/ui';
import './Explore.css';

type ExploreTab = 'worlds' | 'groups' | 'avatars';
type RecordData = Record<string, unknown>;
function record(value: unknown): RecordData {
  return value && typeof value === 'object' ? (value as RecordData) : {};
}
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function numeric(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function shortNumber(n: number) {
  return new Intl.NumberFormat(dateLocale(), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}
function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), 500);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

export function PlatformBadges({ packages }: { packages: unknown }) {
  useI18n();
  const platforms = list(packages).map((item) => text(record(item).platform));
  return (
    <span className="platform-badges">
      {platforms.includes('android') && (
        <Badge className="quest">
          <Smartphone size={12} />
          Android
        </Badge>
      )}
      {platforms.includes('standalonewindows') && (
        <Badge>
          <Monitor size={12} />
          PC
        </Badge>
      )}
    </span>
  );
}

function MoreResults({
  hasMore,
  loading,
  onClick,
}: {
  hasMore: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  useI18n();
  if (!hasMore) return null;
  return (
    <div className="explore-more">
      <button className="button secondary" onClick={onClick} disabled={loading}>
        {loading ? <RefreshCw size={16} className="spin" /> : <Plus size={16} />}{' '}
        {loading ? t('Загрузка…') : t('Загрузить ещё')}
      </button>
    </div>
  );
}

export default function Explore({ initialTab = 'worlds' }: { initialTab?: ExploreTab }) {
  useI18n();
  const ctx = useApp();
  const [tab, setTab] = useState<ExploreTab>(initialTab);
  const [visited, setVisited] = useState<ExploreTab[]>([initialTab]);
  const selectTab = (next: ExploreTab) => {
    setVisited((current) => (current.includes(next) ? current : [...current, next]));
    setTab(next);
  };
  useEffect(() => selectTab(initialTab), [initialTab]);
  return (
    <div className="explore-page">
      <PageHeader
        eyebrow={t('ОТКРЫВАЙТЕ НОВОЕ')}
        title={t('Исследовать')}
        subtitle={t('Следующий любимый мир уже где-то рядом.')}
      />
      <div className="explore-main-tabs" role="group" aria-label={t('Разделы поиска')}>
        {(
          [
            { id: 'worlds', label: t('Миры'), Icon: Globe2 },
            { id: 'groups', label: t('Группы'), Icon: Users },
            { id: 'avatars', label: t('Аватары'), Icon: Sparkles },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            aria-pressed={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => selectTab(id)}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </div>
      {visited.map((page) => (
        <div key={page} hidden={tab !== page} data-explore-tab={page}>
          <PageScope active={tab === page} refresh={ctx.refresh}>
            {page === 'worlds' ? <Worlds /> : page === 'groups' ? <Groups /> : <Avatars />}
          </PageScope>
        </div>
      ))}
    </div>
  );
}

function Worlds() {
  useI18n();
  const { demo, user, openWorld, refresh } = useApp();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'popular' | 'active' | 'mine' | 'favorites'>('popular');
  const [collections, setCollections] = useState(false);
  const [category, setCategory] = useState('');
  const categories = useLoad(
    () =>
      mode !== 'favorites'
        ? Promise.resolve([])
        : demo
          ? Promise.resolve(demoFavoriteGroups('world'))
          : loadFavoriteGroups(user.id, 'world'),
    [mode, demo, user.id, refresh],
  );
  const search = useDebounced(query);
  const page = usePaged<World>(
    async (offset) => {
      if (demo)
        return offset
          ? []
          : demoWorlds.filter(
              (w, i) =>
                w.name.toLowerCase().includes(search.toLowerCase()) &&
                (mode !== 'favorites' ||
                  !category ||
                  demoFavoriteGroups('world')[i % 2].name === category),
            );
      if (mode === 'favorites') {
        const all = await loadFavoriteWorlds(user.id);
        return all
          .filter(
            (w) =>
              (!category || w.favoriteGroupNames.includes(category)) &&
              `${w.name} ${w.authorName || ''} ${w.id}`
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
          )
          .slice(offset, offset + 50);
      }
      if (/^wrld_[0-9a-f-]{36}$/i.test(search)) return offset ? [] : [await api.world(search)];
      return api.worlds(search, offset, mode);
    },
    [demo, user.id, search, mode, category],
    50,
    refresh,
  );
  return (
    <>
      <div className="toolbar">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t('Название мира или wrld_…')}
        />
        <button
          className="icon-button"
          title={t('Обновить миры')}
          aria-label={t('Обновить миры')}
          onClick={() => {
            clearFavoriteEntityCache();
            categories.reload();
            page.reload();
          }}
          disabled={page.loading || page.refreshing || page.moreLoading}
          aria-busy={page.refreshing}
        >
          <RefreshCw size={18} className={page.refreshing ? 'spin' : undefined} />
        </button>
      </div>
      <div className="explore-filters">
        <Segmented
          items={[
            { id: 'popular', label: t('Популярные') },
            { id: 'active', label: t('Сейчас играют') },
            { id: 'favorites', label: t('Избранное') },
            { id: 'mine', label: t('Мои миры') },
          ]}
          value={mode}
          onChange={(v) => setMode(v as typeof mode)}
        />
        {mode === 'favorites' && (
          <button className="text-button" onClick={() => setCollections(true)}>
            <Layers3 size={16} />
            {t('Коллекции')}
          </button>
        )}
      </div>
      {mode === 'favorites' && (
        <>
          <FavoriteCategoryPicker
            groups={categories.data || []}
            value={category}
            onChange={setCategory}
          />
          {categories.error && <ErrorState error={categories.error} retry={categories.reload} />}
        </>
      )}
      {page.loading ? (
        <Loading />
      ) : (
        <>
          {page.error && <ErrorState error={page.error} retry={page.reload} />}
          {!page.items.length && !page.error && (
            <Empty
              title={
                search
                  ? t('Миры не найдены')
                  : mode === 'mine'
                    ? t('Ваши миры появятся здесь')
                    : t('Здесь пока пусто')
              }
              text={
                search
                  ? t('Попробуйте другое название.')
                  : t('Сохраняйте понравившиеся миры, чтобы вернуться к ним позже.')
              }
              icon={<Globe2 size={32} />}
            />
          )}
          <div className="grid explore-world-grid">
            {page.items.map((world) => (
              <button
                className="media-card world-card"
                key={world.id}
                onClick={() => openWorld(world)}
              >
                <div className="media-cover">
                  <SecureImage src={imageOf(world)} alt="" loading="lazy" />
                  <div className="world-occupants">
                    <Users size={13} />
                    {shortNumber(numeric(world.occupants))}
                  </div>
                  <div className="cover-cta">
                    <ArrowRight size={18} />
                  </div>
                </div>
                <div className="card-body">
                  <h3>{world.name}</h3>
                  <p className="muted">{text(world.authorName, t('Неизвестный автор'))}</p>
                  <div className="world-card-bottom">
                    <PlatformBadges packages={world.unityPackages} />
                    <span className="muted">
                      <Heart size={13} />
                      {shortNumber(numeric(world.favorites))}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {!demo && (
            <MoreResults
              hasMore={page.hasMore}
              loading={page.moreLoading || page.refreshing}
              onClick={page.loadMore}
            />
          )}
        </>
      )}
      {collections && <Collections type="world" onClose={() => setCollections(false)} />}
    </>
  );
}

function normalizeGroup(group: Group): Group {
  const raw = record(group);
  return { ...group, id: text(raw.groupId, group.id) };
}
function Groups() {
  useI18n();
  const { user, demo, refresh } = useApp();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Group>();
  const search = useDebounced(query);
  const page = usePaged<Group>(
    async (offset) => {
      if (demo)
        return offset
          ? []
          : demoGroups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()));
      if (search) return api.searchGroups(search, offset);
      return offset ? [] : (await api.groups(user.id)).map(normalizeGroup);
    },
    [demo, user.id, search],
    50,
    refresh,
  );
  return (
    <>
      <div className="toolbar">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t('Найти группу по названию')}
        />
        <button
          className="icon-button"
          aria-label={t('Обновить группы')}
          onClick={page.reload}
          disabled={page.loading || page.refreshing || page.moreLoading}
          aria-busy={page.refreshing}
        >
          <RefreshCw size={18} className={page.refreshing ? 'spin' : undefined} />
        </button>
      </div>
      <p className="explore-list-label">{search ? t('РЕЗУЛЬТАТЫ ПОИСКА') : t('ВАШИ СООБЩЕСТВА')}</p>
      {page.loading ? (
        <Loading />
      ) : (
        <>
          {page.error && <ErrorState error={page.error} retry={page.reload} />}
          {!page.items.length && !page.error && (
            <Empty
              title={search ? t('Группы не найдены') : t('Найдите свою компанию')}
              text={
                search
                  ? t('Попробуйте другое название или код группы.')
                  : t('Введите название, чтобы найти сообщество и вступить в него.')
              }
              icon={<Users size={32} />}
            />
          )}
          <div className="grid explore-group-grid">
            {page.items.map((group) => (
              <button className="card group-card" key={group.id} onClick={() => setSelected(group)}>
                <div className="group-banner">
                  {group.bannerUrl && <SecureImage src={group.bannerUrl} alt="" loading="lazy" />}
                  <AvatarImage src={group.iconUrl} name={group.name} size={60} />
                </div>
                <div className="card-body">
                  <h3>{group.name}</h3>
                  <p className="group-code muted">
                    {text(group.shortCode)}
                    {group.discriminator ? `.${group.discriminator}` : ''}
                  </p>
                  <p className="group-description">
                    {text(group.description, t('Откройте группу, чтобы узнать больше.'))}
                  </p>
                  <div className="world-card-bottom">
                    <span>
                      <Users size={14} />
                      {shortNumber(numeric(group.memberCount))}
                      {t(' участников')}
                    </span>
                    <ChevronRight size={18} />
                  </div>
                </div>
              </button>
            ))}
          </div>
          {!demo && search && (
            <MoreResults
              hasMore={page.hasMore}
              loading={page.moreLoading || page.refreshing}
              onClick={page.loadMore}
            />
          )}
        </>
      )}
      {selected && (
        <GroupDetail
          initial={selected}
          onClose={() => setSelected(undefined)}
          onChanged={page.reload}
        />
      )}
    </>
  );
}

export function GroupDetail({
  initial,
  onClose,
  onChanged,
}: {
  initial: Group;
  onClose: () => void;
  onChanged: () => void;
}) {
  useI18n();
  const ctx = useApp();
  const { user, demo, act, openWorld } = ctx;
  const [tab, setTab] = useState('about');
  const [leave, setLeave] = useState(false);
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState(false);
  const detail = useLoad(async () => (demo ? initial : api.group(initial.id)), [initial.id, demo]);
  const group = detail.data || initial;
  const raw = record(group);
  // Once loaded, the server's explicit member/null/pending state replaces initial card evidence.
  const membership = groupMembership(group);
  const joined = membership === 'member';
  const membershipPending = membership === 'requested';
  const membershipUnknown = membership === 'unknown';
  const posts = usePaged<GroupPost>(
    async (offset) =>
      tab !== 'posts'
        ? []
        : demo
          ? offset
            ? []
            : [
                {
                  id: 'post_demo',
                  title: t('Добро пожаловать, исследователь!'),
                  text: t('Впереди новые миры и встречи. Это демонстрационная публикация.'),
                  createdAt: new Date().toISOString(),
                },
              ]
          : api.groupPosts(initial.id, offset),
    [initial.id, tab, demo],
  );
  const instances = useLoad(
    async () => (tab !== 'instances' ? [] : demo ? [] : api.groupInstances(initial.id, user.id)),
    [initial.id, tab, demo],
  );
  const [gallery, setGallery] = useState('');
  const [viewingImage, setViewingImage] = useState<{ src: string; title: string } | null>(null);
  const galleryList = list(raw.galleries).map(record);
  const galleryImages = usePaged<VrcFile>(
    async (offset) =>
      tab !== 'gallery' || !gallery
        ? []
        : demo
          ? []
          : api.groupGallery(initial.id, gallery, offset),
    [initial.id, tab, gallery, demo],
  );
  useEffect(() => {
    if (galleryList.length && !gallery) setGallery(text(galleryList[0].id));
  }, [group]);
  async function changeMembership(remove: boolean) {
    if (busy) return;
    setBusy(true);
    await act(
      async () => {
        const result = await (remove ? api.leaveGroup(initial.id) : api.joinGroup(initial.id));
        // A confirmed mutation invalidates the initial card immediately; never offer a second join/leave from old data.
        detail.setData({
          ...group,
          myMember: remove ? null : undefined,
          membershipStatus: remove ? 'inactive' : text(record(result).membershipStatus),
          isMember: remove ? false : undefined,
          mutualGroup: false,
        });
        detail.reload();
        onChanged();
        setLeave(false);
        return result;
      },
      remove ? uiMessage('Вы вышли из группы') : uiMessage('Запрос на вступление отправлен'),
    );
    setBusy(false);
  }
  return (
    <Modal title={group.name} onClose={onClose} wide>
      {group.bannerUrl && (
        <SecureImage className="detail-cover group-detail-cover" src={group.bannerUrl} alt="" />
      )}
      <div className="group-detail-title">
        <AvatarImage src={group.iconUrl} name={group.name} size={64} />
        <div>
          <h3>{group.name}</h3>
          <p className="muted">
            {shortNumber(numeric(group.memberCount))}
            {t(' участников · ')}
            {text(group.shortCode)}
            {group.discriminator ? `.${group.discriminator}` : ''}
          </p>
        </div>
      </div>
      {detail.error && <ErrorState error={detail.error} retry={detail.reload} />}
      <div className="detail-actions">
        <button
          className={`button ${joined ? 'secondary' : ''}`}
          disabled={
            busy ||
            detail.loading ||
            membershipUnknown ||
            membershipPending ||
            membership === 'blocked'
          }
          onClick={() => (joined ? setLeave(true) : void changeMembership(false))}
        >
          {joined ? <Check size={17} /> : <Plus size={17} />}
          {joined
            ? t('Вы участник · выйти')
            : membershipUnknown
              ? detail.loading
                ? t('Проверяем участие…')
                : t('Участие не подтверждено')
              : membershipPending
                ? t('Запрос отправлен')
                : membership === 'blocked'
                  ? t('Вступление недоступно')
                  : membership === 'invited'
                    ? t('Вы приглашены · вступить')
                    : t('Вступить в группу')}
        </button>
      </div>
      {leave && (
        <div className="confirm-inline">
          <p>{t('Выйти из группы «{name}»?', { name: group.name })}</p>
          <div className="row">
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void changeMembership(true)}
            >
              {t('Выйти из группы')}
            </button>
            <button className="button secondary" onClick={() => setLeave(false)}>
              {t('Отмена')}
            </button>
          </div>
        </div>
      )}
      <Segmented
        items={[
          { id: 'about', label: t('О группе') },
          { id: 'posts', label: t('Публикации') },
          { id: 'instances', label: t('Инстансы') },
          { id: 'gallery', label: t('Галерея') },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="group-tab-content">
        {tab === 'about' && (
          <>
            <p className="preserve-text">{text(group.description, t('Описание не указано.'))}</p>
            {text(raw.rules) && (
              <section>
                <h3>{t('Правила')}</h3>
                <p className="preserve-text muted">{text(raw.rules)}</p>
              </section>
            )}
            <div className="chips">
              {list(raw.languages).map((language) => (
                <Badge key={text(language)}>{text(language)}</Badge>
              ))}
            </div>
          </>
        )}
        {tab === 'posts' && (
          <>
            <div className="section-heading">
              <h3>{t('Последние публикации')}</h3>
              <button className="text-button" onClick={() => setPosting(!posting)}>
                <Plus size={16} />
                {t('Написать')}
              </button>
            </div>
            {posting && (
              <GroupPostComposer
                groupId={group.id}
                onComplete={() => {
                  setPosting(false);
                  posts.reload();
                }}
              />
            )}
            {posts.loading ? (
              <Loading />
            ) : posts.error ? (
              <ErrorState error={posts.error} retry={posts.reload} />
            ) : !posts.items.length ? (
              <Empty title={t('Публикаций пока нет')} />
            ) : (
              <div className="explore-post-list">
                {posts.items.map((value, index) => {
                  const post = record(value);
                  return (
                    <article className="card group-post" key={text(post.id, String(index))}>
                      <div className="muted small">
                        {text(post.createdAt)
                          ? new Date(text(post.createdAt)).toLocaleDateString(dateLocale())
                          : t('Публикация')}
                      </div>
                      <h3>{text(post.title)}</h3>
                      <p className="preserve-text">{text(post.text)}</p>
                      {text(post.imageUrl) && (
                        <SecureImage
                          className="post-image"
                          src={text(post.imageUrl)}
                          alt={t('Вложение публикации')}
                          loading="lazy"
                        />
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            {!demo && (
              <MoreResults
                hasMore={posts.hasMore}
                loading={posts.moreLoading}
                onClick={posts.loadMore}
              />
            )}
          </>
        )}
        {tab === 'instances' && (
          <>
            {instances.loading ? (
              <Loading />
            ) : instances.error ? (
              <ErrorState error={instances.error} retry={instances.reload} />
            ) : !instances.data?.length ? (
              <Empty
                title={t('Активных инстансов нет')}
                text={t('Здесь появятся доступные вам инстансы группы.')}
                icon={<Globe2 size={28} />}
              />
            ) : (
              <div className="explore-post-list">
                {instances.data.map((value, index) => {
                  const instance = record(value),
                    world = record(instance.world);
                  const worldId = text(instance.worldId, text(world.id));
                  const location = disclosedInstanceLocation(value);
                  const presentFriends = location
                    ? friendsInInstance(location, ctx.friends.data)
                    : [];
                  const count =
                    instanceCount(instance.n_users) ?? instanceCount(instance.userCount);
                  return (
                    <article
                      className="group-instance card"
                      key={text(instance.id, String(index))}
                      data-location={location}
                    >
                      <button
                        className="list-row group-instance-world"
                        disabled={!worldId}
                        onClick={() => {
                          if (worldId) {
                            onClose();
                            openWorld(worldId);
                          }
                        }}
                      >
                        <Globe2 size={22} />
                        <div>
                          <strong>
                            {text(world.name, text(instance.name, worldId || t('Инстанс группы')))}
                          </strong>
                          <p className="muted">
                            {count !== undefined
                              ? t('{value0} игроков', { value0: count })
                              : t('Число игроков не передано')}{' '}
                            · {text(instance.region, t('Регион не указан'))}
                          </p>
                        </div>
                        <ChevronRight size={18} />
                      </button>
                      <p className="group-instance-friend-count muted small">
                        <Users size={13} />
                        {t('Друзья · ')}
                        {presentFriends.length}
                      </p>
                      <InstanceFriends
                        friends={presentFriends}
                        onOpenUser={(friend) => {
                          onClose();
                          ctx.openUser(friend);
                        }}
                      />
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
        {tab === 'gallery' && (
          <>
            {galleryList.length ? (
              <>
                <label className="field">
                  {t('Альбом')}
                  <select value={gallery} onChange={(e) => setGallery(e.target.value)}>
                    {galleryList.map((item) => (
                      <option key={text(item.id)} value={text(item.id)}>
                        {text(item.name, t('Галерея'))}
                      </option>
                    ))}
                  </select>
                </label>
                {galleryImages.loading ? (
                  <Loading />
                ) : galleryImages.error ? (
                  <ErrorState error={galleryImages.error} retry={galleryImages.reload} />
                ) : galleryImages.items.length ? (
                  <div className="gallery-grid">
                    {galleryImages.items.map((value, index) => {
                      const image = record(value);
                      return (
                        <button
                          className="gallery-image-button"
                          key={text(image.id, String(index))}
                          aria-label={t('Открыть изображение группы {value0}', {
                            value0: index + 1,
                          })}
                          onClick={() =>
                            setViewingImage({
                              src: text(image.imageUrl, text(image.url)),
                              title: text(image.description, t('Изображение группы')),
                            })
                          }
                        >
                          <SecureImage
                            src={text(image.imageUrl, text(image.url))}
                            alt={text(image.description, t('Изображение группы'))}
                            loading="lazy"
                          />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <Empty title={t('В альбоме пока нет изображений')} />
                )}
                {!demo && (
                  <MoreResults
                    hasMore={galleryImages.hasMore}
                    loading={galleryImages.moreLoading}
                    onClick={galleryImages.loadMore}
                  />
                )}
              </>
            ) : (
              <Empty
                title={t('Галереи пока нет')}
                text={t('У этой группы нет доступных альбомов.')}
                icon={<Image size={28} />}
              />
            )}
          </>
        )}
      </div>
      {viewingImage && (
        <FullscreenImageViewer
          src={viewingImage.src}
          originalUrl={viewingImage.src}
          title={viewingImage.title}
          onClose={() => setViewingImage(null)}
        />
      )}
    </Modal>
  );
}

function GroupPostComposer({ groupId, onComplete }: { groupId: string; onComplete: () => void }) {
  useI18n();
  const { act } = useApp();
  const [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [visibility, setVisibility] = useState('group'),
    [sendNotification, setSendNotification] = useState(false),
    [busy, setBusy] = useState(false);
  const [attachment, setAttachment] = useState<File>();
  return (
    <form
      className="card form-stack group-post-composer"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !title.trim() || !body.trim()) return;
        setBusy(true);
        await act(async () => {
          const image = attachment ? await api.uploadImage(attachment, 'gallery') : undefined;
          const result = await api.createGroupPost(groupId, {
            title: title.trim(),
            text: body.trim(),
            visibility,
            sendNotification,
            ...(image?.id ? { imageId: image.id } : {}),
          });
          onComplete();
          return result;
        }, uiMessage('Публикация создана'));
        setBusy(false);
      }}
    >
      <p className="muted small">{t('Для публикации нужны права, выданные владельцем группы.')}</p>
      <label className="field">
        {t('Заголовок')}
        <input required maxLength={64} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        {t('Текст')}
        <textarea
          required
          maxLength={2000}
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <label className="field">
        {t('Изображение (необязательно)')}
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={(e) => setAttachment(e.target.files?.[0])}
        />
      </label>
      <label className="field">
        {t('Видимость')}
        <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
          <option value="group">{t('Участникам группы')}</option>
          <option value="public">{t('Всем')}</option>
        </select>
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={sendNotification}
          onChange={(e) => setSendNotification(e.target.checked)}
        />
        {t('Отправить уведомление участникам')}
      </label>
      <button className="button" disabled={busy || !title.trim() || !body.trim()}>
        <Send size={16} />
        {busy ? t('Публикуем…') : t('Опубликовать')}
      </button>
    </form>
  );
}

function Avatars() {
  useI18n();
  const { user, demo, refresh, notify } = useApp();
  const [mode, setMode] = useState<'mine' | 'favorites' | 'public'>('mine');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Avatar>();
  const [collections, setCollections] = useState(false);
  const [lookup, setLookup] = useState(false);
  const [category, setCategory] = useState('');
  const categories = useLoad(
    () =>
      mode !== 'favorites'
        ? Promise.resolve([])
        : demo
          ? Promise.resolve(demoFavoriteGroups('avatar'))
          : loadFavoriteGroups(user.id, 'avatar'),
    [mode, demo, user.id, refresh],
  );
  const search = useDebounced(query).toLowerCase();
  const page = usePaged<Avatar>(
    async (offset) => {
      if (mode === 'favorites') {
        const all = demo
          ? demoAvatars.map((avatar, index) => ({
              ...avatar,
              favoriteGroupNames: [demoFavoriteGroups('avatar')[index % 2].name],
            }))
          : await loadFavoriteAvatars(
              user.id,
              false,
              categories.data?.length ? categories.data : undefined,
              category,
            );
        return all
          .filter(
            (avatar) =>
              (!category || avatar.favoriteGroupNames.includes(category)) &&
              `${avatar.name} ${avatar.authorName || ''} ${avatar.id}`
                .toLocaleLowerCase()
                .includes(search),
          )
          .slice(offset, offset + 50);
      }
      if (demo) return offset ? [] : demoAvatars;
      if (mode === 'public')
        return search ? api.searchPublicAvatars(query.trim(), Math.floor(offset / 20)) : [];
      return api.avatars(mode, offset);
    },
    [
      demo,
      user.id,
      mode,
      mode === 'public' || mode === 'favorites' ? search : '',
      mode === 'favorites' ? category : '',
    ],
    mode === 'public' ? 20 : 50,
    refresh,
  );
  const filtered =
    mode === 'public' || mode === 'favorites'
      ? page.items
      : page.items.filter((avatar) => avatar.name.toLowerCase().includes(search));
  async function lookupById() {
    const id = query.trim();
    if (!/^avtr_[0-9a-f-]{36}$/i.test(id)) {
      notify(t('Введите полный ID аватара, начинающийся с avtr_.'));
      return;
    }
    if (demo) {
      notify(t('Поиск по ID доступен после входа на Android.'));
      return;
    }
    setLookup(true);
    try {
      setSelected(await api.avatar(id));
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setLookup(false);
    }
  }
  return (
    <>
      <div className="toolbar">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={
            mode === 'public'
              ? t('Название аватара в публичной базе')
              : mode === 'favorites'
                ? t('Поиск в избранных аватарах или avtr_…')
                : t('Поиск в загруженных аватарах или avtr_…')
          }
        />
        <button
          className="icon-button"
          aria-label={t('Обновить аватары')}
          onClick={() => {
            if (mode === 'favorites') {
              clearFavoriteEntityCache();
              categories.reload();
            }
            page.reload();
          }}
          disabled={page.loading || page.refreshing || page.moreLoading}
          aria-busy={page.refreshing}
        >
          <RefreshCw size={18} className={page.refreshing ? 'spin' : undefined} />
        </button>
      </div>
      <div className="explore-filters">
        <Segmented
          items={[
            { id: 'mine', label: t('Мои аватары') },
            { id: 'favorites', label: t('Избранные') },
            { id: 'public', label: t('Публичные') },
          ]}
          value={mode}
          onChange={(v) => setMode(v as typeof mode)}
        />
        <button className="text-button" onClick={() => setCollections(true)}>
          <Layers3 size={16} />
          {t('Коллекции')}
        </button>
      </div>
      {mode === 'favorites' && (
        <>
          <FavoriteCategoryPicker
            groups={categories.data || []}
            value={category}
            onChange={setCategory}
          />
          {categories.error && <ErrorState error={categories.error} retry={categories.reload} />}
        </>
      )}
      {mode === 'public' && (
        <p className="muted small">
          {t('Поиск в публичной базе avtrdb.com. Поисковый запрос передаётся её оператору.')}
        </p>
      )}
      {query.trim().startsWith('avtr_') && (
        <button
          className="button secondary lookup-avatar"
          disabled={lookup}
          onClick={() => void lookupById()}
        >
          <Search size={16} />
          {lookup ? t('Ищем…') : t('Открыть аватар по ID')}
        </button>
      )}
      {page.loading || (mode === 'favorites' && categories.loading) ? (
        <Loading />
      ) : (
        <>
          {page.error && <ErrorState error={page.error} retry={page.reload} />}
          {!filtered.length && !page.error && (
            <Empty
              title={
                search
                  ? t('Аватары не найдены')
                  : mode === 'public'
                    ? t('Найдите новый образ')
                    : mode === 'mine'
                      ? t('Ваш гардероб')
                      : category
                        ? t('В этой коллекции пока нет аватаров')
                        : t('Избранных аватаров пока нет')
              }
              text={
                mode === 'public'
                  ? t('Введите название, чтобы найти аватар в публичной базе.')
                  : search && mode !== 'favorites'
                    ? t(
                        'Поиск выполняется по уже загруженным карточкам. Загрузите следующую страницу или вставьте ID аватара.',
                      )
                    : mode === 'mine'
                      ? t(
                          'Здесь появятся загруженные вами аватары. Другой аватар можно открыть по его ID.',
                        )
                      : t('Добавьте аватар в коллекцию через его карточку.')
              }
              icon={<Sparkles size={32} />}
            />
          )}
          <div className="grid explore-avatar-grid">
            {filtered.map((avatar) => (
              <button
                key={avatar.id}
                className="media-card avatar-card"
                onClick={() => setSelected(avatar)}
              >
                <div className="media-cover avatar-cover">
                  <SecureImage src={imageOf(avatar)} alt="" loading="lazy" />
                  {user.currentAvatar === avatar.id && (
                    <Badge className="current-avatar">
                      <Check size={12} />
                      {t('Текущий')}
                    </Badge>
                  )}
                </div>
                <div className="card-body">
                  <h3>{avatar.name}</h3>
                  <p className="muted">{text(avatar.authorName, t('Неизвестный автор'))}</p>
                  <PlatformBadges packages={avatar.unityPackages} />
                </div>
              </button>
            ))}
          </div>
          {!demo && (
            <MoreResults
              hasMore={page.hasMore}
              loading={page.moreLoading || page.refreshing}
              onClick={page.loadMore}
            />
          )}
        </>
      )}
      {selected && <AvatarDetail initial={selected} onClose={() => setSelected(undefined)} />}
      {collections && <Collections type="avatar" onClose={() => setCollections(false)} />}
    </>
  );
}

export function AvatarDetail({ initial, onClose }: { initial: Avatar; onClose: () => void }) {
  useI18n();
  const { demo, user, act, openUser, onRefresh } = useApp();
  const detail = useLoad(async () => (demo ? initial : api.avatar(initial.id)), [initial.id, demo]);
  const avatar = detail.data || initial;
  const [confirm, setConfirm] = useState(false),
    [favorite, setFavorite] = useState(false),
    [busy, setBusy] = useState(false);
  const current = user.currentAvatar === avatar.id;
  return (
    <Modal title={avatar.name} onClose={onClose}>
      <SecureImage
        className="detail-cover avatar-detail-cover"
        src={imageOf(avatar)}
        alt={avatar.name}
      />
      {detail.error && <ErrorState error={detail.error} retry={detail.reload} />}
      <div className="detail-title-row">
        <h3>{avatar.name}</h3>
        {current && (
          <Badge className="quest">
            <Check size={12} />
            {t('Текущий')}
          </Badge>
        )}
      </div>
      <button
        className="text-button avatar-author"
        onClick={() => {
          if (avatar.authorId) {
            onClose();
            openUser(avatar.authorId);
          }
        }}
      >
        {text(avatar.authorName, t('Автор аватара'))}
        <ChevronRight size={15} />
      </button>
      <PlatformBadges packages={avatar.unityPackages} />
      <p className="preserve-text">{text(avatar.description, t('Автор не добавил описание.'))}</p>
      <div className="detail-actions">
        <button className="button" onClick={() => setConfirm(true)} disabled={current || busy}>
          <Sparkles size={17} />
          {current ? t('Уже выбран') : t('Выбрать аватар')}
        </button>
        <button className="button secondary" onClick={() => setFavorite(!favorite)}>
          <Heart size={17} />
          {t('В коллекцию')}
        </button>
      </div>
      {confirm && (
        <div className="confirm-inline">
          <p>{t('Сменить текущий аватар на «{name}»?', { name: avatar.name })}</p>
          <p className="small muted">{t('Выбор изменится в вашем аккаунте VRChat.')}</p>
          <div className="row">
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await act(async () => {
                  const result = await api.selectAvatar(avatar.id);
                  setConfirm(false);
                  onRefresh();
                  return result;
                }, uiMessage('Аватар выбран'));
                setBusy(false);
              }}
            >
              {t('Подтвердить')}
            </button>
            <button className="button secondary" onClick={() => setConfirm(false)}>
              {t('Отмена')}
            </button>
          </div>
        </div>
      )}
      {favorite && (
        <FavoritePicker entityId={avatar.id} type="avatar" onComplete={() => setFavorite(false)} />
      )}
    </Modal>
  );
}

export function FavoritePicker({
  entityId,
  type,
  onComplete,
}: {
  entityId: string;
  type: 'avatar' | 'world' | 'friend';
  onComplete: () => void;
}) {
  useI18n();
  const { demo, user, act } = useApp();
  const groups = useLoad(
    async () =>
      demo
        ? [{ id: 'fav_demo', type, name: 'avatars1', displayName: t('Любимое') }]
        : loadFavoriteGroups(user.id, type),
    [demo, type],
  );
  const [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false);
  const relevant = (groups.data || [])
    .map(record)
    .filter(
      (group) =>
        text(group.type) === type || (type === 'world' && text(group.type) === 'vrcPlusWorld'),
    );
  return (
    <form
      className="card form-stack favorite-picker"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!selected || busy) return;
        setBusy(true);
        await act(async () => {
          const selectedGroup = relevant.find((g) => g.name === selected);
          if (!selectedGroup) throw new Error(t('Выберите доступную коллекцию.'));
          const result = await api.addFavorite(
            entityId,
            text(selectedGroup.type) as FavoriteType,
            selected,
          );
          onComplete();
          return result;
        }, uiMessage('Добавлено в избранное'));
        setBusy(false);
      }}
    >
      <h3>{t('Добавить в коллекцию')}</h3>
      {groups.loading ? (
        <Loading />
      ) : groups.error ? (
        <ErrorState error={groups.error} retry={groups.reload} />
      ) : !relevant.length ? (
        <p className="muted">{t('Нет доступных коллекций этого типа.')}</p>
      ) : (
        <label className="field">
          {t('Коллекция')}
          <select required value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">{t('Выберите коллекцию')}</option>
            {relevant.map((group) => (
              <option key={text(group.id, text(group.name))} value={text(group.name)}>
                {text(group.displayName, text(group.name))}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row">
        <button className="button" disabled={!selected || busy}>
          <Heart size={16} />
          {t('Добавить')}
        </button>
        <button type="button" className="button secondary" onClick={onComplete}>
          {t('Отмена')}
        </button>
      </div>
    </form>
  );
}

function Collections({ type, onClose }: { type: 'world' | 'avatar'; onClose: () => void }) {
  useI18n();
  const { demo, user, act } = useApp();
  const groups = useLoad(
    async () =>
      demo
        ? [
            {
              id: 'fav_demo',
              type,
              name: type === 'world' ? 'worlds1' : 'avatars1',
              displayName: t('Любимое'),
            },
          ]
        : loadFavoriteGroups(user.id, type),
    [demo, type],
  );
  const [editing, setEditing] = useState(''),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false);
  const relevant = (groups.data || [])
    .map(record)
    .filter(
      (group) =>
        text(group.type) === type || (type === 'world' && text(group.type) === 'vrcPlusWorld'),
    );
  return (
    <Modal
      title={type === 'world' ? t('Коллекции миров') : t('Коллекции аватаров')}
      onClose={onClose}
    >
      <p className="muted">
        {t('Переименуйте коллекции. Изменения сохраняются в вашем аккаунте VRChat.')}
      </p>
      {groups.loading ? (
        <Loading />
      ) : groups.error ? (
        <ErrorState error={groups.error} retry={groups.reload} />
      ) : !relevant.length ? (
        <Empty title={t('Коллекции не найдены')} />
      ) : (
        <div className="explore-post-list">
          {relevant.map((group) => (
            <div className="card collection-row" key={text(group.id, text(group.name))}>
              <div className="row">
                <Layers3 size={20} />
                <strong>{text(group.displayName, text(group.name))}</strong>
                <button
                  className="text-button"
                  onClick={() => {
                    setEditing(text(group.name));
                    setName(text(group.displayName, text(group.name)));
                  }}
                >
                  {t('Изменить')}
                </button>
              </div>
              {editing === group.name && (
                <form
                  className="form-stack"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (busy || !name.trim()) return;
                    setBusy(true);
                    await act(async () => {
                      const result = await api.renameFavoriteGroup(
                        text(group.type) as FavoriteType,
                        text(group.name),
                        user.id,
                        name.trim(),
                      );
                      setEditing('');
                      groups.reload();
                      return result;
                    }, uiMessage('Коллекция переименована'));
                    setBusy(false);
                  }}
                >
                  <label className="field">
                    {t('Название')}
                    <input
                      maxLength={32}
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <div className="row">
                    <button className="button" disabled={busy || !name.trim()}>
                      {t('Сохранить')}
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setEditing('')}
                    >
                      {t('Отмена')}
                    </button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
