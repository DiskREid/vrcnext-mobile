import AppearanceSettings from '../components/AppearanceSettings';
import { uiMessage } from '../i18n';
import DiagnosticsPanel from '../components/DiagnosticsPanel';
import { useEffect, useRef, useState } from 'react';
import { LockKeyhole, LogOut, Info, Clock, ArrowUpRight, Languages } from 'lucide-react';
import { api } from '../api';
import { isNative, native } from '../api/native';
import { mergePublicProfile, readPublicProfile } from '../api/profile';
import { ActivityWorldChange } from '../components/ActivityLinks';
import type { User, ProfileUpdate } from '../api';
import { useApp, useLoad } from '../state';
import {
  PageHeader,
  AvatarImage,
  imageOf,
  ErrorState,
  Loading,
  Empty,
  Segmented,
  Badge,
} from '../components/ui';
import { statusName, rankOf } from './Details';
import { t, useI18n, dateLocale, SUPPORTED_LANGUAGES } from '../i18n';
import type { Language } from '../i18n';
export function ProfilePage({ onUpdated }: { onUpdated: (u: User) => void }) {
  useI18n();
  const { user, demo, act } = useApp();
  const [status, setStatus] = useState(user.status || 'active'),
    [text, setText] = useState(user.statusDescription || ''),
    [bio, setBio] = useState(user.bio || ''),
    [pronouns, setPronouns] = useState(user.pronouns || ''),
    [languages, setLanguages] = useState(user.languages?.join(', ') || ''),
    [links, setLinks] = useState(user.bioLinks?.join('\n') || ''),
    [busy, setBusy] = useState(false);
  const edited = useRef(new Set<'bio' | 'languages' | 'links' | 'status' | 'text' | 'pronouns'>());
  const profile = useLoad(
    () =>
      demo
        ? Promise.resolve({ ...user, bio: user.bio || '' })
        : api.userProfile(user.id).then((value) => readPublicProfile(value, user.id)),
    [user.id, demo],
  );
  useEffect(() => {
    if (!profile.data) return;
    const complete = mergePublicProfile(user, profile.data);
    // Loading a public profile must not overwrite edits made while the response was in flight.
    if (!edited.current.has('bio')) setBio(complete.bio || '');
    if (!edited.current.has('languages')) setLanguages(complete.languages?.join(', ') || '');
    if (!edited.current.has('links')) setLinks(complete.bioLinks?.join('\n') || '');
  }, [profile.data, user.id]);
  useEffect(() => {
    if (!edited.current.has('status')) setStatus(user.status || 'active');
    if (!edited.current.has('text')) setText(user.statusDescription || '');
    if (!edited.current.has('pronouns')) setPronouns(user.pronouns || '');
  }, [user.id, user.status, user.statusDescription, user.pronouns]);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void act(async () => {
      setBusy(true);
      try {
        const update: ProfileUpdate = {
          status,
          statusDescription: text,
          pronouns,
          ...(typeof profile.data?.bio === 'string' || edited.current.has('bio') ? { bio } : {}),
          ...(Array.isArray(profile.data?.languages) || edited.current.has('languages')
            ? {
                languages: languages
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              }
            : {}),
          ...(Array.isArray(profile.data?.bioLinks) || edited.current.has('links')
            ? {
                bioLinks: links
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              }
            : {}),
        };
        const next = await api.updateProfile(user.id, update);
        edited.current.clear();
        // The /auth/user response may omit the split public profile fields.
        onUpdated(mergePublicProfile({ ...user, ...next }, update as Record<string, unknown>));
      } finally {
        setBusy(false);
      }
    }, uiMessage('Профиль обновлён'));
  };
  return (
    <>
      <PageHeader
        eyebrow={t('ВАШ АККАУНТ')}
        title={t('Мой профиль')}
        subtitle={t('Как вас видят в VRChat')}
      />
      <div className="profile-card card">
        <AvatarImage
          src={imageOf(user)}
          name={user.displayName}
          size={76}
          user={user}
          fallbackSrc={user.currentAvatarThumbnailImageUrl || user.currentAvatarImageUrl}
        />
        <div>
          <h2>{user.displayName}</h2>
          <Badge className="rank">{rankOf(user.tags)}</Badge>
        </div>
      </div>
      <form className="form-stack narrow" onSubmit={save}>
        {profile.loading && !profile.data && <Loading />}
        {profile.error && <ErrorState error={profile.error} retry={profile.reload} />}
        <div className="field-grid">
          <label className="field">
            {t('Статус')}
            <select
              value={status}
              onChange={(e) => {
                edited.current.add('status');
                setStatus(e.target.value);
              }}
            >
              {['join me', 'active', 'ask me', 'busy'].map((s) => (
                <option key={s} value={s}>
                  {t(statusName(s))}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('Местоимения')}
            <input
              value={pronouns}
              onChange={(e) => {
                edited.current.add('pronouns');
                setPronouns(e.target.value);
              }}
              maxLength={64}
            />
          </label>
        </div>
        <label className="field">
          {t('Текст статуса')}
          <span className="input-hint">{text.length} / 32</span>
          <input
            value={text}
            onChange={(e) => {
              edited.current.add('text');
              setText(e.target.value);
            }}
            maxLength={32}
          />
        </label>
        <label className="field">
          {t('О себе')}
          <textarea
            value={bio}
            onChange={(e) => {
              edited.current.add('bio');
              setBio(e.target.value);
            }}
            maxLength={512}
            rows={6}
          />
        </label>
        <label className="field">
          {t('Языки')}
          <input
            value={languages}
            onChange={(e) => {
              edited.current.add('languages');
              setLanguages(e.target.value);
            }}
            placeholder="rus, eng, jpn"
          />
          <span className="muted small">{t('Коды языков VRChat через запятую.')}</span>
        </label>
        <label className="field">
          {t('Социальные ссылки')}
          <textarea
            value={links}
            onChange={(e) => {
              edited.current.add('links');
              setLinks(e.target.value);
            }}
            rows={3}
            placeholder={t('https://… — каждая ссылка с новой строки')}
          />
        </label>
        <button
          className="button primary"
          disabled={busy || profile.loading || !!profile.error || !profile.data}
          type="submit"
        >
          {busy ? t('Сохраняем…') : t('Сохранить изменения')}
        </button>
      </form>
    </>
  );
}
export function SettingsPage({ onAbout }: { onAbout?: () => void } = {}) {
  const { language, setLanguage } = useI18n();
  const { logout } = useApp();
  const [confirm, setConfirm] = useState(false);
  const [screenProtection, setScreenProtection] = useState<boolean | null>(isNative ? null : false);
  const [protectionBusy, setProtectionBusy] = useState(false);
  const [protectionError, setProtectionError] = useState('');
  const [protectionReadRevision, setProtectionReadRevision] = useState(0);
  useEffect(() => {
    if (!isNative) return;
    let active = true;
    setProtectionError('');
    native.screenProtection().then(
      ({ enabled }) => {
        if (active) setScreenProtection(enabled);
      },
      () => {
        if (active) setProtectionError(t('Не удалось прочитать настройку защиты экрана.'));
      },
    );
    return () => {
      active = false;
    };
  }, [protectionReadRevision]);
  const changeScreenProtection = async (enabled: boolean) => {
    if (!isNative || protectionBusy || screenProtection === null) return;
    setProtectionBusy(true);
    setProtectionError('');
    try {
      const result = await native.setScreenProtection({ enabled });
      setScreenProtection(result.enabled);
    } catch {
      setProtectionError(t('Не удалось изменить защиту экрана. Повторите попытку.'));
    } finally {
      setProtectionBusy(false);
    }
  };
  return (
    <>
      <PageHeader eyebrow={t('ПОД ВАС')} title={t('Настройки')} />
      <div className="settings-grid">
        <section className="card settings-section">
          <Languages />
          <h2>{t('Язык приложения')}</h2>
          <label className="field">
            {t('Язык интерфейса')}
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as Language)}
            >
              <option value="system">{t('Как на устройстве')}</option>
              {SUPPORTED_LANGUAGES.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            {t('Применяется сразу. Друзья, история и сессия сохраняются.')}
          </p>
        </section>
        <AppearanceSettings />
        <section className="card settings-section">
          <LockKeyhole />
          <h2>{t('Конфиденциальность')}</h2>
          <label className="screen-protection-setting">
            <span>
              <strong>{t('Защита от снимка экрана')}</strong>
              <span className="muted small">
                {isNative
                  ? t(
                      'Включите, чтобы запретить скриншоты и скрывать содержимое приложения при записи экрана. По умолчанию выключена.',
                    )
                  : t(
                      'Доступна в Android-приложении. Браузер не позволяет управлять снимками экрана.',
                    )}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label={t('Защита от снимка экрана')}
              checked={screenProtection === true}
              disabled={!isNative || protectionBusy || screenProtection === null}
              onChange={(event) => void changeScreenProtection(event.target.checked)}
            />
          </label>
          {protectionError && (
            <div role="alert">
              <p>{t(protectionError)}</p>
              {screenProtection === null && (
                <button
                  className="button secondary compact"
                  onClick={() => setProtectionReadRevision((value) => value + 1)}
                >
                  {t('Повторить чтение настройки')}
                </button>
              )}
            </div>
          )}
          <DiagnosticsPanel />
          <p className="muted">
            {t(
              'Пароль не сохраняется. Cookie сессии шифруются ключом Android Keystore. Резервное копирование отключено. Защитой от снимков экрана можно управлять выше. Нет аналитики и промежуточного сервера.',
            )}
          </p>
          <p className="muted small">
            {t(
              'Для защиты сессии приложение не показывает cookie и токены. Выход удаляет сохранённую сессию на устройстве.',
            )}
          </p>
          <button className="button danger" onClick={() => setConfirm(true)}>
            <LogOut size={17} />
            {t('Выйти из аккаунта')}
          </button>
          {confirm && (
            <div className="confirm-panel">
              <p>{t('Завершить сессию и удалить её с этого устройства?')}</p>
              <div className="row">
                <button className="button secondary" onClick={() => setConfirm(false)}>
                  {t('Отмена')}
                </button>
                <button className="button danger" onClick={logout}>
                  {t('Выйти')}
                </button>
              </div>
            </div>
          )}
        </section>
        {onAbout && (
          <section className="card settings-section">
            <Info />
            <h2>{t('О проекте')}</h2>
            <p className="muted">
              {t('VRCNext Mobile — ваши друзья, миры и встречи VRChat с телефона.')}
            </p>
            <p className="muted small">
              {t('История проекта, автор, исходный код и поддержка на Boosty.')}
            </p>
            <button className="button secondary" onClick={onAbout}>
              {t('Открыть страницу проекта')}
              <ArrowUpRight size={17} />
            </button>
          </section>
        )}
      </div>
    </>
  );
}
export function TimelinePage() {
  useI18n();
  const { activity, openUser } = useApp();
  return (
    <>
      <PageHeader
        eyebrow={t('ЭТО УСТРОЙСТВО')}
        title={t('Активность')}
        subtitle={t('События текущей сессии приложения')}
      />
      <div className="inset-panel">
        <Clock size={21} />
        <p>
          {t(
            'Действия в приложении и события друзей за текущую мобильную сессию. Журнал очищается после выхода из аккаунта.',
          )}
        </p>
      </div>
      {!activity.length ? (
        <Empty
          title={t('Начало новой истории')}
          text={t('Здесь появятся действия в приложении и события друзей, полученные от VRChat.')}
        />
      ) : (
        <div className="timeline">
          {activity.map((a) => (
            <article key={a.id} className="timeline-entry">
              <span className="timeline-point" />
              <div>
                <strong>{t(a.title, a.titleParams)}</strong>
                {a.userId && (
                  <button
                    className="text-button"
                    aria-label={t('Открыть профиль {name}', { name: a.displayName || a.userId })}
                    onClick={() => openUser(a.userId!)}
                  >
                    {a.displayName || a.userId}
                  </button>
                )}
                {a.location !== undefined || a.beforeLocation !== undefined || a.worldId ? (
                  <ActivityWorldChange
                    before={a.beforeLocation}
                    after={a.location}
                    worldId={a.worldId}
                  />
                ) : (
                  a.detail && a.detail !== a.displayName && <p className="muted">{a.detail}</p>
                )}
                <time>
                  {new Date(a.time).toLocaleTimeString(dateLocale(), {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
export function ModerationPage() {
  useI18n();
  const { demo, act, refresh, openUser, history } = useApp();
  const [type, setType] = useState<'block' | 'mute'>('block');
  const load = useLoad(() => (demo ? Promise.resolve([]) : api.moderations(type)), [type, refresh]);
  return (
    <>
      <PageHeader
        title={t('Блокировки и mute')}
        subtitle={t('Управление модерацией вашего аккаунта')}
      />
      <Segmented
        value={type}
        onChange={(v) => setType(v as typeof type)}
        items={[
          { id: 'block', label: t('Заблокированные') },
          { id: 'mute', label: t('Заглушённые') },
        ]}
      />
      {load.loading ? (
        <Loading />
      ) : load.error ? (
        <ErrorState error={load.error} retry={load.reload} />
      ) : load.data?.length ? (
        load.data.map((m) => (
          <div className="list-row" key={m.id}>
            <button
              className="text-button"
              onClick={() => m.targetUserId && openUser(m.targetUserId)}
            >
              {m.targetDisplayName || m.targetUserId}
            </button>
            <button
              className="button secondary compact"
              onClick={() =>
                void act(async () => {
                  await api.unmoderate(m.targetUserId!, type);
                  history.recordModeration(
                    m.targetUserId!,
                    m.targetDisplayName || m.targetUserId!,
                    `Снято ограничение ${type}`,
                  );
                  load.reload();
                }, uiMessage('Ограничение снято'))
              }
            >
              {t('Отменить {type}', { type })}
            </button>
          </div>
        ))
      ) : (
        <Empty />
      )}
    </>
  );
}
