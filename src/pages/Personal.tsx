import DiagnosticsPanel from '../components/DiagnosticsPanel';
import { useEffect, useRef, useState } from 'react';
import { LockKeyhole, LogOut, Info, Palette, Clock, ExternalLink, Check } from 'lucide-react';
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
export function ProfilePage({ onUpdated }: { onUpdated: (u: User) => void }) {
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
    }, 'Профиль обновлён');
  };
  return (
    <>
      <PageHeader eyebrow="ВАШ АККАУНТ" title="Мой профиль" subtitle="Как вас видят в VRChat" />
      <div className="profile-card card">
        <AvatarImage src={imageOf(user)} name={user.displayName} size={76} user={user} fallbackSrc={user.currentAvatarThumbnailImageUrl || user.currentAvatarImageUrl} />
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
            Статус
            <select value={status} onChange={(e) => { edited.current.add('status'); setStatus(e.target.value); }}>
              {['join me', 'active', 'ask me', 'busy'].map((s) => (
                <option key={s} value={s}>
                  {statusName(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Местоимения
            <input value={pronouns} onChange={(e) => { edited.current.add('pronouns'); setPronouns(e.target.value); }} maxLength={64} />
          </label>
        </div>
        <label className="field">
          Текст статуса<span className="input-hint">{text.length} / 32</span>
          <input value={text} onChange={(e) => { edited.current.add('text'); setText(e.target.value); }} maxLength={32} />
        </label>
        <label className="field">
          О себе
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
          Языки
          <input
            value={languages}
            onChange={(e) => {
              edited.current.add('languages');
              setLanguages(e.target.value);
            }}
            placeholder="rus, eng, jpn"
          />
          <span className="muted small">Коды языков VRChat через запятую.</span>
        </label>
        <label className="field">
          Социальные ссылки
          <textarea
            value={links}
            onChange={(e) => {
              edited.current.add('links');
              setLinks(e.target.value);
            }}
            rows={3}
            placeholder="https://… — каждая ссылка с новой строки"
          />
        </label>
        <button
          className="button primary"
          disabled={busy || profile.loading || !!profile.error || !profile.data}
          type="submit"
        >
          {busy ? 'Сохраняем…' : 'Сохранить изменения'}
        </button>
      </form>
    </>
  );
}
export function SettingsPage() {
  const { logout } = useApp(),
    [accent, setAccent] = useState(localStorage.getItem('accent') || '#a398ff'),
    [confirm, setConfirm] = useState(false);
  const [screenProtection, setScreenProtection] = useState<boolean | null>(isNative ? null : false);
  const [protectionBusy, setProtectionBusy] = useState(false);
  const [protectionError, setProtectionError] = useState('');
  const [protectionReadRevision, setProtectionReadRevision] = useState(0);
  useEffect(() => {
    if (!isNative) return;
    let active = true;
    setProtectionError('');
    native.screenProtection().then(
      ({ enabled }) => { if (active) setScreenProtection(enabled); },
      () => { if (active) setProtectionError('Не удалось прочитать настройку защиты экрана.'); },
    );
    return () => { active = false; };
  }, [protectionReadRevision]);
  const changeScreenProtection = async (enabled: boolean) => {
    if (!isNative || protectionBusy || screenProtection === null) return;
    setProtectionBusy(true);
    setProtectionError('');
    try {
      const result = await native.setScreenProtection({ enabled });
      setScreenProtection(result.enabled);
    } catch {
      setProtectionError('Не удалось изменить защиту экрана. Повторите попытку.');
    } finally {
      setProtectionBusy(false);
    }
  };
  const setColor = (c: string) => {
    setAccent(c);
    document.documentElement.style.setProperty('--accent', c);
    localStorage.setItem('accent', c);
  };
  return (
    <>
      <PageHeader eyebrow="ПОД ВАС" title="Настройки" />
      <div className="settings-grid">
        <section className="card settings-section">
          <Palette />
          <h2>Внешний вид</h2>
          <p className="muted">Цвет акцента</p>
          <div className="color-options">
            {['#a398ff', '#82c9b3', '#e6ae85', '#e4a3c0', '#83bbef'].map((c) => (
              <button
                aria-label={`Цвет ${c}`}
                aria-pressed={c === accent}
                key={c}
                style={{ background: c }}
                onClick={() => setColor(c)}
              >
                {c === accent && <Check size={20} />}
              </button>
            ))}
          </div>
          <p className="muted small">
            Ориентация следует повороту устройства. Навигация и карточки автоматически
            подстраиваются под экран.
          </p>
        </section>
        <section className="card settings-section">
          <LockKeyhole />
          <h2>Конфиденциальность</h2>
          <label className="screen-protection-setting">
            <span>
              <strong>Защита от снимка экрана</strong>
              <span className="muted small">
                {isNative
                  ? 'Включите, чтобы запретить скриншоты и скрывать содержимое приложения при записи экрана. По умолчанию выключена.'
                  : 'Доступна в Android-приложении. Браузер не позволяет управлять снимками экрана.'}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Защита от снимка экрана"
              checked={screenProtection === true}
              disabled={!isNative || protectionBusy || screenProtection === null}
              onChange={(event) => void changeScreenProtection(event.target.checked)}
            />
          </label>
          {protectionError && <div role="alert">
            <p>{protectionError}</p>
            {screenProtection === null && <button className="button secondary compact" onClick={() => setProtectionReadRevision((value) => value + 1)}>Повторить чтение настройки</button>}
          </div>}
          <DiagnosticsPanel />
          <p className="muted">
            Пароль не сохраняется. Cookie сессии шифруются ключом Android Keystore. Резервное
            копирование отключено. Защитой от снимков экрана можно управлять выше. Нет аналитики и промежуточного сервера.
          </p>
          <p className="muted small">
            Для защиты сессии приложение не показывает cookie и токены. Выход удаляет сохранённую
            сессию на устройстве.
          </p>
          <button className="button danger" onClick={() => setConfirm(true)}>
            <LogOut size={17} />
            Выйти из аккаунта
          </button>
          {confirm && (
            <div className="confirm-panel">
              <p>Завершить сессию и удалить её с этого устройства?</p>
              <div className="row">
                <button className="button secondary" onClick={() => setConfirm(false)}>
                  Отмена
                </button>
                <button className="button danger" onClick={logout}>
                  Выйти
                </button>
              </div>
            </div>
          )}
        </section>
        <section className="card settings-section">
          <Info />
          <h2>
            VRCNext Mobile <Badge>0.2.6</Badge>
          </h2>
          <p className="muted">
            Неофициальная Android-адаптация VRCNext от shinyflvre и участников VRCNext. Не связана с
            VRChat Inc.
          </p>
          <p className="muted small">
            Исходный проект: shinyflvre/VRCNext, коммит 0bfb467f. Лицензия VNCOL, некоммерческое
            использование. Все уведомления об авторских правах сохранены.
          </p>
          <a
            href="https://github.com/shinyflvre/VRCNext"
            target="_blank"
            rel="noreferrer"
            className="text-button"
          >
            Оригинальный проект <ExternalLink size={14} />
          </a>
          <a
            href="https://github.com/DiskREid/vrcnext-mobile"
            target="_blank"
            rel="noreferrer"
            className="text-button"
          >
            Исходный код Mobile <ExternalLink size={14} />
          </a>
          <details>
            <summary>Лицензия VNCOL</summary>
            <License />
          </details>
        </section>
      </div>
    </>
  );
}
function License() {
  const data = useLoad(
    () =>
      fetch('/LICENSE.txt').then((r) => {
        if (!r.ok) throw Error('Не удалось загрузить лицензию');
        return r.text();
      }),
    [],
  );
  return data.data ? (
    <pre className="license-text">{data.data}</pre>
  ) : data.error ? (
    <p>{data.error}</p>
  ) : (
    <Loading />
  );
}
export function TimelinePage() {
  const { activity, openUser } = useApp();
  return (
    <>
      <PageHeader
        eyebrow="ЭТО УСТРОЙСТВО"
        title="Активность"
        subtitle="События текущей сессии приложения"
      />
      <div className="inset-panel">
        <Clock size={21} />
        <p>
          Действия в приложении и события друзей за текущую мобильную сессию. Журнал очищается после
          выхода из аккаунта.
        </p>
      </div>
      {!activity.length ? (
        <Empty
          title="Начало новой истории"
          text="Здесь появятся действия в приложении и события друзей, полученные от VRChat."
        />
      ) : (
        <div className="timeline">
          {activity.map((a) => (
            <article key={a.id} className="timeline-entry">
              <span className="timeline-point" />
              <div>
                <strong>{a.title}</strong>
                {a.userId && <button className="text-button" aria-label={`Открыть профиль ${a.displayName || a.userId}`} onClick={() => openUser(a.userId!)}>{a.displayName || a.userId}</button>}
                {a.location !== undefined || a.beforeLocation !== undefined || a.worldId
                  ? <ActivityWorldChange before={a.beforeLocation} after={a.location} worldId={a.worldId}/>
                  : a.detail && a.detail !== a.displayName && <p className="muted">{a.detail}</p>}
                <time>
                  {new Date(a.time).toLocaleTimeString('ru', {
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
  const { demo, act, refresh, openUser, history } = useApp();
  const [type, setType] = useState<'block' | 'mute'>('block');
  const load = useLoad(() => (demo ? Promise.resolve([]) : api.moderations(type)), [type, refresh]);
  return (
    <>
      <PageHeader title="Блокировки и mute" subtitle="Управление модерацией вашего аккаунта" />
      <Segmented
        value={type}
        onChange={(v) => setType(v as typeof type)}
        items={[
          { id: 'block', label: 'Заблокированные' },
          { id: 'mute', label: 'Заглушённые' },
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
                  history.recordModeration(m.targetUserId!, m.targetDisplayName || m.targetUserId!, `Снято ограничение ${type}`);
                  load.reload();
                }, 'Ограничение снято')
              }
            >
              Отменить {type}
            </button>
          </div>
        ))
      ) : (
        <Empty />
      )}
    </>
  );
}
