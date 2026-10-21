import { useEffect, useRef } from 'react';
import { Delete } from 'lucide-react';

export function appendDigit(input: string, digit: string, maximum = 180) {
  const next = input === '0' ? digit : input + digit;
  return next.length > String(maximum).length || Number(next) > maximum ? input : next;
}
/**
 * Digits of a total read on the totem: 1–9, C (clear), 0, ⌫. The screen's main button
 * confirms; on a keyboard Enter does the same and Backspace deletes.
 */
export function NumberKeypad({
  value,
  change,
  submit,
  busy,
  maximum = 180,
  locked = false,
  notify,
  limitLabel,
  label = 'Tastierino',
}: {
  value: string;
  change: (value: string) => void;
  /** Enter on a keyboard. */
  submit: () => void;
  busy: boolean;
  maximum?: number;
  /** A send to recover: digits wait, only confirm (retry) works. */
  locked?: boolean;
  notify: (message: string) => void;
  /** Shown when a digit would exceed the maximum, e.g. "Massimo 180". */
  limitLabel: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  function digit(d: string) {
    const next = appendDigit(value, d, maximum);
    if (next === value && !(value === '0' && d === '0')) notify(limitLabel);
    change(next);
  }
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select') || busy) return;
      // A keypad inside a sheet listens only while its sheet is the open one.
      const sheet = document.querySelector('dialog[open]');
      if (sheet && !sheet.contains(ref.current)) return;
      if (/^\d$/.test(event.key) && !locked) {
        event.preventDefault();
        digit(event.key);
      } else if (event.key === 'Backspace' && !locked) {
        event.preventDefault();
        change(value.slice(0, -1));
      } else if (event.key === 'Enter' && (value !== '' || locked)) {
        event.preventDefault();
        submit();
      }
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  });
  return (
    <div ref={ref} className="keys n3" role="group" aria-label={label}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'BK'].map((key) => (
        <button
          type="button"
          key={key}
          className={key === 'C' ? 'out' : key === 'BK' ? 'mod' : ''}
          aria-label={key === 'C' ? 'Azzera' : key === 'BK' ? 'Cancella ultima cifra' : key}
          disabled={busy || locked || (key !== 'C' && key !== 'BK' ? false : value === '')}
          onClick={() =>
            key === 'C' ? change('') : key === 'BK' ? change(value.slice(0, -1)) : digit(key)
          }
        >
          {key === 'BK' ? <Delete aria-hidden="true" /> : key}
        </button>
      ))}
    </div>
  );
}
