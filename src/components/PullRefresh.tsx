import { useRef, useState } from 'react';
import type { ReactNode, TouchEvent, RefObject } from 'react';
import { RefreshCw } from 'lucide-react';

/** Observe a deliberate vertical pull only at the very top; horizontal controls keep their gesture. */
export default function PullRefresh({ children, onRefresh, mainRef }: { children: ReactNode; onRefresh: () => void; mainRef: RefObject<HTMLElement | null> }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [distance, setDistance] = useState(0);
  const move = (e: TouchEvent<HTMLElement>) => {
    if (!start.current || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - start.current.x;
    const dy = e.touches[0].clientY - start.current.y;
    if (e.currentTarget.scrollTop > 0 || Math.abs(dx) > 28 || dy < 0) {
      start.current = null; setDistance(0); return;
    }
    setDistance(Math.min(90, dy / 2));
  };
  return <main ref={mainRef} className="main-content" id="main-content"
    onTouchStart={(e) => { start.current = e.currentTarget.scrollTop <= 0 && e.touches.length === 1 && !(e.target as HTMLElement).closest('input,textarea,select,button,svg') ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }}
    onTouchMove={move} onTouchCancel={() => { start.current = null; setDistance(0); }}
    onTouchEnd={() => { if (distance >= 65) onRefresh(); start.current = null; setDistance(0); }}>
    {distance > 10 && <div className="pull-refresh" role="status"><RefreshCw size={18} style={{ transform: `rotate(${distance * 4}deg)` }} />{distance >= 65 ? 'Отпустите для обновления' : 'Потяните для обновления'}</div>}
    {children}
  </main>;
}
