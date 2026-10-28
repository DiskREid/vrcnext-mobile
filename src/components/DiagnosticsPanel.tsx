import { t, useI18n } from '../i18n';
import { useState } from 'react';
import { Copy, RefreshCw, FileText } from 'lucide-react';
import { isNative } from '../api/native';
import { diagnostics } from '../api/diagnostics';
import type { StartupReport } from '../api/diagnostics';
export default function DiagnosticsPanel() {
  useI18n();
  const [report, setReport] = useState<StartupReport>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  if (!isNative) return null;
  const read = async () => {
    setBusy(true);
    setMessage('');
    try {
      setReport(await diagnostics.getReport());
    } catch {
      setMessage(t('Не удалось прочитать отчёт.'));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    setBusy(true);
    try {
      await diagnostics.copyReport();
      setMessage(t('Отчёт скопирован. Его можно отправить разработчику.'));
    } catch {
      setMessage(t('Не удалось скопировать отчёт.'));
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    try {
      await diagnostics.clearReport();
      setReport(await diagnostics.getReport());
      setMessage(t('Сведения о предыдущем сбое очищены.'));
    } catch {
      setMessage(t('Не удалось очистить отчёт.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="diagnostics-panel"
      onToggle={(e) => {
        if (e.currentTarget.open && !report && !busy) void read();
      }}
    >
      <summary>
        <FileText size={15} />
        {t('Диагностика запуска')}
      </summary>
      <p>
        {t(
          'Локальный технический отчёт: версия приложения, Android, WebView и сведения о сбое. Паролей, кодов, cookie и токенов в нём нет. Автоматически никуда не отправляется.',
        )}
      </p>
      {busy && !report ? (
        <p role="status">{t('Подготовка отчёта…')}</p>
      ) : (
        report && (
          <>
            <pre>{report.text}</pre>
            <div className="detail-actions">
              <button
                className="button secondary compact"
                disabled={busy}
                onClick={() => void copy()}
              >
                <Copy size={15} />
                {t('Скопировать отчёт')}
              </button>
              <button
                className="icon-button"
                disabled={busy}
                onClick={() => void read()}
                aria-label={t('Обновить отчёт')}
              >
                <RefreshCw size={17} />
              </button>
              {report.hasPreviousCrash && (
                <button className="text-button" disabled={busy} onClick={() => void clear()}>
                  {t('Очистить')}
                </button>
              )}
            </div>
          </>
        )
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
