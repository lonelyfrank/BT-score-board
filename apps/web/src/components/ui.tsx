import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Crosshair, X, Minus, Plus, Pause, Play } from 'lucide-react';

/**
 * Fixed regions of a screen around its scrolling `main`: commands under the header
 * (`top`) and the main action above the bar (`bottom`). Screens whose parts live in nested
 * components provide the two containers; elsewhere `InBar` renders in place.
 */
export const ScreenBars = createContext<{
  top: HTMLElement | null;
  bottom: HTMLElement | null;
} | null>(null);
export function InBar({ at, children }: { at: 'top' | 'bottom'; children: ReactNode }) {
  const bars = useContext(ScreenBars);
  if (!bars) return <>{children}</>;
  const target = bars[at];
  return target ? createPortal(children, target) : null;
}
/** Back to the top of the screen: only `main` scrolls, the window stays still. */
export function scrollToTop() {
  document.querySelector('#main-content main')?.scrollTo(0, 0);
  window.scrollTo(0, 0);
}

/**
 * Title and subtitle centred between a way back (chevron, or ✕ to leave a flow whose draft
 * stays saved) and one action. `back={null}` leaves the left slot empty: a main view.
 */
export function Header({
  title,
  subtitle,
  back = '/',
  backLabel = 'Indietro',
  close = false,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: string | null;
  backLabel?: string;
  /** ✕ instead of the chevron. */
  close?: boolean;
  action?: ReactNode;
}) {
  return (
    <header className="hdr">
      {back === null ? (
        <span />
      ) : (
        <Link className="ibtn" to={back} aria-label={backLabel}>
          {close ? <X strokeWidth={2} /> : <ChevronLeft strokeWidth={2} />}
        </Link>
      )}
      <div className="ttl">
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
      type="button"
      className="ibtn box"
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
/** Primary add action in a header (new player, new event, new tournament). */
export function AddButton({
  label,
  onClick,
  to,
}: {
  label: string;
  onClick?: () => void;
  to?: string;
}) {
  return to ? (
    <Link className="ibtn box add" to={to} aria-label={label}>
      <Plus />
    </Link>
  ) : (
    <button type="button" className="ibtn box add" aria-label={label} onClick={onClick}>
      <Plus />
    </button>
  );
}
export { BottomNavigation } from './BottomNavigation';
/** Optional player avatars: the pub palette of V1.4, chosen instead of derived from the name. */
export const avatarPresets: Record<string, string> = {
  viola: '#6d3df5',
  petrolio: '#0e8f8e',
  ruggine: '#c4532a',
  blu: '#2f6fd1',
  rosa: '#b83372',
  verde: '#4f7d24',
  oro: '#8a5a1f',
};
const avatarColors = [
  ...Object.values(avatarPresets),
  '#5a4bd0',
  '#a03a3a',
  '#2c7a5a',
  '#7a3fa0',
  '#3a6a9a',
  '#9a6a2a',
];
export function initials(name: string) {
  // Words with a letter: «Ada + Bea» is AB, «Marco R.» is MR.
  const words = name
    .replace(/[.“”"]/g, '')
    .trim()
    .split(/\s+/)
    .filter((w) => /\p{L}|\d/u.test(w));
  return (words.length > 1 ? words.map((x) => x[0]).join('') : (words[0] ?? '?'))
    .slice(0, 2)
    .toUpperCase();
}
export function avatarColor(name: string, avatar?: string | null) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (avatar && avatarPresets[avatar]) || avatarColors[hash % avatarColors.length]!;
}
export function Avatar({
  name,
  avatar,
  active = false,
  size,
  className = '',
}: {
  name: string;
  /** Preset chosen in the player's profile; otherwise a colour derived from the name. */
  avatar?: string | null;
  active?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`av ${size ?? ''} ${active ? 'on' : ''} ${className}`}
      style={{ background: avatarColor(name, avatar) }}
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
      {retry && (
        <button type="button" className="btn sm" onClick={retry}>
          Riprova
        </button>
      )}
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
 * A bottom sheet (grab, title, scrolling body, fixed footer), or with `variant="dialog"` a
 * centred confirmation without a close icon (its own buttons close it). Escape always closes.
 */
export function Modal({
  title,
  subtitle,
  lead,
  children,
  footer,
  close,
  variant = 'sheet',
  tone,
  alert = false,
  tall = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Shown before the title, e.g. the player's avatar. */
  lead?: ReactNode;
  children: ReactNode;
  /** Actions kept under the body, always visible. */
  footer?: ReactNode;
  close: () => void;
  variant?: 'sheet' | 'dialog';
  tone?: 'warning' | 'danger';
  alert?: boolean;
  /** A sheet that takes the screen height even while its content is short. */
  tall?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const heading = (
    <div>
      <h2 id="sheet-title">{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
  return (
    <dialog
      ref={ref}
      className={`${variant} ${tone ?? ''} ${tall ? 'tall' : ''}`}
      role={alert ? 'alertdialog' : undefined}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby="sheet-title"
    >
      {variant === 'sheet' && <div className="grab" aria-hidden="true" />}
      <header className="sh-h">
        {lead ? (
          <div className="lead">
            {lead}
            {heading}
          </div>
        ) : (
          heading
        )}
        {variant === 'sheet' && (
          <button type="button" onClick={close} aria-label="Chiudi" className="ibtn">
            <X />
          </button>
        )}
      </header>
      <div className="sh-body">{children}</div>
      {footer && <div className="sh-foot">{footer}</div>}
    </dialog>
  );
}
/** A number with − and +, in a settings row. */
export function Stepper({
  label,
  hint,
  value,
  change,
  min = 1,
  max = 9,
}: {
  label: ReactNode;
  hint?: string;
  value: number;
  change: (n: number) => void;
  min?: number;
  max?: number;
}) {
  const name = typeof label === 'string' ? label : '';
  return (
    <div className="stepper-row">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <StepperControl label={name} value={value} change={change} min={min} max={max} />
    </div>
  );
}
export function StepperControl({
  label,
  value,
  change,
  min = 1,
  max = 9,
  less,
  more,
}: {
  label: string;
  value: number;
  change: (n: number) => void;
  min?: number;
  max?: number;
  /** Accessible names of the two buttons; default «Riduci …» and «Aumenta …». */
  less?: string;
  more?: string;
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={less ?? `Riduci ${label}`}
        disabled={value <= min}
        onClick={() => change(value - 1)}
      >
        <Minus />
      </button>
      <output>{value}</output>
      <button
        type="button"
        aria-label={more ?? `Aumenta ${label}`}
        disabled={value >= max}
        onClick={() => change(value + 1)}
      >
        <Plus />
      </button>
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
    <div className="toptabs" role="tablist" aria-label={label}>
      {tabs.map((tab, i) => (
        <button
          type="button"
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
/** Mutually exclusive options in a pill. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  change,
  small = false,
  className = '',
}: {
  label: string;
  options: { id: T; label: ReactNode; disabled?: boolean }[];
  value: T;
  change: (id: T) => void;
  small?: boolean;
  className?: string;
}) {
  return (
    <div className={`seg ${small ? 'sm' : ''} ${className}`} role="radiogroup" aria-label={label}>
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
const toneClass: Record<Tone, string> = {
  live: 'live',
  warning: 'warn',
  success: 'ok',
  neutral: '',
};
/** Status chip: pink in progress, amber waiting for the organizer, green done. */
export function StatusChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`chip ${toneClass[tone]}`}>{children}</span>;
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
