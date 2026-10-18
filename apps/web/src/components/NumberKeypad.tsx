import { useEffect } from 'react';
import { Check, Trash2, Undo2 } from 'lucide-react';

export function appendDigit(input: string, digit: string, maximum = 180) {
  const next = input === '0' ? digit : input + digit;
  return next.length > String(maximum).length || Number(next) > maximum ? input : next;
}
export function NumberKeypad({
  value,
  change,
  submit,
  undo,
  busy,
  canUndo,
  maximum = 180,
  locked = false,
  notify,
  quick,
  quickLabel,
  okLabel,
  limitLabel,
}: {
  value: string;
  change: (value: string) => void;
  submit: () => void;
  undo: () => void;
  busy: boolean;
  canUndo: boolean;
  maximum?: number;
  /** A send to recover: digits wait, only confirm (retry) works. */
  locked?: boolean;
  notify: (message: string) => void;
  quick: number[];
  quickLabel: string;
  okLabel: string;
  /** Shown when a digit would exceed the maximum, e.g. "Massimo 180 per turno". */
  limitLabel: string;
}) {
  function digit(d: string) {
    const next = appendDigit(value, d, maximum);
    if (next === value && !(value === '0' && d === '0')) notify(limitLabel);
    change(next);
  }
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select, dialog') || busy) return;
      if (/^\d$/.test(event.key) && !locked) {
        event.preventDefault();
        digit(event.key);
      } else if (event.key === 'Backspace' && !locked) {
        event.preventDefault();
        change(value.slice(0, -1));
      } else if (event.key === 'Enter' && (value !== '' || locked)) {
        event.preventDefault();
        submit();
      } else if (event.ctrlKey && event.key === 'z' && canUndo && !locked) {
        event.preventDefault();
        undo();
      }
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  });
  return (
    <div className="input-area">
      <div className="keypad" role="group" aria-label="Tastierino">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '✓'].map((key) => (
          <button
            type="button"
            key={key}
            className={key === 'C' ? 'clear-key' : key === '✓' ? 'confirm-key' : ''}
            aria-label={key === 'C' ? 'Cancella ultima cifra' : key === '✓' ? okLabel : key}
            disabled={
              busy ||
              (key === '✓' ? value === '' && !locked : locked || (key === 'C' && value === ''))
            }
            onClick={() =>
              key === 'C' ? change(value.slice(0, -1)) : key === '✓' ? submit() : digit(key)
            }
          >
            {key === '✓' ? <Check strokeWidth={2.6} /> : key}
          </button>
        ))}
      </div>
      <div className="quick-panel">
        <span className="quick-label">{quickLabel}</span>
        <div className="quick-grid" role="group" aria-label="Colpi rapidi">
          {quick.map((score) => (
            <button
              type="button"
              key={score}
              disabled={busy || locked || score > maximum}
              onClick={() => change(String(score))}
            >
              {score}
            </button>
          ))}
        </div>
        <div className="quick-grid quick-tools">
          <button
            type="button"
            disabled={busy || locked || !value}
            aria-label="Svuota input"
            onClick={() => change('')}
          >
            <Trash2 size={20} />
          </button>
          <button
            type="button"
            disabled={busy || locked || !canUndo}
            aria-label="Annulla ultimo punteggio"
            onClick={undo}
          >
            <Undo2 size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
