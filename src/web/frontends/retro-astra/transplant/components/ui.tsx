import { horseSexLabel, horseSexKind } from "../../../../../frontend-kit";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowRight, BookOpen, Check, Star, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { Horse, Sex } from '../data/horses';
import { usePreferences } from '../preferences/PreferencesProvider';

export function HorseMark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M45 53H17c-1-9 3-17 10-23l-9 3-5-6 10-13 8-3 2-7 5 8c9 5 13 14 12 24-1 7-3 12-5 17Z" fill="currentColor" />
    <path d="m22 17 7-3m-8 14 9-3c-1 6-8 11-8 20m16-31c7 9 8 20 2 31" stroke="var(--mark-detail, #e9e4cd)" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="27" cy="20" r="1.4" fill="var(--mark-detail, #e9e4cd)" />
    <path d="M15 55h33v5H15z" fill="currentColor" />
  </svg>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  small?: boolean;
  children: ReactNode;
};

export function Button({ variant = 'secondary', small = false, className = '', children, ...props }: ButtonProps) {
  return <button type="button" className={`button button--${variant} ${small ? 'button--small' : ''} ${className}`} {...props}>{children}</button>;
}

export function LinkButton({ href, children, primary = false, small = false, className = '' }: { href: string; children: ReactNode; primary?: boolean; small?: boolean; className?: string }) {
  return <a href={href} className={`button button--${primary ? 'primary' : 'secondary'} ${small ? 'button--small' : ''} ${className}`}>{children}</a>;
}

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} className={`icon-button ${className}`} {...props}>{children}</button>;
}

export function StarButton({ saved, onClick, name = 'horse' }: { saved: boolean; onClick: () => void; name?: string }) {
  const { t, text } = usePreferences();
  return <IconButton label={t(saved ? 'unstarHorse' : 'starHorse', { name: text(name) })} onClick={onClick} aria-pressed={saved} className={`star-button ${saved ? 'is-saved' : ''}`}>
    <Star size={16} fill={saved ? 'currentColor' : 'none'} />
  </IconButton>;
}

export function SexBadge({ sex, recordedSex, abbreviated = false }: { sex: Sex; recordedSex?: string | null; abbreviated?: boolean }) {
  const { language } = usePreferences();
  const raw = recordedSex === undefined ? sex : recordedSex;
  const kind = horseSexKind(raw), label=horseSexLabel(raw,language);
  const tone = kind === "female" ? "sex-badge--dam" : kind === "male" ? "sex-badge--sire" : "sex-badge--neutral";
  return <span className={`sex-badge ${tone}`} title={label}>
    <span className="sex-glyph" aria-hidden="true">{kind === "female" ? '\u2640' : kind === "male" ? '\u2642' : '\u00b7'}</span>
    {abbreviated && language === 'en' && kind !== 'unknown' ? label.charAt(0) : label}
  </span>;
}

export function Status({ status }: { status: Horse['status'] }) {
  const { text } = usePreferences();
  return <span className={`status status--${status.toLowerCase().replace(/ /g, '-')}`}><span className="status-dot" />{text(status)}</span>;
}

export function Panel({ title, icon, action, children, className = '', subtitle }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; subtitle?: string }) {
  return <section className={`panel ${className}`}>
    <div className="panel-heading"><h2>{icon}{title}</h2>{subtitle && <span className="panel-subtitle">{subtitle}</span>}{action}</div>
    {children}
  </section>;
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="text-link" href={href}>{children}<ArrowRight size={13} /></a>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><BookOpen size={30} strokeWidth={1.3} /><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Modal({ title, subtitle, children, onClose, className = '' }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; className?: string }) {
  const { t } = usePreferences();
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    const shell = document.querySelector<HTMLElement>('.app-shell');
    const oldInert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      const target = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('input, select, textarea') ?? ref.current?.querySelector<HTMLElement>('button');
      target?.focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onCloseRef.current(); }
      if (event.key === 'Tab' && ref.current) {
        const elements = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!ref.current.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = oldOverflow;
      if (shell) shell.inert = oldInert;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.div className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref} initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
      <div className="modal-heading"><div><span className="eyebrow">{t('appSubtitle')}</span><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton label={t('closeDialog')} onClick={onClose}><X size={19} /></IconButton></div>
      {children}
    </motion.div>
  </motion.div>;
}

export interface ToastAction { label: string; onClick: () => void }

export function Toast({ message, action }: { message: string; action?: ToastAction }) {
  return <motion.div role="status" className="toast" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}><span><Check size={15} /></span><div className="toast-message">{message}</div>{action && <button type="button" className="toast-action" onClick={action.onClick}>{action.label}</button>}</motion.div>;
}

export function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}

export function Field({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <label className="field">{label}{required && <span className="required" aria-hidden="true"> *</span>}{children}</label>;
}