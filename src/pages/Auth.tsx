import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  LockKeyhole,
  Smartphone,
  ShieldCheck,
  Eye,
  EyeOff,
} from 'lucide-react';
import { api, isNative, isTwoFactorChallenge } from '../api';
import type { User } from '../api';
export default function Auth({
  onLogin,
  onDemo,
}: {
  onLogin: (u: User) => void;
  onDemo: () => void;
}) {
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [methods, setMethods] = useState<string[]>([]),
    [method, setMethod] = useState('totp'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [visible, setVisible] = useState(false),
    [resuming, setResuming] = useState(isNative);
  useEffect(() => {
    if (!isNative) return;
    let live = true;
    api
      .resume()
      .then((u) => {
        if (live) onLogin(u);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setResuming(false);
      });
    return () => {
      live = false;
    };
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (methods.length) {
        onLogin(await api.verify2fa(code, method));
        setCode('');
      } else {
        const result = await api.login(username, password);
        setPassword('');
        if (isTwoFactorChallenge(result)) {
          setMethods(result.requiresTwoFactorAuth);
          setMethod(
            result.requiresTwoFactorAuth.includes('totp')
              ? 'totp'
              : result.requiresTwoFactorAuth[0].toLowerCase(),
          );
        } else onLogin(result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <div className="auth-art" aria-hidden="true">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <img src="/mark.svg" alt="" />
        <span>
          YOUR NEXT WORLD
          <br />
          IS CLOSER.
        </span>
      </div>
      <main className="auth-panel">
        <div className="brand">
          <img src="/mark.svg" alt="" />
          <div>
            VRCNext <span>Mobile</span>
          </div>
        </div>
        <span className="pill">
          <Smartphone size={14} /> VRChat, всегда рядом
        </span>
        <h1>{methods.length ? 'Ещё один шаг.' : 'Твои миры.\nТвои люди.'}</h1>
        <p className="auth-description">
          {methods.length
            ? 'Подтвердите вход кодом VRChat.'
            : 'Друзья, любимые миры и новые встречи — теперь в кармане.'}
        </p>
        {resuming ? (
          <div className="loading">Восстанавливаем сессию…</div>
        ) : (
          <form className="form-stack" onSubmit={submit}>
            {methods.length ? (
              <>
                <label className="field">
                  Способ подтверждения
                  <select value={method} onChange={(e) => setMethod(e.target.value)}>
                    {methods.map((m) => (
                      <option key={m} value={m.toLowerCase()}>
                        {m === 'totp'
                          ? 'Приложение-аутентификатор'
                          : m === 'emailOtp'
                            ? 'Код из письма'
                            : 'Резервный код'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Код подтверждения
                  <input
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    maxLength={16}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  Имя пользователя VRChat
                  <input
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Имя для входа, не отображаемое имя"
                    disabled={!isNative}
                    required
                  />
                </label>
                <label className="field">
                  Пароль
                  <div className="password-field">
                    <input
                      type={visible ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={!isNative}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setVisible(!visible)}
                    >
                      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </label>
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" type="submit" disabled={busy || !isNative}>
              {busy ? 'Подключаемся…' : methods.length ? 'Подтвердить' : 'Войти в VRChat'}
              <ArrowRight size={18} />
            </button>
            {methods.length > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={async () => {
                  await api.logout().catch(() => {});
                  setMethods([]);
                  setCode('');
                  setError('');
                }}
              >
                <ChevronLeft size={16} />
                Другой аккаунт
              </button>
            )}
          </form>
        )}
        <div className="auth-divider">
          <span>или сначала осмотритесь</span>
        </div>
        <button className="button secondary full" onClick={onDemo}>
          Открыть деморежим
          <ArrowRight size={17} />
        </button>
        {!isNative && (
          <p className="muted small">
            Это браузерный просмотр интерфейса. Вход в аккаунт доступен в Android APK.
          </p>
        )}
        <div className="privacy-note">
          <ShieldCheck size={20} />
          <p>
            Прямое подключение к VRChat. Пароль не сохраняется; сессия защищена Android Keystore.
          </p>
        </div>
        <p className="auth-footer">
          <LockKeyhole size={12} />
          Неофициальный клиент · на основе VRCNext
        </p>
      </main>
    </div>
  );
}
