import { useEffect, useState } from 'react';
import { Delete, EyeOff, Minus, Plus, X } from 'lucide-react';
import {
  dartLabel,
  dartText,
  placeDart,
  pressDartKey,
  turnView,
  type DartInput,
  type DartKey,
  type DartThrow,
  type TurnContext,
} from '../services/guided';

type Kind = DartThrow['kind'];
const kinds: [Kind, string][] = [
  ['single', 'Singolo'],
  ['double', 'Doppio'],
  ['triple', 'Triplo'],
  ['bull25', 'Bull 25'],
  ['bull50', 'Bull 50'],
  ['miss', 'Fuori'],
];
const sectored = (k: Kind) => k === 'single' || k === 'double' || k === 'triple';

/** One dart cell: value, kind, unseen, off the board or unused. */
export function DartCell({
  index,
  dart,
  unused = false,
  pending = '',
  selected = false,
  onClick,
}: {
  index: number;
  dart: DartThrow | null;
  unused?: boolean;
  /** Digits typed for this cell, waiting for S, D or T. */
  pending?: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const kind = unused ? 'unused' : pending ? 'pending' : (dart?.kind ?? 'empty');
  const value = unused ? '—' : pending ? pending : dart ? dartText(dart) : '–';
  const label = unused
    ? 'Non usata'
    : pending
      ? 'S · D · T ?'
      : dart
        ? dartLabel[dart.kind]
        : selected
          ? 'In attesa'
          : '';
  const content = (
    <>
      <small className="dart-lab">FRECCETTA {index + 1}</small>
      <strong>
        {dart?.kind === 'miss' && !pending && !unused ? <X strokeWidth={3} /> : value}
      </strong>
      <em>{label}</em>
      {selected && !pending && !unused && (
        <span className="dart-more" aria-hidden="true">
          •••
        </span>
      )}
    </>
  );
  if (!onClick) return <div className={`dart-cell k-${kind}`}>{content}</div>;
  return (
    <button
      type="button"
      className={`dart-cell k-${kind} ${selected ? 'on' : ''}`}
      aria-pressed={selected}
      aria-label={`Freccetta ${index + 1}: ${label || 'vuota'}`}
      disabled={unused}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

const keys: [DartKey, string, string][] = [
  ['1', '', '1'],
  ['2', '', '2'],
  ['3', '', '3'],
  ['S', 'mod s', 'Singolo'],
  ['4', '', '4'],
  ['5', '', '5'],
  ['6', '', '6'],
  ['D', 'mod d', 'Doppio'],
  ['7', '', '7'],
  ['8', '', '8'],
  ['9', '', '9'],
  ['T', 'mod t', 'Triplo'],
  ['X', 'out', 'Fuori bersaglio'],
  ['0', '', '0'],
  ['BK', '', 'Cancella'],
  ['BULL', 'mod bull', 'Bull 25, di nuovo per 50'],
];

/**
 * The three darts of the turn and their keypad: sector then S, D or T; BULL (twice for 50);
 * ✕ off the board. Tapping the selected cell again opens the kind selector in the page, where
 * a dart nobody saw is marked as such (it is never zero).
 */
export function DartPad({
  input,
  change,
  ctx,
  notify,
  disabled,
  submit,
}: {
  input: DartInput;
  change: (input: DartInput) => void;
  ctx: TurnContext;
  notify: (message: string) => void;
  disabled: boolean;
  /** Enter on a keyboard. */
  submit: () => void;
}) {
  const view = turnView(ctx, input.darts);
  const [panel, setPanel] = useState<{ kind: Kind | 'unobserved'; sector: number } | null>(null);
  const press = (key: DartKey) => {
    const result = pressDartKey(input, key, ctx);
    if (result.message) notify(result.message);
    change(result.input);
  };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select, dialog') || disabled)
        return;
      const k = event.key.toUpperCase();
      const map: Record<string, DartKey> = {
        B: 'BULL',
        X: 'X',
        BACKSPACE: 'BK',
        S: 'S',
        D: 'D',
        T: 'T',
      };
      if (/^\d$/.test(k) || map[k]) {
        event.preventDefault();
        press((/^\d$/.test(k) ? k : map[k]) as DartKey);
      } else if (k === 'ENTER') {
        event.preventDefault();
        submit();
      }
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  });
  const open = (i: number) => {
    const d = input.darts[i];
    if (input.sel === i && !input.typed) {
      setPanel(d ? { kind: d.kind, sector: d.sector ?? 20 } : { kind: 'single', sector: 20 });
    } else {
      setPanel(null);
      change({ ...input, sel: i, typed: '', bull: null });
    }
  };
  return (
    <>
      <div className="dart-cells">
        {[0, 1, 2].map((i) => (
          <DartCell
            key={i}
            index={i}
            dart={input.darts[i] ?? null}
            unused={view.unused(i)}
            pending={input.sel === i ? input.typed : ''}
            selected={input.sel === i && !disabled}
            onClick={disabled ? undefined : () => open(i)}
          />
        ))}
      </div>
      {panel ? (
        <section className="dart-panel" aria-label={`Freccetta ${input.sel + 1}`}>
          <header>
            <h3>Freccetta {input.sel + 1} di 3</h3>
            <button
              type="button"
              className="icon-button"
              aria-label="Chiudi"
              onClick={() => setPanel(null)}
            >
              <X />
            </button>
          </header>
          <div className="dart-kinds" role="radiogroup" aria-label="Tipo di tiro">
            {kinds.map(([kind, label]) => (
              <button
                type="button"
                role="radio"
                key={kind}
                aria-checked={panel.kind === kind}
                className={`${panel.kind === kind ? 'on' : ''} ${kind === 'miss' ? 'out' : ''}`}
                onClick={() => setPanel({ ...panel, kind })}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            role="radio"
            aria-checked={panel.kind === 'unobserved'}
            className={`dart-unseen ${panel.kind === 'unobserved' ? 'on' : ''}`}
            onClick={() => setPanel({ ...panel, kind: 'unobserved' })}
          >
            <EyeOff aria-hidden="true" />
            <span>
              Non osservata
              <small>Non vale zero: il totale si legge sul totem</small>
            </span>
          </button>
          <div className={`dart-step ${sectored(panel.kind as Kind) ? '' : 'off'}`}>
            <button
              type="button"
              aria-label="Settore precedente"
              onClick={() => setPanel({ ...panel, sector: ((panel.sector + 18) % 20) + 1 })}
            >
              <Minus />
            </button>
            <output aria-live="polite">{sectored(panel.kind as Kind) ? panel.sector : '—'}</output>
            <button
              type="button"
              aria-label="Settore successivo"
              onClick={() => setPanel({ ...panel, sector: (panel.sector % 20) + 1 })}
            >
              <Plus />
            </button>
          </div>
          <button
            type="button"
            className="primary cta"
            onClick={() => {
              change(
                placeDart(
                  input,
                  input.sel,
                  {
                    kind: panel.kind as Kind,
                    sector: sectored(panel.kind as Kind) ? panel.sector : null,
                  },
                  ctx,
                ),
              );
              setPanel(null);
            }}
          >
            CONFERMA FRECCETTA
          </button>
        </section>
      ) : (
        <div className="dart-keys" role="group" aria-label="Tastierino freccette">
          {keys.map(([key, cls, label]) => (
            <button
              type="button"
              key={key}
              className={cls}
              aria-label={label}
              disabled={disabled}
              onClick={() => press(key)}
            >
              {key === 'X' ? <X strokeWidth={3} /> : key === 'BK' ? <Delete /> : key}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
