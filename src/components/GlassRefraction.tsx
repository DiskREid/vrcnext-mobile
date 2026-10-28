import { useLayoutEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useAppearance } from '../data/appearance';
import { createGlassDisplacementMap } from '../data/glass-optics';
import type { GlassIntensity } from '../data/appearance';
import './GlassRefraction.css';

interface Lens {
  id: string;
  width: number;
  height: number;
  scale: number;
  image: string;
  modal?: {
    element: HTMLElement;
    backdrop: HTMLElement;
    left: number;
    top: number;
    radius: string;
  };
}
let sequence = 0;
const imageCache = new Map<string, Pick<Lens, 'image' | 'scale'>>();

/** URL backdrop filters are a Blink feature; parsing support alone also matches WebKit. */
export function supportsGlassRefraction(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /\b(?:Chrome|HeadlessChrome|Chromium|Edg)\/(\d+)/.test(navigator.userAgent) &&
    typeof SVGFEImageElement !== 'undefined' &&
    typeof SVGFEDisplacementMapElement !== 'undefined' &&
    typeof CSS !== 'undefined' &&
    (CSS.supports('backdrop-filter', 'url("#vrc-glass-probe")') ||
      CSS.supports('-webkit-backdrop-filter', 'url("#vrc-glass-probe")'))
  );
}
function mapImage(width: number, height: number, radius: number, intensity: GlassIntensity) {
  const key = `${width}:${height}:${radius}:${intensity}`;
  const existing = imageCache.get(key);
  if (existing) return existing;
  const map = createGlassDisplacementMap({ width, height, radius, intensity });
  const canvas = document.createElement('canvas');
  canvas.width = map.pixelWidth;
  canvas.height = map.pixelHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const pixels = context.createImageData(map.pixelWidth, map.pixelHeight);
  pixels.data.set(map.pixels);
  context.putImageData(pixels, 0, 0);
  const result = { image: canvas.toDataURL('image/png'), scale: map.scale };
  imageCache.set(key, result);
  if (imageCache.size > 16) imageCache.delete(imageCache.keys().next().value!);
  return result;
}
const visible = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  return (
    rect.width > 16 &&
    rect.height > 16 &&
    !element.closest('[hidden]') &&
    getComputedStyle(element).visibility !== 'hidden'
  );
};

