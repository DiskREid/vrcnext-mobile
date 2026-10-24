import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  LockKeyhole,
  Smartphone,
  ShieldCheck,
  Eye,
  EyeOff,
  ExternalLink,
} from 'lucide-react';
import { api, ApiError, isNative, isTwoFactorChallenge, native } from '../api';
import type { User, TwoFactorChallenge } from '../api';
import DiagnosticsPanel from '../components/DiagnosticsPanel';

const methodLabel = (method: string) =>
  method.toLowerCase() === 'totp'
    ? 'Приложение-аутентификатор'
    : method.toLowerCase() === 'emailotp'
      ? 'Код из письма'
      : 'Резервный код';

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
    [resuming, setResuming] = useState(isNative),
    [restoredChallenge, setRestoredChallenge] = useState(false),
    [showAccountHelp, setShowAccountHelp] = useState(false);

  const showChallenge = (challenge: TwoFactorChallenge, restored = false) => {
    const options = challenge.requiresTwoFactorAuth.map((value) => value.toLowerCase());
    setMethods(options);
    setMethod(options.includes('totp') ? 'totp' : options[0]);
    setRestoredChallenge(restored);
    setCode('');
  };
  useEffect(() => {
    if (!isNative) return;
    let live = true;
    api
      .resumeOnLaunch()
      .then((result) => {
        if (!live || result === null) return;
        if (isTwoFactorChallenge(result)) showChallenge(result, true);
        else onLogin(result);
      })
      .catch((failure) => {
        // A fresh install has no session; only unexpected restore failures need a message.
        if (live && !(failure instanceof ApiError && failure.status === 401))
          setError(failure instanceof Error ? failure.message : 'Не удалось проверить сессию.');
      })
      .finally(() => {
        if (live) setResuming(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || resuming) return;
    setBusy(true);
    setError('');
    try {
      if (methods.length) {
        const user = await api.verify2fa(code, method);
        setCode('');
        onLogin(user);
      } else {
        const result = await api.login(username, password);
        setPassword('');
        if (isTwoFactorChallenge(result)) showChallenge(result);
        else onLogin(result);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  };
  const restart = async () => {
    if (busy || resuming) return;
    setBusy(true);
    setError('');
    try {
      await api.cancelLogin();
      setMethods([]);
      setCode('');
      setPassword('');
      setRestoredChallenge(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось начать вход заново.');
    } finally {
      setBusy(false);
    }
  };
  const openOfficialLogin = async () => {
    try {
      if (isNative) await native.openLink({ url: 'https://vrchat.com/home/login' });
      else window.open('https://vrchat.com/home/login', '_blank', 'noopener,noreferrer');
    } catch {
      setError('Не удалось открыть браузер. Откройте https://vrchat.com/home/login вручную.');
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
            ? method === 'emailotp'
              ? 'Откройте последнее письмо VRChat, затем вернитесь сюда и введите код.'
              : method === 'otp'
                ? 'Введите один из резервных кодов VRChat.'
                : 'Введите код из приложения-аутентификатора.'
            : 'Друзья, любимые миры и новые встречи — теперь в кармане.'}
        </p>
        {resuming ? (
          <div className="loading" role="status">
            Проверяем сохранённый вход…
          </div>
        ) : (
          <form className="form-stack" onSubmit={submit}>
            {methods.length > 0 ? (
              <>
                {restoredChallenge && (
                  <p className="muted small">
                    Предыдущий вход ожидает подтверждения. Временная сессия восстановлена.
                  </p>
                )}
                <label className="field">
                  Способ подтверждения
                  <select
                    value={method}
                    disabled={busy}
                    onChange={(event) => {
                      setMethod(event.target.value);
                      setCode('');
                      setError('');
                    }}
                  >
                    {methods.map((option) => (
                      <option key={option} value={option}>
                        {methodLabel(option)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  {method === 'emailotp'
                    ? 'Код из письма'
                    : method === 'otp'
                      ? 'Резервный код'
                      : 'Код подтверждения'}
                  <input
                    autoFocus
                    type="text"
                    inputMode={method === 'otp' ? 'text' : 'numeric'}
                    autoComplete="one-time-code"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    required
                    disabled={busy}
                    maxLength={method === 'otp' ? 64 : 16}
                    placeholder={method === 'otp' ? 'Резервный код VRChat' : '6 цифр'}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  Имя пользователя VRChat
                  <input
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Имя для входа, не отображаемое имя"
                    disabled={!isNative || busy}
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
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      disabled={!isNative || busy}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      disabled={busy}
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
                disabled={busy}
                onClick={() => void restart()}
              >
                <ChevronLeft size={16} />
                Начать вход заново
              </button>
            )}
          </form>
        )}
        <button
          type="button"
          className="text-button"
          disabled={busy || resuming}
          aria-expanded={showAccountHelp}
          onClick={() => setShowAccountHelp(!showAccountHelp)}
        >
          Аккаунт Google или другой способ входа
        </button>
        {showAccountHelp && (
          <div className="inset-panel form-stack">
            <p>
              VRCNext Mobile входит через имя пользователя и пароль аккаунта VRChat. Прямой вход
              через Google в этой версии не поддерживается.
            </p>
            <p>
              Если ваш аккаунт связан с Google или другой платформой, проверьте способы входа и
              настройки аккаунта на официальном сайте VRChat. При наличии данных самого VRChat
              используйте их здесь.
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={() => void openOfficialLogin()}
            >
              Открыть официальный вход VRChat
              <ExternalLink size={16} />
            </button>
            <p className="muted small">
              Вход в браузере не переносит сессию в это приложение автоматически.
            </p>
          </div>
        )}
        <div className="auth-divider">
          <span>или сначала осмотритесь</span>
        </div>
        <button className="button secondary full" disabled={busy || resuming} onClick={onDemo}>
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
        <DiagnosticsPanel />
        <p className="auth-footer">
          <LockKeyhole size={12} />
          Неофициальный клиент · на основе VRCNext
        </p>
      </main>
    </div>
  );
}
