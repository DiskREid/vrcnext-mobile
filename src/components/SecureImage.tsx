import { useEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes } from 'react';
import { isNative, native } from '../api';
const images = new Map<string, Promise<string>>();
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
export function useSecureImage(src: string | undefined, enabled = true) {
  const protectedImage = !!src && isNative && isProtectedImage(src);
  const [image, setImage] = useState<{ src: string; data: string }>();
  useEffect(() => {
    if (!enabled) {
      setImage(undefined);
      return;
    }
    if (!src || !protectedImage) return;
    let live = true;
    let pending = images.get(src);
    if (!pending) {
      pending = native.loadImage({ url: src }).then((r) => {
        // Keep large animated sources only in visible views; bound the shared JS cache.
        if (r.dataUrl.length > 400_000 && images.get(src) === pending) images.delete(src);
        return r.dataUrl;
      });
      images.set(src, pending);
      if (images.size > 24) images.delete(images.keys().next().value!);
      const key = src;
      pending.catch(() => {
        if (images.get(key) === pending) images.delete(key);
      });
    }
    pending
      .then((data) => {
        if (live) setImage({ src, data });
      })
      .catch(() => {
        if (live) setImage({ src, data: '' });
      });
    return () => {
      live = false;
    };
  }, [src, enabled, protectedImage]);
  return !protectedImage ? src : enabled && image?.src === src ? image.data : undefined;
}
export function clearImageCache() {
  images.clear();
}
export default function SecureImage({
  src,
  loading = 'lazy',
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const ref = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(loading === 'eager');
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
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
        setVisible(entries.some((e) => e.isIntersecting));
      },
      { rootMargin: '240px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading, src]);
  const resolved = useSecureImage(src, visible);
  return <img ref={ref} {...props} src={resolved || undefined} loading={loading} />;
}
