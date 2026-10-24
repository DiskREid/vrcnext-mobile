import { useState } from 'react';
import { Copy, RefreshCw, FileText } from 'lucide-react';
import { isNative } from '../api/native';
import { diagnostics } from '../api/diagnostics';
import type { StartupReport } from '../api/diagnostics';
export default function DiagnosticsPanel() {
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
      setMessage('Не удалось прочитать отчёт.');
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    setBusy(true);
    try {
      await diagnostics.copyReport();
      setMessage('Отчёт скопирован. Его можно отправить разработчику.');
    } catch {
      setMessage('Не удалось скопировать отчёт.');
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    try {
      await diagnostics.clearReport();
      setReport(await diagnostics.getReport());
      setMessage('Сведения о предыдущем сбое очищены.');
    } catch {
      setMessage('Не удалось очистить отчёт.');
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
        Диагностика запуска
      </summary>
      <p>
        Локальный технический отчёт: версия приложения, Android, WebView и сведения о сбое. Паролей,
        кодов, cookie и токенов в нём нет. Автоматически никуда не отправляется.
      </p>
      {busy && !report ? (
        <p role="status">Подготовка отчёта…</p>
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
                Скопировать отчёт
              </button>
              <button
                className="icon-button"
                disabled={busy}
                onClick={() => void read()}
                aria-label="Обновить отчёт"
              >
                <RefreshCw size={17} />
              </button>
              {report.hasPreviousCrash && (
                <button className="text-button" disabled={busy} onClick={() => void clear()}>
                  Очистить
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