/** Geometry is updated on layout changes, never by an animation or polling loop. */
export default function GlassRefraction() {
  const { settings, effects } = useAppearance();
  const enabled = settings.theme !== 'standard-dark' && effects === 'full';
  const [lenses, setLenses] = useState<Lens[]>([]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!enabled || !supportsGlassRefraction()) {
      root.dataset.glassRefraction = 'fallback';
      setLenses((previous) => (previous.length ? [] : previous));
      return () => {
        delete root.dataset.glassRefraction;
      };
    }
    const assigned = new Map<HTMLElement, { id: string; key: string; lens: Lens }>();
    let frame = 0;
    let layoutDirty = true;
    let underlay: HTMLElement | null = null;
    const resetUnderlay = () => {
      if (!underlay) return;
      delete underlay.dataset.glassUnderlay;
      for (const name of [
        '--lens-prefix',
        '--lens-footer',
        '--lens-padding-top',
        '--lens-padding-bottom',
      ])
        underlay.style.removeProperty(name);
      underlay = null;
    };
    const updateUnderlay = (active: boolean) => {
      if (!active) {
        resetUnderlay();
        layoutDirty = true;
        return;
      }
      if (!layoutDirty) return;
      const workspace = document.querySelector<HTMLElement>('.workspace');
      const main = workspace?.querySelector<HTMLElement>(':scope > .main-content');
      if (!workspace || !main) return;
      layoutDirty = false;
      const scrollTop = main.scrollTop;
      delete workspace.dataset.glassUnderlay;
      const style = getComputedStyle(main);
      const prefix = Math.max(
        0,
        main.getBoundingClientRect().top - workspace.getBoundingClientRect().top,
      );
      const nav = workspace.querySelector<HTMLElement>(':scope > .bottom-nav');
      const footer = nav && visible(nav) ? nav.getBoundingClientRect().height : 0;
      for (const child of workspace.children) {
        if (child === main) break;
        if (child instanceof HTMLElement && getComputedStyle(child).position !== 'absolute')
          resize.observe(child);
      }
      workspace.style.setProperty('--lens-prefix', `${prefix}px`);
      workspace.style.setProperty('--lens-footer', `${footer}px`);
      workspace.style.setProperty('--lens-padding-top', style.paddingTop);
      workspace.style.setProperty('--lens-padding-bottom', style.paddingBottom);
      workspace.dataset.glassUnderlay = 'on';
      underlay = workspace;
      if (Math.abs(main.scrollTop - scrollTop) > 0.5)
        main.scrollTo({ top: scrollTop, behavior: 'instant' });
    };
    const clear = (element: HTMLElement) => {
      element.removeAttribute('data-glass-optic');
      element.removeAttribute('data-glass-surface-host');
      element.removeAttribute('data-glass-surface-ready');
      element.style.removeProperty('--glass-lens-filter');
      assigned.delete(element);
      resize.unobserve(element);
    };
    const schedule = () => {
      if (document.visibilityState === 'hidden' || root.dataset.appActive === 'false') {
        cancelAnimationFrame(frame);
        frame = 0;
        sync();
        return;
      }
      if (!frame) frame = requestAnimationFrame(sync);
    };
    const resize = new ResizeObserver(() => {
      layoutDirty = true;
      schedule();
    });
    const sync = () => {
      frame = 0;
      const active = document.visibilityState !== 'hidden' && root.dataset.appActive !== 'false';
      const capable = enabled && supportsGlassRefraction();
      updateUnderlay(capable && active);
      const candidates: HTMLElement[] = [];
      if (capable && active) {
        const modals = [...document.querySelectorAll<HTMLElement>('.modal')].filter(visible);
        const focused = document.activeElement?.closest<HTMLElement>('.modal');
        const modal =
          focused && modals.includes(focused)
            ? focused
            : modals
                .sort((a, b) => {
                  const z = (element: HTMLElement) =>
                    parseInt(
                      getComputedStyle(element.closest('.modal-backdrop') || element).zIndex,
                    ) || 0;
                  return z(a) - z(b);
                })
                .pop();
        if (modal) {
          if (!modal.matches('.fullscreen-network, .fullscreen-image-viewer'))
            candidates.push(modal);
        } else {
          candidates.push(
            ...document.querySelectorAll<HTMLElement>(
              '.topbar, .bottom-nav, .retained-screen:not([hidden]) .hero, .retained-screen:not([hidden]) .dashboard-stats > button:nth-child(-n + 2)',
            ),
          );
        }
      }
      const targets = candidates.filter(visible).slice(0, 5);
      const selected = new Set(targets);
      for (const element of assigned.keys()) if (!selected.has(element)) clear(element);
      const next: Lens[] = [];
      for (const element of targets) {
        // A scrolling/sticky panel must never be the SVG backdrop-filter target.
        // WebView can otherwise leave an opaque rectangular filter tile inside it.
        const modal = element.matches('.modal')
          ? element.closest<HTMLElement>('.modal-backdrop')
          : null;
        if (modal) element.dataset.glassSurfaceHost = 'true';
        const rect = element.getBoundingClientRect();
        const inset = element.classList.contains('hero') ? 12 : 0;
        const width = Math.max(16, Math.round(rect.width - inset * 2));
        const height = Math.max(16, Math.round(rect.height - inset * 2));
        const radius = Math.max(
          0,
          Math.round(parseFloat(getComputedStyle(element).borderTopLeftRadius) - inset),
        );
        const borderRadius = getComputedStyle(element).borderRadius;
        const position = modal
          ? `:${Math.round(rect.left)}:${Math.round(rect.top)}:${borderRadius}`
          : '';
        const key = `${width}:${height}:${radius}:${settings.glassIntensity}${position}`;
        const previous = assigned.get(element);
        if (previous?.key === key) {
          next.push(previous.lens);
          continue;
        }
        try {
          const image = mapImage(width, height, radius, settings.glassIntensity);
          if (!image) {
            clear(element);
            continue;
          }
          const id = previous?.id || `vrc-glass-${++sequence}`;
          const lens: Lens = {
            id,
            width,
            height,
            ...image,
            ...(modal
              ? {
                  modal: {
                    element,
                    backdrop: modal,
                    left: rect.left,
                    top: rect.top,
                    radius: borderRadius,
                  },
                }
              : {}),
          };
          assigned.set(element, { id, key, lens });
          if (!modal) {
            element.dataset.glassOptic = id;
            element.style.setProperty('--glass-lens-filter', `url("#${id}")`);
          }
          resize.observe(element);
          next.push(lens);
        } catch {
          clear(element);
        }
      }
      root.dataset.glassRefraction = next.length ? 'on' : capable ? 'idle' : 'fallback';
      setLenses((previous) =>
        previous.length === next.length && previous.every((lens, index) => lens === next[index])
          ? previous
          : next,
      );
    };
    const dom = new MutationObserver((records) => {
      if (records.some((record) => record.target === underlay && record.type === 'childList'))
        layoutDirty = true;
      schedule();
    });
    dom.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'class', 'data-screen'],
    });
    const activity = new MutationObserver(schedule);
    activity.observe(root, { attributes: true, attributeFilter: ['data-app-active'] });
    document.addEventListener('visibilitychange', schedule);
    document.addEventListener('focusin', schedule);
    const resized = () => {
      layoutDirty = true;
      schedule();
    };
    window.addEventListener('resize', resized);
    const workspace = document.querySelector<HTMLElement>('.workspace');
    if (workspace) resize.observe(workspace);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      dom.disconnect();
      activity.disconnect();
      resize.disconnect();
      document.removeEventListener('visibilitychange', schedule);
      document.removeEventListener('focusin', schedule);
      window.removeEventListener('resize', resized);
      for (const element of assigned.keys()) clear(element);
      resetUnderlay();
      delete root.dataset.glassRefraction;
    };
  }, [enabled, settings.glassIntensity]);
  return (
    <>
      <svg
        data-glass-optics-defs=""
        width="0"
        height="0"
        aria-hidden="true"
        focusable="false"
        style={{ position: 'absolute', pointerEvents: 'none' }}
      >
        <defs>
          {lenses.map((lens) => (
            <filter
              key={lens.id}
              id={lens.id}
              x="0"
              y="0"
              width={lens.width}
              height={lens.height}
              filterUnits="userSpaceOnUse"
              primitiveUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
            >
              <feImage
                href={lens.image}
                x="0"
                y="0"
                width={lens.width}
                height={lens.height}
                preserveAspectRatio="none"
                result="normal-map"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="normal-map"
                scale={lens.scale}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          ))}
        </defs>
      </svg>
      {lenses.map((lens) =>
        lens.modal
          ? createPortal(
              <div
                key={lens.id}
                className="glass-modal-surface"
                data-glass-optic={lens.id}
                aria-hidden="true"
                ref={(node) => {
                  if (node) lens.modal!.element.dataset.glassSurfaceReady = 'true';
                  else delete lens.modal!.element.dataset.glassSurfaceReady;
                }}
                style={
                  {
                    position: 'fixed',
                    pointerEvents: 'none',
                    zIndex: 0,
                    left: lens.modal.left,
                    top: lens.modal.top,
                    width: lens.width,
                    height: lens.height,
                    borderRadius: lens.modal.radius,
                    '--glass-lens-filter': `url("#${lens.id}")`,
                  } as CSSProperties
                }
              />,
              lens.modal.backdrop,
              lens.id,
            )
          : null,
      )}
    </>
  );
}
