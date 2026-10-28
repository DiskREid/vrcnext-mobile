import { t, useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Download, Minus, Plus, RotateCcw } from 'lucide-react';
import { isNative, native } from '../api';
import { useSecureImage } from './SecureImage';
import { Modal } from './ui';
import './FullscreenImageViewer.css';

type View = { x: number; y: number; scale: number };
type Point = { x: number; y: number };
const fitted: View = { x: 0, y: 0, scale: 1 };

/** The modal stack handles Escape/Android Back; image gestures never close this screen. */
export function FullscreenImageViewer({
  src,
  originalUrl,
  title,
  onClose,
}: {
  src: string;
  originalUrl?: string;
  title: string;
  onClose: () => void;
}) {
  useI18n();
  const stage = useRef<HTMLDivElement>(null),
    image = useRef<HTMLImageElement>(null);
  const view = useRef<View>(fitted),
    frame = useRef<number | undefined>(undefined);
  const points = useRef(new Map<number, Point>());
  const gesture = useRef<{ view: View; points: Point[] } | undefined>(undefined);
  const [scale, setScale] = useState(1),
    [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(''),
    [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const live = useRef(true);
  const source = useSecureImage(originalUrl || src, true, retry, () => setFailed(true), 2048, true);
  const fallback = useSecureImage(src, src !== originalUrl, retry, undefined, 1024, true);
  function paint() {
    frame.current = undefined;
    if (image.current)
      image.current.style.transform = `translate(${view.current.x}px,${view.current.y}px) scale(${view.current.scale})`;
  }
  function change(next: View) {
    const element = stage.current,
      img = image.current;
    next.scale = Math.min(6, Math.max(1, next.scale));
    if (element && img?.naturalWidth) {
      const fit = Math.min(
        element.clientWidth / img.naturalWidth,
        element.clientHeight / img.naturalHeight,
      );
      const maxX = Math.max(0, (img.naturalWidth * fit * next.scale - element.clientWidth) / 2);
      const maxY = Math.max(0, (img.naturalHeight * fit * next.scale - element.clientHeight) / 2);
      next.x = Math.max(-maxX, Math.min(maxX, next.x));
      next.y = Math.max(-maxY, Math.min(maxY, next.y));
    }
    view.current = next;
    if (frame.current === undefined) frame.current = requestAnimationFrame(paint);
  }
  function reset() {
    change({ ...fitted });
    setScale(1);
  }
  useEffect(() => {
    live.current = true;
    const observer = new ResizeObserver(reset);
    if (stage.current) observer.observe(stage.current);
    return () => {
      live.current = false;
      observer.disconnect();
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, []);
  function begin() {
    gesture.current = { view: { ...view.current }, points: [...points.current.values()] };
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    begin();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic/cancelled pointer. */
    }
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!points.current.has(event.pointerId) || !gesture.current) return;
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const now = [...points.current.values()],
      start = gesture.current;
    if (now.length >= 2 && start.points.length >= 2) {
      const distance = Math.hypot(now[1].x - now[0].x, now[1].y - now[0].y);
      const before = Math.hypot(
        start.points[1].x - start.points[0].x,
        start.points[1].y - start.points[0].y,
      );
      if (before < 1) return;
      const rect = event.currentTarget.getBoundingClientRect(),
        center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const factor =
        Math.min(6, Math.max(1, (start.view.scale * distance) / before)) / start.view.scale;
      const a = {
        x: (start.points[0].x + start.points[1].x) / 2,
        y: (start.points[0].y + start.points[1].y) / 2,
      };
      const b = { x: (now[0].x + now[1].x) / 2, y: (now[0].y + now[1].y) / 2 };
      change({
        scale: start.view.scale * factor,
        x: b.x - center.x - (a.x - center.x - start.view.x) * factor,
        y: b.y - center.y - (a.y - center.y - start.view.y) * factor,
      });
    } else if (now.length === 1 && start.points.length === 1)
      change({
        scale: start.view.scale,
        x: start.view.x + now[0].x - start.points[0].x,
        y: start.view.y + now[0].y - start.points[0].y,
      });
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    points.current.delete(event.pointerId);
    if (points.current.size) begin();
    else gesture.current = undefined;
    setScale(view.current.scale);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  async function download() {
    if (!originalUrl || saving || !isNative) return;
    setSaving(true);
    setMessage('');
    try {
      const result = await native.downloadImage({ url: originalUrl, fileName: title });
      if (live.current)
        setMessage(
          result.saved
            ? t('Оригинал сохранён в галерею · Pictures/VRCNext')
            : t('Изображение не сохранено'),
        );
    } catch (error) {
      if (live.current)
        setMessage(error instanceof Error ? error.message : t('Не удалось сохранить оригинал'));
    } finally {
      if (live.current) setSaving(false);
    }
  }
  return (
    <Modal
      title={t('Изображение · {p0}', { p0: String(title) })}
      onClose={onClose}
      className="fullscreen-image-viewer"
      closeOnBackdrop={false}
    >
      <div className="image-viewer-tools">
        <button
          className="icon-button"
          aria-label={t('Увеличить изображение')}
          onClick={() => {
            change({ ...view.current, scale: view.current.scale * 1.5 });
            setScale(view.current.scale);
          }}
        >
          <Plus size={20} />
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button
          className="icon-button"
          aria-label={t('Уменьшить изображение')}
          onClick={() => {
            change({ ...view.current, scale: view.current.scale / 1.5 });
            setScale(view.current.scale);
          }}
        >
          <Minus size={20} />
        </button>
        <button className="icon-button" aria-label={t('Вписать изображение')} onClick={reset}>
          <RotateCcw size={18} />
        </button>
        <button
          className="button secondary compact image-viewer-download"
          disabled={!originalUrl || !isNative || saving}
          onClick={() => void download()}
        >
          <Download size={18} />
          {saving ? t('Скачивание…') : t('Скачать оригинал')}
        </button>
      </div>
      <div
        ref={stage}
        className="image-viewer-stage"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {(source || fallback) && (
          <img
            ref={image}
            src={source || fallback}
            alt={title}
            draggable={false}
            onLoad={() => {
              if (source) setFailed(false);
              paint();
            }}
            onError={() => setFailed(true)}
          />
        )}
        {!source && !fallback && !failed && <p role="status">{t('Загрузка изображения…')}</p>}
      </div>
      <div className="image-viewer-status" aria-live="polite">
        {failed && (
          <p>
            {t('Не удалось загрузить полный размер. ')}
            <button
              className="text-button"
              onClick={() => {
                setFailed(false);
                setRetry((value) => value + 1);
              }}
            >
              {t('Повторить')}
            </button>
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {!originalUrl && <p>{t('VRChat не передал оригинал. Доступно только превью.')}</p>}
        {!isNative && <p>{t('Сохранение в галерею доступно в Android-приложении.')}</p>}
      </div>
    </Modal>
  );
}
