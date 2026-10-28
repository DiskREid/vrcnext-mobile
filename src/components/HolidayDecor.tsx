import { memo, useId, useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useAppearance } from '../data/appearance';
import type { HolidayId } from '../data/holiday-calendar';
import { holidayDecorLayout } from '../data/holiday-decor-layout';
import './HolidayDecor.css';

type Ornament =
  | 'heart'
  | 'tulip'
  | 'flower'
  | 'clover'
  | 'coin'
  | 'egg'
  | 'leaf'
  | 'earth'
  | 'pumpkin'
  | 'bat'
  | 'snow'
  | 'star'
  | 'bauble';
const ornaments: Record<HolidayId, readonly Ornament[]> = {
  valentine: ['heart', 'heart', 'heart', 'heart', 'heart', 'star'],
  'womens-day': ['tulip', 'flower', 'tulip', 'flower', 'tulip', 'flower'],
  'st-patrick': ['clover', 'coin', 'clover', 'star', 'clover', 'coin'],
  easter: ['egg', 'flower', 'egg', 'flower', 'egg', 'star'],
  'earth-day': ['leaf', 'earth', 'leaf', 'star', 'leaf', 'earth'],
  halloween: ['pumpkin', 'bat', 'pumpkin', 'bat', 'star', 'bat'],
  christmas: ['snow', 'star', 'snow', 'bauble', 'snow', 'snow'],
};
// One seed per page lifetime; switching a setting never reshuffles the background.
const sessionSeed = Math.floor(Math.random() * 4294967296);

function OrnamentImage({ kind }: { kind: Ornament }) {
  const toneId = `holiday-tone-${useId().replace(/:/g, '')}`;
  let shape: ReactNode;
  switch (kind) {
    case 'heart':
      shape = <path d="M16 28 4.5 17.2C-4 8.8 8.2-.7 16 8.4 23.8-.7 36 8.8 27.5 17.2Z" />;
      break;
    case 'tulip':
      shape = (
        <>
          <path
            className="holiday-decor-leaf"
            d="M15 31V16h2v15zM15 27C7 28 4 24 4 20c6 0 9 2 11 7M17 25c7 1 10-2 11-7-6 0-9 2-11 7"
          />
          <path d="M6 4c4 1 5 3 6 5l4-8 4 8c1-2 3-4 6-5 0 10-3 15-10 15S6 14 6 4" />
        </>
      );
      break;
    case 'flower':
      shape = (
        <>
          <circle cx="16" cy="7" r="6" />
          <circle cx="25" cy="13" r="6" />
          <circle cx="22" cy="24" r="6" />
          <circle cx="10" cy="24" r="6" />
          <circle cx="7" cy="13" r="6" />
          <circle className="holiday-decor-gold" cx="16" cy="16" r="5" />
        </>
      );
      break;
    case 'clover':
      shape = (
        <>
          <path d="M15 17h3c0 8-2 11-5 14l-2-2c3-3 4-6 4-12" />
          <path d="M16 16C-2 16 1-1 9 2c7-6 11 4 7 14M16 16C16-2 33 1 30 9c6 7-4 11-14 7M16 16c18 0 15 17 7 14-7 6-11-4-7-14M16 16c0 18-17 15-14 7-6-7 4-11 14-7" />
        </>
      );
      break;
    case 'coin':
      shape = (
        <>
          <circle className="holiday-decor-gold" cx="16" cy="16" r="13" />
          <circle className="holiday-decor-outline" cx="16" cy="16" r="9" />
          <path className="holiday-decor-outline" d="M16 10v12m-3-9 3-3 3 3" />
        </>
      );
      break;
    case 'egg':
      shape = (
        <>
          <path d="M16 1C10 1 3 15 3 22c0 13 26 13 26 0C29 15 22 1 16 1" />
          <path className="holiday-decor-stripe" d="m6 14 5 3 5-3 5 3 5-3M4 23l6 3 6-3 6 3 6-3" />
          <circle className="holiday-decor-gold" cx="16" cy="8" r="2" />
        </>
      );
      break;
    case 'leaf':
      shape = (
        <>
          <path d="M29 2C10 0-1 8 3 21c4 12 22 14 26-19" />
          <path className="holiday-decor-outline" d="m3 30 19-21M11 21l1-9m5 3 8 1" />
        </>
      );
      break;
    case 'earth':
      shape = (
        <>
          <circle cx="16" cy="16" r="14" />
          <path
            className="holiday-decor-leaf"
            d="m11 3 1 5-4 5-5-1 1 8 5 1 3 9 5-4 1-8-6-5 5-3 6 2 6-2-4-6-8-2zM25 22l4-2-1 6-4 3-2-4z"
          />
        </>
      );
      break;
    case 'pumpkin':
      shape = (
        <>
          <path className="holiday-decor-leaf" d="m15 8-2-6 5-1 1 6 5-2 1 3-7 3" />
          <ellipse cx="10" cy="19" rx="9" ry="11" />
          <ellipse cx="22" cy="19" rx="9" ry="11" />
          <ellipse cx="16" cy="19" rx="8" ry="12" />
          <path
            className="holiday-decor-face"
            d="m7 18 5-5 2 6zm18 0-5-5-2 6zM8 23l5 2 3-2 3 2 5-2-2 5H10z"
          />
        </>
      );
      break;
    case 'bat':
      shape = (
        <path d="M1 6c7 2 8 7 10 7l2-6 3 3 3-3 2 6c2 0 3-5 10-7-1 5-1 9 0 13-4-2-7-1-8 3-4-4-4 3-7 5-3-2-3-9-7-5-1-4-4-5-8-3 1-4 1-8 0-13" />
      );
      break;
    case 'snow':
      shape = (
        <path
          className="holiday-decor-snow"
          d="M16 1v30M3 8l26 16M3 24 29 8M11 4l5 5 5-5M11 28l5-5 5 5M3 14l7-1-1-7m22 12-9 1 1 7M3 18l7 1-1 7m22-12-9-1 1-7"
        />
      );
      break;
    case 'star':
      shape = (
        <path d="m16 1 4.5 9.4L31 12l-7.5 7.3L25.3 30 16 24.8 6.7 30l1.8-10.7L1 12l10.5-1.6z" />
      );
      break;
    case 'bauble':
      shape = (
        <>
          <path className="holiday-decor-outline" d="M16 0v6" />
          <path className="holiday-decor-gold" d="M11 5h10v6H11z" />
          <circle cx="16" cy="21" r="11" />
          <path className="holiday-decor-stripe" d="M6 19c7 5 13 5 20 0M9 28l14-13" />
        </>
      );
      break;
  }
  return (
    <svg viewBox="0 0 32 32" focusable="false" aria-hidden="true">
      <defs>
        <linearGradient id={toneId} x1="5" y1="0" x2="27" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--decor-secondary)" />
          <stop offset=".36" stopColor="var(--decor-primary)" />
          <stop offset="1" stopColor="var(--decor-deep)" />
        </linearGradient>
      </defs>
      <g
        fill={`url(#${toneId})`}
        stroke="var(--decor-rim)"
        strokeWidth=".35"
        strokeLinejoin="round"
      >
        {shape}
      </g>
      {kind !== 'snow' && kind !== 'bat' && (
        <path className="holiday-decor-glint" d="M7 13c1-5 4-7 8-7" />
      )}
    </svg>
  );
}

