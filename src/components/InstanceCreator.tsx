import { uiMessage } from '../i18n';
import { t, useI18n } from '../i18n';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CreateInstanceOptions, Instance, World } from '../api';
import {
  avatarPerformanceOptions,
  canCreateGroupInstance,
  createdInstanceLocation,
  groupCreationPermissions,
} from '../api/instances';
import { useApp, useLoad } from '../state';
import { demoGroups } from '../demo';
import { ErrorState, Loading, Modal } from './ui';

export default function InstanceCreator({
  world,
  onClose,
  onCreated,
}: {
  world: World;
  onClose: () => void;
  onCreated: (instance: Instance, location: string) => void;
}) {
  useI18n();
  const ctx = useApp();
  const [type, setType] = useState<CreateInstanceOptions['type']>('friends');
  const [region, setRegion] = useState<CreateInstanceOptions['region']>('eu');
  const [groupId, setGroupId] = useState(''),
    [access, setAccess] = useState<'members' | 'plus' | 'public'>('members');
  const [performance, setPerformance] = useState(''),
    [name, setName] = useState(''),
    [queue, setQueue] = useState(false);
  const [roles, setRoles] = useState<string[]>([]),
    [canRequest, setCanRequest] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [created, setCreated] = useState<{
    instance: Instance;
    location?: string;
    restrictionVerified?: boolean;
  }>();
  const [invited, setInvited] = useState(false);
  const groups = useLoad(
    () =>
      type !== 'group'
        ? Promise.resolve([])
        : ctx.demo
          ? Promise.resolve(demoGroups)
          : api.groups(ctx.user.id),
    [type, ctx.user.id, ctx.demo],
  );
  const detail = useLoad(
    () =>
      type !== 'group' || !groupId
        ? Promise.resolve(undefined)
        : ctx.demo
          ? Promise.resolve(demoGroups.find((g) => g.id === groupId))
          : api.group(groupId),
    [type, groupId, ctx.demo],
  );
  const currentGroup = detail.data?.id === groupId ? detail.data : undefined;
  const permissions = currentGroup
    ? groupCreationPermissions(currentGroup, ctx.user.id)
    : undefined;
  const allowed = type !== 'group' || canCreateGroupInstance(permissions, access, roles.length > 0);
  useEffect(() => {
    setRoles([]);
  }, [groupId]);
  useEffect(() => {
    if (!currentGroup || permissions === undefined || canCreateGroupInstance(permissions, access))
      return;
    const available = (['members', 'plus', 'public'] as const).find((value) =>
      canCreateGroupInstance(permissions, value),
    );
    if (available) setAccess(available);
  }, [currentGroup]);
  async function invite(location: string) {
    await ctx.act(async () => {
      try {
        await api.inviteSelf(location);
        setInvited(true);
        setError('');
      } catch (failure) {
        setError(
          t('Инстанс уже создан. Не удалось пригласить себя: {p0}', {
            p0: String(failure instanceof Error ? failure.message : t('Ошибка VRChat')),
          }),
        );
        throw failure;
      }
    }, uiMessage('Приглашение себе отправлено'));
  }
  async function verifyRestriction(instance: Instance, location: string) {
    if (type !== 'group' || !performance) return;
    const returned =
      instance.minimumAvatarPerformance == null ? await api.instance(location) : instance;
    if (returned.minimumAvatarPerformance !== performance)
      throw new Error(
        t(
          'Инстанс создан, но VRChat не подтвердил выбранное ограничение аватаров. Приглашение себе не отправлено.',
        ),
      );
    setCreated({ instance: returned, location, restrictionVerified: true });
  }
  async function create(andInvite: boolean) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await ctx.act(async () => {
        try {
          const instance = await api.createInstance({
            worldId: world.id,
            type,
            region,
            ...(type === 'group'
              ? {
                  ownerId: groupId,
                  groupAccessType: access,
                  queueEnabled: queue,
                  displayName: name,
                  ...(performance
                    ? { minimumAvatarPerformance: performance as 'Good' | 'Medium' | 'Poor' }
                    : {}),
                  ...(access === 'members' && roles.length ? { roleIds: roles } : {}),
                }
              : type === 'public'
                ? {}
                : { ownerId: ctx.user.id }),
            ...(type === 'private' ? { canRequestInvite: canRequest } : {}),
          });
          setCreated({ instance });
          const location = createdInstanceLocation(instance, world.id);
          setCreated({ instance, location, restrictionVerified: type !== 'group' || !performance });
          onCreated(instance, location);
          await verifyRestriction(instance, location);
          return location;
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : t('Не удалось создать инстанс.'));
          throw failure;
        }
      }, uiMessage('Инстанс создан'));
      if (result && andInvite) await invite(result);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('Новый инстанс')} onClose={onClose}>
      {error && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
      {created ? (
        <div className="form-stack">
          <h3>{t('Инстанс создан')}</h3>
          <p>{world.name}</p>
          {created.location ? (
            <>
              <p className="muted small id-text">#{created.location.split(':')[1].split('~')[0]}</p>
              {type === 'group' && performance && (
                <p className="muted small">
                  {t('Ограничение аватаров: ')}
                  {created.restrictionVerified
                    ? t('{p0} и лучше', { p0: String(performance) })
                    : t('не подтверждено сервером')}
                </p>
              )}
              {!created.restrictionVerified && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void ctx.act(async () => {
                      try {
                        await verifyRestriction(
                          await api.instance(created.location!),
                          created.location!,
                        );
                        setError('');
                      } catch (failure) {
                        setError(
                          failure instanceof Error
                            ? failure.message
                            : t('Не удалось проверить ограничение.'),
                        );
                        throw failure;
                      }
                    })
                  }
                >
                  {t('Проверить ограничение аватаров')}
                </button>
              )}
              <button
                className="button primary"
                disabled={busy || invited || !created.restrictionVerified}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await invite(created.location!);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {invited ? t('Приглашение отправлено') : t('Пригласить себя в созданный инстанс')}
              </button>
            </>
          ) : (
            <button className="button secondary" onClick={ctx.onRefresh}>
              {t('Обновить список инстансов')}
            </button>
          )}
          <button className="button secondary" onClick={onClose}>
            {t('Вернуться к миру')}
          </button>
        </div>
      ) : (
        <div className="form-stack">
          <label className="field">
            {t('Доступ')}
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value as typeof type);
                setError('');
              }}
            >
              <option value="public">Public</option>
              <option value="hidden">Friends+</option>
              <option value="friends">Friends</option>
              <option value="private">Invite</option>
              <option value="group">Group</option>
            </select>
          </label>
          <label className="field">
            {t('Регион')}
            <select
              value={region}
              onChange={(event) => setRegion(event.target.value as typeof region)}
            >
              <option value="eu">{t('Европа')}</option>
              <option value="us">{t('США, запад')}</option>
              <option value="use">{t('США, восток')}</option>
              <option value="jp">{t('Япония')}</option>
            </select>
          </label>
          {type === 'private' && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={canRequest}
                onChange={(event) => setCanRequest(event.target.checked)}
              />
              {t('Разрешить запросы приглашений (Invite+)')}
            </label>
          )}
          {type === 'group' && (
            <>
              {groups.loading && <Loading />}
              {groups.error && <ErrorState error={groups.error} retry={groups.reload} />}
              <label className="field">
                {t('Группа')}
                <select
                  value={groupId}
                  onChange={(event) => setGroupId(event.target.value)}
                  disabled={groups.loading}
                >
                  <option value="">{t('Выберите группу')}</option>
                  {groups.data
                    ?.filter((g) => /^grp_[A-Za-z0-9-]+$/.test(g.id))
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </label>
              {detail.loading && groupId && <Loading />}
              {detail.error && <ErrorState error={detail.error} retry={detail.reload} />}
              <label className="field">
                {t('Доступ группы')}
                <select
                  value={access}
                  onChange={(event) => {
                    setAccess(event.target.value as typeof access);
                    setRoles([]);
                  }}
                >
                  <option
                    value="members"
                    disabled={
                      !canCreateGroupInstance(permissions, 'members') &&
                      !canCreateGroupInstance(permissions, 'members', true)
                    }
                  >
                    {t('Только участники')}
                  </option>
                  <option value="plus" disabled={!canCreateGroupInstance(permissions, 'plus')}>
                    Group+
                  </option>
                  <option value="public" disabled={!canCreateGroupInstance(permissions, 'public')}>
                    Group Public
                  </option>
                </select>
              </label>
              {access === 'members' &&
                !!currentGroup?.roles?.length &&
                canCreateGroupInstance(permissions, 'members', true) && (
                  <fieldset className="instance-role-options">
                    <legend>{t('Роли для входа (пусто — все участники)')}</legend>
                    {currentGroup.roles.map((role) => (
                      <label className="check-row" key={role.id}>
                        <input
                          type="checkbox"
                          checked={roles.includes(role.id)}
                          onChange={(event) =>
                            setRoles((old) =>
                              event.target.checked
                                ? [...old, role.id]
                                : old.filter((id) => id !== role.id),
                            )
                          }
                        />
                        {role.name}
                      </label>
                    ))}
                  </fieldset>
                )}
              {!allowed && (
                <p className="error-inline" role="alert">
                  {t('У вас нет прав на создание этого типа инстанса группы.')}
                </p>
              )}
              <label className="field">
                {t('Ограничение аватаров')}
                <select
                  value={performance}
                  onChange={(event) => setPerformance(event.target.value)}
                >
                  {avatarPerformanceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.label)}
                    </option>
                  ))}
                </select>
                <span className="muted small">
                  {t('Минимальный рейтинг производительности. Ограничение применяет VRChat.')}
                </span>
              </label>
              <label className="field">
                {t('Название инстанса')}
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={64}
                  placeholder={t('Необязательно')}
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={queue}
                  onChange={(event) => setQueue(event.target.checked)}
                />
                {t('Очередь на вход')}
              </label>
            </>
          )}
          <div className="detail-actions">
            <button
              className="button secondary"
              disabled={
                busy ||
                !allowed ||
                (type === 'group' &&
                  (!groupId || detail.loading || !!detail.error || !currentGroup))
              }
              onClick={() => void create(false)}
            >
              {t('Только создать')}
            </button>
            <button
              className="button primary"
              disabled={
                busy ||
                !allowed ||
                (type === 'group' &&
                  (!groupId || detail.loading || !!detail.error || !currentGroup))
              }
              onClick={() => void create(true)}
            >
              {busy ? t('Создание…') : t('Создать и пригласить себя')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
