import { useEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink, useSearchParams } from 'react-router-dom';
import { DartIcon } from './BrandIcons';
import {
  ChevronLeft,
  Settings,
  Home,
  Trophy,
  ChartNoAxesColumnIncreasing,
  Users,
  Crosshair,
  X,
  Minus,
  Plus,
} from 'lucide-react';

export function Header({
  title,
  subtitle,
  back = '/',
  action,
  decor,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  action?: ReactNode;
  decor?: ReactNode;
}) {
  return (
    <header className={`app-header ${decor ? 'with-decor' : ''}`}>
      <Link className="back-button" to={back} aria-label="Indietro">
        <ChevronLeft strokeWidth={2.4} />
      </Link>
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {decor && <span className="header-decor">{decor}</span>}
      {action ?? (
        <Link className="icon-button" to="/impostazioni" aria-label="Impostazioni">
          <Settings />
        </Link>
      )}
    </header>
  );
}
export function BottomNavigation() {
  return (
    <nav className="bottom-nav" aria-label="Navigazione principale">
      {[
        ['/', 'Home', Home, true],
        ['/partite/nuova', 'Partite', DartIcon, false],
        ['/tornei', 'Tornei', Trophy, true],
        ['/hiscore', 'Hi-Score', ChartNoAxesColumnIncreasing, false],
        ['/giocatori', 'Giocatori', Users, false],
      ].map(([url, name, Icon, fillable]) => {
        const Glyph = Icon as typeof Home;
        return (
          <NavLink key={String(url)} to={String(url)} end={url === '/'}>
            <Glyph aria-hidden="true" className={fillable ? 'fill-active' : undefined} />
            <span>{String(name)}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
const avatarColors = ['#5B2340', '#23405B', '#5B4A23', '#2F5B23', '#4A235B', '#235B55', '#5B3323'];
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((x) => x[0]).join('') : (words[0] ?? '?'))
    .slice(0, 2)
    .toUpperCase();
}
export function Avatar({
  name,
  active = false,
  className = '',
}: {
  name: string;
  active?: boolean;
  className?: string;
}) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden="true"
      className={`avatar ${active ? 'selected' : ''} ${className}`}
      style={{ background: avatarColors[hash % avatarColors.length] }}
    >
      {initials(name)}
    </span>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="empty">
      <Crosshair aria-hidden="true" />
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export function ErrorMessage({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="error">
      <p>{error instanceof Error ? error.message : 'Operazione non riuscita.'}</p>
      {retry && <button onClick={retry}>Riprova</button>}
    </div>
  );
}
export function Loading() {
  return (
    <p className="loading" role="status">
      Caricamento…
    </p>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby="sheet-title"
    >
      <header>
        <h2 id="sheet-title">{title}</h2>
        <button onClick={close} aria-label="Chiudi" className="icon-button">
          <X />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Stepper({
  label,
  value,
  change,
  min = 1,
  max = 9,
}: {
  label: string;
  value: number;
  change: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <div className="stepper">
        <button
          type="button"
          aria-label={`Riduci ${label}`}
          disabled={value <= min}
          onClick={() => change(value - 1)}
        >
          <Minus size={18} />
        </button>
        <output>{value}</output>
        <button
          type="button"
          aria-label={`Aumenta ${label}`}
          disabled={value >= max}
          onClick={() => change(value + 1)}
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}
export function Tabs({
  tabs,
  value,
  change,
}: {
  tabs: { id: string; label: string }[];
  value: string;
  change: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab, i) => (
        <button
          role="tab"
          aria-selected={value === tab.id}
          tabIndex={value === tab.id ? 0 : -1}
          key={tab.id}
          onClick={() => change(tab.id)}
          onKeyDown={(e) => {
            if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const next =
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? tabs.length - 1
                  : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            change(tabs[next]!.id);
            (e.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
export function useTab(defaultValue: string) {
  const [params, setParams] = useSearchParams();
  return [
    params.get('tab') ?? defaultValue,
    (value: string) => setParams({ tab: value }, { replace: true }),
  ] as const;
}
export const statusLabel = (status: string) =>
  ({
    draft: 'Bozza',
    registration: 'Iscrizioni aperte',
    ready: 'Da giocare',
    scheduled: 'In programma',
    active: 'In corso',
    paused: 'In pausa',
    completed: 'Terminata',
    cancelled: 'Annullata',
    open: 'In corso',
    finalized: 'Confermata',
    qualification: 'Qualifica',
    group: 'Gironi',
    knockout: 'Eliminazione',
    semifinal: 'Semifinali',
    final: 'Finale',
    tiebreak: 'Spareggio',
  })[status] ??
  (status.startsWith('elimination_') ? `Eliminazione · Top ${status.slice(12)}` : status);
