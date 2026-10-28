import { uiMessage } from '../i18n';
import { t, useI18n } from '../i18n';
import { useState } from 'react';
import { Check, Star } from 'lucide-react';
import type { User, FavoriteGroup } from '../api';
import { favoriteApi, loadFavoriteGroups } from '../api/favorites';
import {
  commitFriendFavorite,
  favoriteFriendRecords,
  refreshFriendFavorites,
  useFriendFavorites,
} from '../data/favorite-friends';
import { useApp, useLoad } from '../state';
import { Empty, ErrorState, Loading, Modal } from './ui';
import './FriendFavoriteButton.css';

export default function FriendFavoriteButton({ user }: { user: User }) {
  useI18n();
  const ctx = useApp();
  const favorites = useFriendFavorites(
    ctx.user.id,
    ctx.demo,
    ctx.refresh,
    ctx.pageActive !== false,
  );
  const [open, setOpen] = useState(false);
  const records = favoriteFriendRecords(favorites.records, user.id);
  const selected = records.length > 0;
  const canAdd =
    user.isFriend === true ||
    (user.isFriend !== false &&
      (!!user.friendKey || ctx.friends.data.some((friend) => friend.id === user.id)));
  if (ctx.user.id === user.id) return null;
  return (
    <>
      <button
        className={`icon-button friend-favorite-toggle ${selected ? 'selected' : ''}`}
        aria-label={
          favorites.error && !favorites.loaded
            ? t('Проверить избранное друга')
            : selected
              ? t('Друг в избранном · изменить')
              : t('Добавить друга в избранное')
        }
        aria-pressed={favorites.loaded ? selected : undefined}
        disabled={(favorites.loading && !favorites.loaded) || (!canAdd && !selected)}
        title={
          !canAdd && !selected
            ? t('В избранное можно добавить только друга VRChat')
            : selected
              ? t('Управление категориями избранного')
              : t('Добавить в избранное')
        }
        onClick={() => setOpen(true)}
      >
        <Star size={21} fill={selected ? 'currentColor' : 'none'} />
      </button>
      {open && <FriendFavoriteManager user={user} onClose={() => setOpen(false)} />}
    </>
  );
}
function FriendFavoriteManager({ user, onClose }: { user: User; onClose: () => void }) {
  useI18n();
  const ctx = useApp();
  const favorites = useFriendFavorites(ctx.user.id, ctx.demo, ctx.refresh);
  const groups = useLoad<FavoriteGroup[]>(
    () =>
      ctx.demo
        ? Promise.resolve([
            { type: 'friend', name: 'group_0', displayName: 'Избранное' },
            { type: 'friend', name: 'group_1', displayName: 'На потом' },
          ])
        : loadFavoriteGroups(ctx.user.id, 'friend'),
    [ctx.user.id, ctx.demo],
  );
  const records = favoriteFriendRecords(favorites.records, user.id);
  const existing = [...new Set(records.flatMap((record) => record.tags))];
  const [chosen, setChosen] = useState<string[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tags = chosen || existing;
  const changed = [...tags].sort().join('\0') !== [...existing].sort().join('\0');
  const save = async () => {
    if (busy) return;
    if (records.length > 1) {
      setError(
        t('VRChat вернул несколько записей одного друга. Обновите список перед изменением.'),
      );
      return;
    }
    if (!tags.length && !records.length) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await ctx.act(
        async () => {
          try {
            const saved = records.length
              ? await favoriteApi.setTags(records[0], tags)
              : await favoriteApi.add(user.id, 'friend', tags);
            commitFriendFavorite(ctx.user.id, user.id, saved, ctx.demo);
            await refreshFriendFavorites(ctx.user.id, ctx.demo);
            onClose();
          } catch (failure) {
            setError(
              failure instanceof Error ? failure.message : t('Не удалось изменить избранное.'),
            );
            await refreshFriendFavorites(ctx.user.id, ctx.demo);
            setChosen(undefined);
            throw failure;
          }
        },
        tags.length ? uiMessage('Избранное сохранено') : uiMessage('Друг удалён из избранного'),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t('Избранный друг')} onClose={onClose}>
      <div className="form-stack friend-favorite-manager">
        <h3>{user.displayName}</h3>
        {favorites.error && (
          <ErrorState error={favorites.error} retry={() => void favorites.reload()} />
        )}
        {groups.error && <ErrorState error={groups.error} retry={groups.reload} />}
        {error && <ErrorState error={error} />}
        {(!favorites.loaded && favorites.loading) || groups.loading ? (
          <Loading />
        ) : (
          <>
            <p className="muted small">
              {t(
                'Отметьте категории для этого друга. Снимите отметку, чтобы убрать его из категории.',
              )}
            </p>
            {[
              ...(groups.data || []),
              ...existing
                .filter((tag) => !groups.data?.some((group) => group.name === tag))
                .map((name): FavoriteGroup => ({ type: 'friend', name, displayName: name })),
            ].map((group) => (
              <label className="friend-favorite-category" key={group.name}>
                <input
                  type="checkbox"
                  checked={tags.includes(group.name)}
                  disabled={busy || !favorites.loaded}
                  onChange={(event) =>
                    setChosen(
                      event.target.checked
                        ? [...tags, group.name]
                        : tags.filter((tag) => tag !== group.name),
                    )
                  }
                />
                <span>{group.displayName || group.name}</span>
                {existing.includes(group.name) && <Check size={16} />}
              </label>
            ))}
            {!groups.data?.length && !existing.length && !groups.error && (
              <Empty text={t('VRChat не передал доступные категории друзей.')} />
            )}
            <button
              className="button primary"
              disabled={
                busy ||
                !favorites.loaded ||
                !!favorites.error ||
                !changed ||
                (!groups.data?.length && !existing.length)
              }
              onClick={() => void save()}
            >
              {busy ? t('Сохраняем…') : t('Сохранить категории')}
            </button>
            {existing.length > 0 && (
              <button
                className="button danger"
                disabled={busy || !favorites.loaded}
                onClick={() => setChosen([])}
              >
                {t('Убрать из всех категорий')}
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
