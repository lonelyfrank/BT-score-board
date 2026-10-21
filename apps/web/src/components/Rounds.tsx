import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Pause, Play, SkipForward, Undo2 } from 'lucide-react';
import { ErrorMessage, Modal } from './ui';
import { api, type Match } from '../services/api';

const vibrate = () => {
  try {
    navigator.vibrate?.(12);
  } catch {
    /* No haptics. */
  }
};

/** Who throws now in a team, and the manual controls of the rotation. */
export function RotationManager({
  m,
  entryId,
  playerName,
  disabled,
  saved,
}: {
  m: Match;
  entryId: string;
  playerName: (playerId: string) => string;
  disabled: boolean;
  saved: (fresh: Match) => void;
}) {
  const view = m.rotationViews.find((r) => r.entryId === entryId);
  // A second tap before the first is saved would advance from a stale position: ignored.
  const inFlight = useRef(false);
  const rotate = useMutation({
    mutationFn: (action: 'advance' | 'undo' | 'pause' | 'resume') =>
      api.matchCommand(m, 'rotation', { entryId, action }),
    onSuccess: (fresh) => {
      vibrate();
      saved(fresh);
    },
    onSettled: () => (inFlight.current = false),
  });
  if (!view) return null;
  const busy = disabled || rotate.isPending;
  const act = (action: 'advance' | 'undo' | 'pause' | 'resume') => {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    rotate.mutate(action);
  };
  return (
    <div className="rotation" aria-label="Rotazione della squadra">
      <span className="rotation-now">
        {view.paused ? (
          'Rotazione libera'
        ) : (
          <>
            Tira <strong>{playerName(view.current!)}</strong>
            <small> · poi {playerName(view.next!)}</small>
          </>
        )}
      </span>
      {!view.paused && (
        <button
          type="button"
          className="mini"
          aria-label="Passa al prossimo tiratore"
          disabled={busy}
          onClick={() => act('advance')}
        >
          <SkipForward size={16} />
        </button>
      )}
      <button
        type="button"
        className="mini"
        aria-label="Annulla ultimo avanzamento"
        disabled={busy || !view.canUndo}
        onClick={() => act('undo')}
      >
        <Undo2 size={16} />
      </button>
      <button
        type="button"
        className="mini"
        aria-label={view.paused ? 'Riprendi la rotazione' : 'Metti in pausa la rotazione'}
        disabled={busy}
        onClick={() => act(view.paused ? 'resume' : 'pause')}
      >
        {view.paused ? <Play size={16} /> : <Pause size={16} />}
      </button>
      <ErrorMessage error={rotate.error} />
    </div>
  );
}

/**
 * The official result differs from the complete rounds: review them, or confirm the totem's
 * value with a reason. Both values are kept; the rounds are never changed to match.
 */
export function ScoreReconciliation({
  differences,
  name,
  busy,
  error,
  review,
  confirm,
  close,
}: {
  differences: { entryId: string; computed: number; official: number }[];
  name: (entryId: string) => string;
  busy: boolean;
  error: unknown;
  review: () => void;
  confirm: (reasons: Record<string, string>) => void;
  close: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      variant="dialog"
      tone="warning"
      alert
      title="Risultato diverso dai round"
      close={close}
      footer={
        <>
          <button
            className="btn cta"
            disabled={busy || !reason.trim()}
            onClick={() =>
              confirm(Object.fromEntries(differences.map((d) => [d.entryId, reason.trim()])))
            }
          >
            CONFERMA IL VALORE DEL TOTEM
          </button>
          <button className="btn" disabled={busy} onClick={review}>
            Rivedi i round
          </button>
        </>
      }
    >
      <ul className="consequences">
        {differences.map((d) => (
          <li key={d.entryId}>
            {name(d.entryId)}: round {d.computed}, totem {d.official} (differenza{' '}
            {d.official - d.computed > 0 ? '+' : ''}
            {d.official - d.computed})
          </li>
        ))}
      </ul>
      <p className="hint">
        Il valore del totem è quello ufficiale e conta in classifica. Restano salvati entrambi.
      </p>
      <label className="field">
        Motivo (obbligatorio per confermare)
        <input
          value={reason}
          maxLength={500}
          placeholder="es. round 3 letto male"
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <ErrorMessage error={error} />
    </Modal>
  );
}
