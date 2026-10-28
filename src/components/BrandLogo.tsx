import { useState } from 'react';
import { useAppearance } from '../data/appearance';
import './BrandLogo.css';

export default function BrandLogo({
  className = '',
  alt = '',
}: {
  className?: string;
  alt?: string;
}) {
  const { activeHoliday } = useAppearance();
  const variant = activeHoliday || 'standard';
  const source = `/branding/${variant}.png`;
  const [failed, setFailed] = useState('');
  return (
    <img
      className={`brand-logo ${className}`.trim()}
      src={failed === source ? '/mark.svg' : source}
      alt={alt}
      data-brand-variant={variant}
      decoding="async"
      onError={() => setFailed(source)}
    />
  );
}
