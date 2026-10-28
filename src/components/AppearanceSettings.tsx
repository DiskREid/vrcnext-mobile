import { Check, Palette, Sparkles } from 'lucide-react';
import { useAppearance } from '../data/appearance';
import type { AppearanceSettings as AppearancePreferences } from '../data/appearance';
import type { HolidayId } from '../data/holiday-calendar';
import { t, useI18n } from '../i18n';
import './AppearanceSettings.css';

const baseThemes = [
  { id: 'standard-dark', label: 'Standard Dark' },
  { id: 'liquid-dark', label: 'Liquid Glass Dark' },
  { id: 'liquid-light', label: 'Liquid Glass Light' },
] as const;
const holidays: { id: HolidayId; name: string; symbol: string }[] = [
  { id: 'valentine', name: 'День святого Валентина', symbol: '♡' },
  { id: 'womens-day', name: '8 Марта', symbol: '✿' },
  { id: 'st-patrick', name: 'День святого Патрика', symbol: '♧' },
  { id: 'easter', name: 'Пасха', symbol: '◒' },
  { id: 'earth-day', name: 'День Земли', symbol: '◉' },
  { id: 'halloween', name: 'Хэллоуин', symbol: '✦' },
  { id: 'christmas', name: 'Рождество и Новый год', symbol: '❄' },
];
const accents = ['#a398ff', '#82c9b3', '#e6ae85', '#e4a3c0', '#83bbef'];

export default function AppearanceSettings() {
  useI18n();
  const { settings, activeHoliday, effects, updateSettings } = useAppearance();
  const holiday = holidays.find((item) => item.id === activeHoliday);
  const glass = settings.theme !== 'standard-dark';
  return (
    <section className="card settings-section appearance-settings">
      <Palette />
      <h2>{t('Внешний вид')}</h2>
      <div className="appearance-controls">
        <label className="field">
          {t('Тема интерфейса')}
          <select
            aria-label={t('Тема интерфейса')}
            value={settings.theme}
            onChange={(event) =>
              updateSettings({ theme: event.target.value as AppearancePreferences['theme'] })
            }
          >
            {baseThemes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('Интенсивность стекла')}
          <select
            aria-label={t('Интенсивность стекла')}
            value={settings.glassIntensity}
            disabled={!glass}
            onChange={(event) =>
              updateSettings({
                glassIntensity: event.target.value as AppearancePreferences['glassIntensity'],
              })
            }
          >
            <option value="low">{t('Низкая')}</option>
            <option value="medium">{t('Средняя')}</option>
            <option value="high">{t('Высокая')}</option>
          </select>
          {!glass && <span className="muted small">{t('Доступно для Liquid Glass.')}</span>}
        </label>
      </div>
      {effects === 'reduced' && (
        <p className="muted small appearance-performance-note">
          {t('На этом устройстве используются облегчённые эффекты.')}
        </p>
      )}

      <div className="appearance-accent">
        <p className="muted">{t('Цвет акцента')}</p>
        <div className="color-options" role="group" aria-label={t('Цвет акцента')}>
          {accents.map((accent) => (
            <button
              type="button"
              aria-label={t('Цвет {color}', { color: accent })}
              aria-pressed={settings.accent === accent}
              key={accent}
              style={{ background: accent }}
              onClick={() => updateSettings({ accent })}
            >
              {settings.accent === accent && <Check size={20} />}
            </button>
          ))}
        </div>
        {activeHoliday && (
          <p className="muted small">
            {t('Праздничная палитра временно заменяет выбранный акцент.')}
          </p>
        )}
      </div>

      <div className="appearance-holidays">
        <h3>
          <Sparkles size={17} />
          {t('Праздничные темы')}
        </h3>
        <label className="appearance-switch-row">
          <span>{t('Праздничное оформление')}</span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.holidayEnabled}
            onChange={(event) => updateSettings({ holidayEnabled: event.target.checked })}
          />
        </label>
        <div className="appearance-controls appearance-holiday-controls">
          <label className="field">
            {t('Режим оформления')}
            <select
              aria-label={t('Режим оформления')}
              value={settings.holidayMode}
              disabled={!settings.holidayEnabled}
              onChange={(event) =>
                updateSettings({
                  holidayMode: event.target.value as AppearancePreferences['holidayMode'],
                })
              }
            >
              <option value="automatic">{t('Автоматически')}</option>
              <option value="manual">{t('Вручную')}</option>
            </select>
          </label>
          <label className="field">
            {t('Праздник')}
            <select
              aria-label={t('Праздник')}
              value={settings.manualHoliday}
              disabled={!settings.holidayEnabled || settings.holidayMode !== 'manual'}
              onChange={(event) =>
                updateSettings({ manualHoliday: event.target.value as HolidayId })
              }
            >
              {holidays.map((item) => (
                <option key={item.id} value={item.id}>
                  {t(item.name)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="appearance-current-holiday" role="status">
          {holiday && <span aria-hidden="true">{holiday.symbol}</span>}
          <span>
            {holiday
              ? t('Сейчас: {holiday}', { holiday: t(holiday.name) })
              : t('Без праздничного оформления')}
          </span>
        </div>
        <label className="appearance-switch-row">
          <span>{t('Праздничные анимации')}</span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.holidayAnimations}
            disabled={!settings.holidayEnabled}
            onChange={(event) => updateSettings({ holidayAnimations: event.target.checked })}
          />
        </label>
        <p className="muted small appearance-motion-note">
          {t('Анимации учитывают системную настройку уменьшения движения.')}
        </p>
      </div>
      <p className="muted small appearance-orientation-note">
        {t(
          'Ориентация следует повороту устройства. Навигация и карточки автоматически подстраиваются под экран.',
        )}
      </p>
    </section>
  );
}