function Garland() {
  return (
    <svg
      className="holiday-decor-garland"
      viewBox="0 0 240 50"
      focusable="false"
      aria-hidden="true"
    >
      <path d="M0 4q120 58 240 0" fill="none" stroke="currentColor" strokeWidth="1.2" />
      {[18, 58, 98, 138, 178, 218].map((x, index) => (
        <g
          key={x}
          transform={`translate(${x} ${index === 0 || index === 5 ? 12 : index === 1 || index === 4 ? 24 : 30})`}
        >
          <path d="M0 0v5" stroke="currentColor" />
          <ellipse className={index % 2 ? 'holiday-decor-gold' : ''} cy="9" rx="3.2" ry="5" />
        </g>
      ))}
    </svg>
  );
}

function SpiderWeb() {
  return (
    <svg className="holiday-decor-web" viewBox="0 0 100 100" focusable="false" aria-hidden="true">
      <path d="M100 0H0m100 0L0 100M100 0v100M100 0 58 100M100 0 0 42M0 21q13 8 21 21 16 0 30 10 0 17 10 30 18 1 39 10M0 43q12 5 18 15 18 0 29 11 2 15 10 25M0 68q6 2 8 9 13 0 18 10" />
    </svg>
  );
}

/** Decorative SVGs stay outside hit testing; their only motion is bounded CSS transform/opacity. */
function HolidayDecor({ area = 'ambient' }: { area?: 'ambient' | 'hero' }) {
  const { activeHoliday, effects } = useAppearance();
  const placements = useMemo(
    () => (activeHoliday ? holidayDecorLayout(activeHoliday, area, sessionSeed) : []),
    [activeHoliday, area],
  );
  if (!activeHoliday) return null;
  const count =
    area === 'ambient' ? (effects === 'reduced' ? 2 : 8) : effects === 'reduced' ? 3 : 4;
  return (
    <div
      className={`holiday-decor holiday-decor--${area} holiday-decor--${activeHoliday}`}
      aria-hidden="true"
    >
      {placements.slice(0, count).map((piece, index) => (
        <span
          className={`holiday-decor-piece holiday-decor-piece--${index} holiday-decor-piece--${ornaments[activeHoliday][index % ornaments[activeHoliday].length]}`}
          key={index}
          style={
            {
              '--piece-index': index,
              '--piece-x': `${piece.x}%`,
              '--piece-y': `${piece.y}%`,
              '--piece-size': `${piece.size}px`,
              '--piece-rotation': `${piece.rotation}deg`,
              '--piece-alpha': piece.opacity,
              '--piece-duration': `${piece.duration}s`,
              '--piece-delay': `${piece.delay}s`,
              '--piece-drift': `${piece.drift}px`,
            } as CSSProperties
          }
        >
          <OrnamentImage kind={ornaments[activeHoliday][index % ornaments[activeHoliday].length]} />
        </span>
      ))}
      {area === 'hero' && activeHoliday === 'christmas' && <Garland />}
      {area === 'hero' && activeHoliday === 'halloween' && <SpiderWeb />}
    </div>
  );
}
export default memo(HolidayDecor);
