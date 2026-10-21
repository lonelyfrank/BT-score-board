import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { DartIcon } from './BrandIcons';
import {
  ChevronLeft,
  Home,
  Trophy,
  ChartNoAxesColumnIncreasing,
  Users,
  Crosshair,
  X,
  Minus,
  Plus,
  Pause,
  Play,
} from 'lucide-react';

export function Header({
  title,
  subtitle,
  back = '/',
  action,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  action?: ReactNode;
}) {
  return (
    <header className="app-header">
      <Link className="back-button" to={back} aria-label="Indietro">
        <ChevronLeft strokeWidth={2.4} />
      </Link>
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action ?? <span />}
    </header>
  );
}
/** Pause or resume a whole tournament, from the header of its page. */
export function PauseButton({
  paused,
  disabled,
  toggle,
}: {
  paused: boolean;
  disabled?: boolean;
  toggle: () => void;
}) {
  return (
    <button
      className="icon-button"
      aria-label={paused ? 'Riprendi torneo' : 'Metti in pausa il torneo'}
      disabled={disabled}
      onClick={toggle}
    >
      {paused ? (
        <Play className="warning-icon" fill="currentColor" />
      ) : (
        <Pause fill="currentColor" />
      )}
    </button>
  );
}
/** Primary add action in a header (new player, new event). */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="icon-button add" aria-label={label} onClick={onClick}>
      <Plus strokeWidth={2.6} />
    </button>
  );
}
const destinations = [
  ['/', 'Home', Home, true],
  ['/partite/nuova', 'Partite', DartIcon, false],
  ['/tornei', 'Tornei', Trophy, true],
  ['/hiscore', 'Hi-Score', ChartNoAxesColumnIncreasing, false],
  ['/giocatori', 'Giocatori', Users, false],
] as const;
const isCurrent = (url: string, pathname: string) =>
  url === '/' ? pathname === '/' : pathname === url || pathname.startsWith(`${url}/`);
export function BottomNavigation() {
  const { pathname } = useLocation();
  const current = destinations.findIndex(([url]) => isCurrent(url, pathname));
  return (
    <>
      <div className="nav-scrim" aria-hidden="true" />
      <nav
        className="bottom-nav"
        aria-label="Navigazione principale"
        style={{ '--i': Math.max(current, 0) } as CSSProperties}
      >
        {current >= 0 && (
          <span className="nav-pill" aria-hidden="true">
            <span key={current} className="nav-capsule" />
          </span>
        )}
        {destinations.map(([url, name, Icon, fillable]) => (
          <NavLink
            key={url}
            to={url}
            end={url === '/'}
            // A short tick confirms the tap where the device supports it (Android).
            onClick={() => navigator.vibrate?.(8)}
          >
            <Icon aria-hidden="true" className={fillable ? 'fill-active' : undefined} />
            <span>{name}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}
/** Optional player avatars: the same pub palette, chosen instead of derived from the name. */
export const avatarPresets: Record<string, string> = {
  rosa: '#5B2340',
  blu: '#23405B',
  oro: '#5B4A23',
  verde: '#2F5B23',
  viola: '#4A235B',
  petrolio: '#235B55',
  ruggine: '#5B3323',
};
const avatarColors = Object.values(avatarPresets);
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((x) => x[0]).join('') : (words[0] ?? '?'))
    .slice(0, 2)
    .toUpperCase();
}
export function Avatar({
  name,
  avatar,
  active = false,
  className = '',
}: {
  name: string;
  /** Preset chosen in the player's profile; otherwise a colour derived from the name. */
  avatar?: string | null;
  active?: boolean;
  className?: string;
}) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden="true"
      className={`avatar ${active ? 'selected' : ''} ${className}`}
      style={{
        background: (avatar && avatarPresets[avatar]) || avatarColors[hash % avatarColors.length],
      }}
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
/**
 * A bottom sheet, or with `variant="dialog"` a centred confirmation without a close icon
 * (its own buttons close it). Escape always closes.
 */
export function Modal({
  title,
  children,
  close,
  variant = 'sheet',
  tone,
  alert = false,
}: {
  title: ReactNode;
  children: ReactNode;
  close: () => void;
  variant?: 'sheet' | 'dialog';
  tone?: 'warning' | 'danger';
  alert?: boolean;
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
      className={`${variant} ${tone ?? ''}`}
      role={alert ? 'alertdialog' : undefined}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby="sheet-title"
    >
      <header>
        <h2 id="sheet-title">{title}</h2>
        {variant === 'sheet' && (
          <button onClick={close} aria-label="Chiudi" className="icon-button">
            <X />
          </button>
        )}
      </header>
      {children}
    </dialog>
  );
}
export function Stepper({
  label,
  hint,
  value,
  change,
  min = 1,
  max = 9,
}: {
  label: string;
  hint?: string;
  value: number;
  change: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="settings-row">
      {hint ? (
        <span className="row-label">
          <span>{label}</span>
          <small>{hint}</small>
        </span>
      ) : (
        <span>{label}</span>
      )}
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
  label,
}: {
  /** `attention` marks a tab with a pending organizer action. */
  tabs: { id: string; label: string; attention?: boolean }[];
  value: string;
  change: (id: string) => void;
  label?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
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
          {tab.attention && <span className="tab-dot" aria-label="azione richiesta" />}
        </button>
      ))}
    </div>
  );
}
/** Two or three mutually exclusive options in a pill. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  change,
}: {
  label: string;
  options: { id: T; label: ReactNode; disabled?: boolean }[];
  value: T;
  change: (id: T) => void;
}) {
  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          type="button"
          role="radio"
          key={o.id}
          aria-checked={value === o.id}
          disabled={o.disabled}
          onClick={() => change(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
export type Tone = 'live' | 'warning' | 'success' | 'neutral';
/** Filled status chip: pink in progress, amber waiting for the organizer, green done. */
export function StatusChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`status-chip tone-${tone}`}>{children}</span>;
}
export function tournamentTone(status: string): Tone {
  return status === 'completed'
    ? 'success'
    : status === 'paused'
      ? 'warning'
      : status === 'active'
        ? 'live'
        : 'neutral';
}
export function Switch({
  checked,
  change,
  labelledBy,
}: {
  checked: boolean;
  change: (value: boolean) => void;
  labelledBy: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={() => change(!checked)}
    >
      <span />
    </button>
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
    planned: 'In programma',
    active: 'In corso',
    paused: 'In pausa',
    completed: 'Concluso',
    cancelled: 'Annullato',
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
