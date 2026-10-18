import { useEffect, useState } from 'react';
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
}: {
  value: string;
  change: (value: string) => void;
  submit: () => void;
  undo: () => void;
  busy: boolean;
  canUndo: boolean;
  maximum?: number;
  locked?: boolean;
  /** Riceve gli avvisi del tastierino; senza, vengono mostrati sotto i tasti. */
  notify?: (message: string) => void;
}) {
  const [ownHint, setOwnHint] = useState('');
  const setHint = (message: string) => (notify ? message && notify(message) : setOwnHint(message));
  const hint = notify ? '' : ownHint;
  function digit(d: string) {
    const next = appendDigit(value, d, maximum);
    setHint(next === value && !(value === '0' && d === '0') ? `Massimo ${maximum}` : '');
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
      } else if (event.key === 'Enter' && value !== '') {
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
    <>
      <div className="input-area">
        <div className="keypad" role="group" aria-label="Tastierino punteggio">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '✓'].map((key) => (
            <button
              type="button"
              key={key}
              className={key === 'C' ? 'clear-key' : key === '✓' ? 'confirm-key' : ''}
              aria-label={
                key === 'C'
                  ? 'Cancella ultima cifra'
                  : key === '✓'
                    ? locked
                      ? 'Recupera invio'
                      : 'Conferma turno'
                    : key
              }
              disabled={
                busy || (key === '✓' ? value === '' : locked || (key === 'C' && value === ''))
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
          <span className="quick-label">COLPI RAPIDI</span>
          <div className="quick-grid" role="group" aria-label="Colpi rapidi">
            {[20, 40, 60, 80, 100, 120, 140, 180].map((score) => (
              <button
                key={score}
                disabled={busy || locked || score > maximum}
                onClick={() => {
                  setHint('');
                  change(String(score));
                }}
              >
                {score}
              </button>
            ))}
          </div>
          <div className="quick-grid quick-tools">
            <button
              disabled={busy || locked || !value}
              aria-label="Azzera input"
              onClick={() => change('')}
            >
              <Trash2 size={20} />
            </button>
            <button
              disabled={busy || locked || !canUndo}
              aria-label="Annulla ultimo turno"
              onClick={undo}
            >
              <Undo2 size={20} />
            </button>
          </div>
        </div>
      </div>
      {hint && (
        <p role="status" className="keypad-hint">
          {hint}
        </p>
      )}
    </>
  );
}
