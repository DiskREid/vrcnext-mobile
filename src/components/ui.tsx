import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import SecureImage from './SecureImage';
import {
  X,
  Search,
  RefreshCw,
  AlertCircle,
  Inbox,
  LoaderCircle,
  ArrowUpRight,
  ChevronRight,
} from 'lucide-react';
const modalStack: HTMLElement[] = [];
let previousOverflow = '';
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  );
}
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function SearchField({
  value,
  onChange,
  placeholder = 'Поиск…',
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search">
      <Search size={18} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </label>
  );
}
export function Segmented({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string }[];
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <div className="segmented" role="group">
      {items.map((i) => (
        <button
          key={i.id}
          className={value === i.id ? 'active' : ''}
          onClick={() => onChange(i.id)}
          aria-pressed={value === i.id}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}
export function Empty({
  title = 'Пока ничего нет',
  text,
  icon,
}: {
  title?: string;
  text?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon || <Inbox size={32} />}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={24} />
      <span>Загрузка…</span>
    </div>
  );
}
export function ErrorState({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={22} />
      <p>{error}</p>
      {retry && (
        <button className="button secondary" onClick={retry}>
          <RefreshCw size={16} />
          Повторить
        </button>
      )}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const root = ref.current;
    if (!root) return;
    if (!modalStack.length) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    modalStack.push(root);
    root?.focus();
    const handler = (e: KeyboardEvent) => {
      if (modalStack.at(-1) !== root) return;
      if (e.key === 'Escape') { e.preventDefault(); close.current(); }
      if (e.key === 'Tab' && root) {
        const nodes = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,textarea,a[href],[tabindex="0"]',
          ),
        );
        if (!nodes.length) {
          e.preventDefault();
          return;
        }
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      const index = modalStack.indexOf(root);
      if (index !== -1) modalStack.splice(index, 1);
      if (!modalStack.length) document.body.style.overflow = previousOverflow;
      if (before?.isConnected) before.focus();
      else modalStack.at(-1)?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function AvatarImage({
  src,
  name,
  size = 48,
  status,
}: {
  src?: string;
  name: string;
  size?: number;
  status?: string;
}) {
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {src && (
        <SecureImage
          src={src}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      )}
      <span className="avatar-initial">{name.slice(0, 2).toUpperCase()}</span>
      {status && <i className={`status-dot status-${status}`} />}
    </span>
  );
}
export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`badge ${className}`}>{children}</span>;
}
export function imageOf(user: {
  userIcon?: string;
  currentAvatarThumbnailImageUrl?: string;
  profilePicOverrideThumbnail?: string;
  imageUrl?: string;
  thumbnailImageUrl?: string;
  iconUrl?: string;
}) {
  return (
    user.userIcon ||
    user.profilePicOverrideThumbnail ||
    user.currentAvatarThumbnailImageUrl ||
    user.thumbnailImageUrl ||
    user.imageUrl ||
    user.iconUrl ||
    ''
  );
}
export function MoreButton({
  onClick,
  children = 'Показать все',
}: {
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ChevronRight size={16} />
    </button>
  );
}
export function ExternalIcon() {
  return <ArrowUpRight size={16} />;
}
