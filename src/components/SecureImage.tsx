import { useContext, useEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes } from 'react';
import { isNative, native } from '../api';
import { ImagePreviewCache } from '../data/image-cache';
import { AppContext } from '../state';
const images = new ImagePreviewCache();
function isProtectedImage(src: string) {
  try {
    const u = new URL(src);
    return (
      u.protocol === 'https:' &&
      [
        'api.vrchat.cloud',
        'api.vrchat.com',
        'vrchat.com',
        'cloud.vrchat.com',
        'files.vrchat.cloud',
        'file-variants.vrchat.com',
        'assets.vrchat.com',
      ].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
/** Image bytes cross the bridge; authentication cookies stay in the native transport. */
export function useSecureImage(
  src: string | undefined,
  enabled = true,
  refreshKey: string | number = 0,
  onLoadError?: () => void,
  maxDimension = 1024,
  retainLoaded = false,
) {
  const protectedImage = !!src && isNative && isProtectedImage(src);
  const [image, setImage] = useState<{ src: string; data: string }>();
  const failure = useRef(onLoadError);
  failure.current = onLoadError;
  useEffect(() => {
    if (!enabled) {
      if (!retainLoaded) setImage(undefined);
      return;
    }
    if (!src || !protectedImage) return;
    let live = true;
    const pending = images.load(`${maxDimension}:${src}`, () => native.loadImage({ url: src, maxDimension }).then((result) => result.dataUrl), () => live);
    pending
      .then((data) => {
        if (live) setImage({ src, data });
      })
      .catch(() => {
        if (live) {
          setImage({ src, data: '' });
          failure.current?.();
        }
      });
    return () => {
      live = false;
    };
  }, [src, enabled, protectedImage, refreshKey, maxDimension, retainLoaded]);
  return !protectedImage ? src : (enabled || retainLoaded) && image?.src === src ? image.data : undefined;
}
export function clearImageCache() {
  images.clear();
}
export default function SecureImage({
  src,
  loading = 'lazy',
  refreshKey = 0,
  onLoadError,
  retainLoaded = false,
  maxDimension = 1024,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  /** Failed visible media gets one bounded retry; refreshKey supports an explicit retry. */
  refreshKey?: string | number;
  onLoadError?: () => void;
  retainLoaded?: boolean;
  maxDimension?: number;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const active = useContext(AppContext)?.pageActive !== false;
  const [visible, setVisible] = useState(loading === 'eager');
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const failures = useRef(0);
  const errorCallback = useRef(onLoadError); errorCallback.current = onLoadError;
  useEffect(() => { failures.current = 0; setAttempt(0); clearTimeout(timer.current); return () => clearTimeout(timer.current); }, [src, refreshKey]);
  const failed = () => {
    errorCallback.current?.();
    if (!visible || failures.current >= 1) return;
    failures.current++;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAttempt((value) => value + 1), 3000);
  };
  useEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    if (loading === 'eager') {
      setVisible(true);
      return;
    }
    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const inView = entries.some((e) => e.isIntersecting);
        setVisible((previous) => retainLoaded ? previous || inView : inView);
        if (retainLoaded && inView) observer.disconnect();
      },
      { rootMargin: '240px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading, src, refreshKey, retainLoaded, attempt, active]);
  const resolved = useSecureImage(src, visible && active, `${refreshKey}:${attempt}`, failed, maxDimension, retainLoaded);
  return (
    <img
      key={`${src}:${refreshKey}:${attempt}`}
      ref={ref}
      {...props}
      src={resolved || undefined}
      loading={loading}
      onError={(event) => {
        failed();
        props.onError?.(event);
      }}
    />
  );
}
