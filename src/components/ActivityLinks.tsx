import { t, useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Globe2, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { demoWorlds } from '../demo';
import { useApp } from '../state';
import {
  ActivityWorldCache,
  activityLocationLabel,
  activityWorldId,
} from '../data/activity-worlds';
import { instanceType } from '../data/locations';
import type { ActivityWorldLabel } from '../data/activity-worlds';
import './ActivityLinks.css';

const worlds = new ActivityWorldCache();

function ActivityLocation({ value, worldId }: { value?: string; worldId?: string }) {
  useI18n();
  const ctx = useApp();
  const id = activityWorldId(value) || (value === undefined ? activityWorldId(worldId) : undefined);
  const anchor = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false),
    [world, setWorld] = useState<ActivityWorldLabel>();
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0);
  const forceConsumed = useRef(0);
  const demoWorld = ctx.demo ? demoWorlds.find((item) => item.id === id) : undefined;
  useEffect(() => {
    if (!id || ctx.pageActive === false) return;
    const element = anchor.current;
    if (!element) return;
    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries.some((entry) => entry.isIntersecting));
      },
      { rootMargin: '120px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [id, ctx.pageActive]);
  useEffect(() => {
    if (!id || ctx.demo || !visible || ctx.pageActive === false) return;
    let live = true;
    setLoading(true);
    setError('');
    const force = retry > forceConsumed.current;
    forceConsumed.current = retry;
    worlds
      .load(
        ctx.user.id,
        id,
        () => api.world(id),
        () => live,
        force,
      )
      .then((value) => {
        if (live) setWorld(value);
      })
      .catch((failure) => {
        if (live)
          setError(failure instanceof Error ? failure.message : t('Название мира недоступно.'));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id, ctx.user.id, ctx.demo, visible, ctx.pageActive, retry]);
  if (!id)
    return <span className="activity-location-value muted">{t(activityLocationLabel(value))}</span>;
  const name = demoWorld?.name || (world?.id === id ? world.name : id);
  return (
    <span className="activity-location-value" ref={anchor}>
      <button
        className="text-button activity-world-link"
        onClick={() => ctx.openWorld(id)}
        aria-label={t('Открыть мир {p0}', { p0: String(name) })}
      >
        <Globe2 size={14} />
        <span>{name}</span>
        <ArrowUpRight size={13} />
      </button>
      {value?.includes(':') && (
        <small className="muted activity-instance-id">
          {t('Инстанс ')}
          {value.slice(value.indexOf(':') + 1).split('~')[0]} · {instanceType(value)}
        </small>
      )}
      {loading && world?.id !== id && (
        <small className="muted" role="status">
          {t('Загрузка названия мира…')}
        </small>
      )}
      {error && (
        <span className="activity-world-error">
          <small role="status">
            {t('Название мира недоступно: ')}
            {error}
          </small>
          <button
            className="text-button"
            onClick={() => setRetry((value) => value + 1)}
            aria-label={t('Повторить загрузку названия мира {p0}', { p0: String(id) })}
          >
            <RefreshCw size={13} />
            {t('Повторить')}
          </button>
        </span>
      )}
    </span>
  );
}

/** Real old/new locations remain distinguishable, including transitions into a hidden place. */
export function ActivityWorldChange({
  before,
  after,
  worldId,
}: {
  before?: string;
  after?: string;
  worldId?: string;
}) {
  useI18n();
  if (before === undefined && after === undefined && !activityWorldId(worldId)) return null;
  return (
    <div className="activity-location-change" aria-label={t('Изменение местоположения')}>
      {before !== undefined && (
        <div>
          <small className="muted activity-location-label">{t('Было')}</small>
          <ActivityLocation value={before} />
        </div>
      )}
      <div>
        <small className="muted activity-location-label">
          {before !== undefined ? t('Стало') : t('Мир')}
        </small>
        <ActivityLocation value={after} worldId={worldId} />
      </div>
    </div>
  );
}
