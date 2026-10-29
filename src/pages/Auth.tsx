import { t, useI18n } from '../i18n';
import BrandLogo from '../components/BrandLogo';
import HolidayDecor from '../components/HolidayDecor';
import './AuthAppearance.css';
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
import { api, ApiError, isNative, isTwoFactorChallenge } from '../api';
import type { User, TwoFactorChallenge } from '../api';
import DiagnosticsPanel from '../components/DiagnosticsPanel';

const methodLabel = (method: string) =>
  method.toLowerCase() === 'totp'
    ? t('Приложение-аутентификатор')
    : method.toLowerCase() === 'emailotp'
      ? t('Код из письма')
      : t('Резервный код');

export default function Auth({
  onLogin,
  onDemo,
}: {
  onLogin: (u: User) => void;
  onDemo: () => void;
}) {
  useI18n();
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [methods, setMethods] = useState<string[]>([]),
    [method, setMethod] = useState('totp'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [visible, setVisible] = useState(false),
    [resuming, setResuming] = useState(isNative),
    [restoredChallenge, setRestoredChallenge] = useState(false);

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
          setError(failure instanceof Error ? failure.message : t('Не удалось проверить сессию.'));
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
      setError(failure instanceof Error ? failure.message : t('Не удалось войти'));
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
      setError(failure instanceof Error ? failure.message : t('Не удалось начать вход заново.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page auth-scene">
      <div className="auth-scene-bg" aria-hidden="true" />
      <div className="auth-scene-shade" aria-hidden="true" />
      <div className="auth-scene-decor" aria-hidden="true">
        <HolidayDecor />
      </div>
      <div className="auth-art" aria-hidden="true">
        <BrandLogo />
        <span>{t('Хороший мир — там, где ваши друзья.')}</span>
      </div>
      <main className="auth-panel card">
        <div className="brand">
          <BrandLogo />
          <div>
            VRCNext <span>Mobile</span>
          </div>
        </div>
        <span className="pill">
          <Smartphone size={14} /> {t('VRChat, всегда рядом')}
        </span>
        <h1>{methods.length ? t('Ещё один шаг.') : t('Твои миры.\nТвои люди.')}</h1>
        <p className="auth-description">
          {methods.length
            ? method === 'emailotp'
              ? t('Откройте последнее письмо VRChat, затем вернитесь сюда и введите код.')
              : method === 'otp'
                ? t('Введите один из резервных кодов VRChat.')
                : t('Введите код из приложения-аутентификатора.')
            : t('Друзья, любимые миры и новые встречи — теперь в кармане.')}
        </p>
        {resuming ? (
          <div className="loading" role="status">
            {t('Проверяем сохранённый вход…')}
          </div>
        ) : (
          <form className="form-stack" onSubmit={submit}>
            {methods.length > 0 ? (
              <>
                {restoredChallenge && (
                  <p className="muted small">
                    {t('Предыдущий вход ожидает подтверждения. Временная сессия восстановлена.')}
                  </p>
                )}
                <label className="field">
                  {t('Способ подтверждения')}
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
                    ? t('Код из письма')
                    : method === 'otp'
                      ? t('Резервный код')
                      : t('Код подтверждения')}
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
                    placeholder={method === 'otp' ? t('Резервный код VRChat') : t('6 цифр')}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  {t('Имя пользователя VRChat')}
                  <input
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder={t('Имя для входа, не отображаемое имя')}
                    disabled={!isNative || busy}
                    required
                  />
                </label>
                <label className="field">
                  {t('Пароль')}
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
                      aria-label={visible ? t('Скрыть пароль') : t('Показать пароль')}
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
              {busy ? t('Подключаемся…') : methods.length ? t('Подтвердить') : t('Войти в VRChat')}
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
                {t('Начать вход заново')}
              </button>
            )}
          </form>
        )}
        <div className="auth-divider">
          <span>{t('или сначала осмотритесь')}</span>
        </div>
        <button className="button secondary full" disabled={busy || resuming} onClick={onDemo}>
          {t('Открыть деморежим')}
          <ArrowRight size={17} />
        </button>
        {!isNative && (
          <p className="muted small">
            {t('Это браузерный просмотр интерфейса. Вход в аккаунт доступен в Android APK.')}
          </p>
        )}
        <div className="privacy-note">
          <ShieldCheck size={20} />
          <p>
            {t(
              'Прямое подключение к VRChat. Пароль не сохраняется; сессия защищена Android Keystore.',
            )}
          </p>
        </div>
        <DiagnosticsPanel />
        <p className="auth-footer">
          <LockKeyhole size={12} />
          {t('Неофициальный клиент · на основе VRCNext')}
        </p>
      </main>
    </div>
  );
}
