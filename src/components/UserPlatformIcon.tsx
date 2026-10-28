import { t, useI18n } from '../i18n';
import { CircleHelp, Globe2, Monitor, Smartphone } from 'lucide-react';
import { userPlatformInfo } from '../data/user-platform';
import './UserPlatformIcon.css';

export function UserPlatformIcon({
  value,
  context,
}: {
  value: unknown;
  context: 'current' | 'last';
}) {
  useI18n();
  const platform = userPlatformInfo(value);
  if (!platform) return null;
  const label = `${context === 'last' ? t('Последняя платформа') : t('Текущая платформа')}: ${t(platform.label)}`;
  const title = platform.id === 'unknown' ? `${label} (${platform.raw.slice(0, 80)})` : label;
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  return (
    <span
      className={`user-platform-icon user-platform-${platform.id}`}
      role="img"
      aria-label={label}
      title={title}
    >
      {platform.id === 'pc' ? (
        <Monitor size={20} aria-hidden="true" />
      ) : platform.id === 'android' ? (
        <svg {...common}>
          <path d="M7 3 5.5 1.5M17 3l1.5-1.5M5 9a7 7 0 0 1 14 0H5ZM5 12v6h14v-6M8 18v4M16 18v4M2 12v5M22 12v5" />
          <path d="M8.5 6h.01M15.5 6h.01" strokeWidth="2.4" />
        </svg>
      ) : platform.id === 'ios' ? (
        <Smartphone size={20} aria-hidden="true" />
      ) : platform.id === 'vr' ? (
        <svg {...common}>
          <path d="M3 8V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2M3 8h18a1 1 0 0 1 1 1v8a3 3 0 0 1-3 3h-3l-4-3-4 3H5a3 3 0 0 1-3-3V9a1 1 0 0 1 1-1Z" />
          <path d="M6 12h3v3H6zM15 12h3v3h-3z" />
        </svg>
      ) : platform.id === 'web' ? (
        <Globe2 size={20} aria-hidden="true" />
      ) : (
        <CircleHelp size={20} aria-hidden="true" />
      )}
    </span>
  );
}
