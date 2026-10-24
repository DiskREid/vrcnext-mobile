import DiagnosticsPanel from '../components/DiagnosticsPanel';
import { useState } from 'react';
import { LockKeyhole, LogOut, Info, Palette, Clock, ExternalLink, Check } from 'lucide-react';
import { api } from '../api';
import type { User } from '../api';
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
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void act(async () => {
      setBusy(true);
      try {
        const next = await api.updateProfile(user.id, {
          status,
          statusDescription: text,
          bio,
          pronouns,
          languages: languages
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          bioLinks: links
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        });
        onUpdated(next);
      } finally {
        setBusy(false);
      }
    }, 'Профиль обновлён');
  };
  return (
    <>
      <PageHeader eyebrow="ВАШ АККАУНТ" title="Мой профиль" subtitle="Как вас видят в VRChat" />
      <div className="profile-card card">
        <AvatarImage src={imageOf(user)} name={user.displayName} size={76} status={user.status} />
        <div>
          <h2>{user.displayName}</h2>
          <Badge className="rank">{rankOf(user.tags)}</Badge>
        </div>
      </div>
      <form className="form-stack narrow" onSubmit={save}>
        <div className="field-grid">
          <label className="field">
            Статус
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {['join me', 'active', 'ask me', 'busy'].map((s) => (
                <option key={s} value={s}>
                  {statusName(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Местоимения
            <input value={pronouns} onChange={(e) => setPronouns(e.target.value)} maxLength={64} />
          </label>
        </div>
        <label className="field">
          Текст статуса<span className="input-hint">{text.length} / 32</span>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={32} />
        </label>
        <label className="field">
          О себе
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={512} rows={6} />
        </label>
        <label className="field">
          Языки
          <input
            value={languages}
            onChange={(e) => setLanguages(e.target.value)}
            placeholder="rus, eng, jpn"
          />
          <span className="muted small">Коды языков VRChat через запятую.</span>
        </label>
        <label className="field">
          Социальные ссылки
          <textarea
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            rows={3}
            placeholder="https://… — каждая ссылка с новой строки"
          />
        </label>
        <button className="button primary" disabled={busy} type="submit">
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
          <DiagnosticsPanel />
          <p className="muted">
            Пароль не сохраняется. Cookie сессии шифруются ключом Android Keystore. Резервное
            копирование и снимки экрана отключены. Нет аналитики и промежуточного сервера.
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
            VRCNext Mobile <Badge>0.1.1</Badge>
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
  const { activity } = useApp();
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
                <p className="muted">{a.detail}</p>
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
  const { demo, act, refresh, openUser } = useApp();
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
