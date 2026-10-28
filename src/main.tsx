import { t } from './i18n';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { recordWebFailure } from './api/diagnostics';
import DiagnosticsPanel from './components/DiagnosticsPanel';
window.addEventListener('error', (event) => recordWebFailure('runtime', event.error));
window.addEventListener('unhandledrejection', (event) =>
  recordWebFailure('rejection', event.reason),
);
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: Error) {
    recordWebFailure('render', error);
  }
  render() {
    return this.state.error ? (
      <div className="fatal-error">
        <h1>{t('Не удалось открыть экран')}</h1>
        <p>
          {t('Перезапустите интерфейс. Если ошибка повторится, скопируйте технический отчёт ниже.')}
        </p>
        <button className="button primary" onClick={() => location.reload()}>
          {t('Перезапустить')}
        </button>
        <DiagnosticsPanel />
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
