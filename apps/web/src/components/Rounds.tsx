import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Trash2,
  Undo2,
} from 'lucide-react';
import { ErrorMessage, Modal } from './ui';
import { NumberKeypad } from './NumberKeypad';
import { api, type Match } from '../services/api';
import { gameOf } from '../services/rules';

type Progress = Match['progress'][number];
const vibrate = () => {
  try {
    navigator.vibrate?.(12);
  } catch {
    /* No haptics. */
  }
};

/** What a progression amounts to, said plainly: partial totals are never shown as official. */
export function progressSummary(m: Match, p: Progress | undefined) {
  if (!p || p.partialValue === null) return 'Nessun round registrato';
  const spec = m.trackingSpec;
  const value =
    spec.computed === 'sum'
      ? `Totale round ${p.partialValue}`
      : spec.computed === 'start-minus-sum'
        ? `Punti rimasti ${p.partialValue}`
        : `${spec.label}: ${p.partialValue}`;
  if (p.complete) return `${value} · completo`;
  const missing = p.missing.length ? ` · mancano R${p.missing.join(', R')}` : '';
  const skipped = p.skipped.length ? ` · saltati R${p.skipped.join(', R')}` : '';
  return `${value} (parziale)${missing}${skipped}`;
}

/**
 * Round-by-round entry for one competitor: a cell per round (missing, skipped, recorded, bust),
 * a big keypad for the selected round, skip and undo. Values are provisional; the computed total
 * can be proposed as the official result once every round is in.
 */
export function RoundScoreEntry({
  m,
  entryId,
  team,
  disabled,
  saved,
  applyComputed,
}: {
  m: Match;
  entryId: string;
  /** Teams advance their rotation with each new round. */
  team: boolean;
  disabled: boolean;
  saved: (fresh: Match, message: string, round: number, corrected: boolean) => void;
  applyComputed: (value: number) => void;
}) {
  const spec = m.trackingSpec;
  const progress = m.progress.find((p) => p.tournamentEntryId === entryId);
  const rounds = progress?.rounds ?? [];
  const open = spec.rounds === null;
  const nextRound = open
    ? rounds.length + 1
    : (rounds.find((r) => r.status === 'missing')?.round ?? rounds.length);
  const [chosen, setChosen] = useState<number | null>(null);
  const round = chosen ?? nextRound;
  const current = rounds.find((r) => r.round === round);
  const [input, setInput] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(timer);
  }, [flash]);
  const max = spec.max[Math.min(round, spec.max.length) - 1] ?? spec.max[0] ?? 180;
  const record = useMutation({
    mutationFn: ({ value, bust }: { value: number | null; bust?: boolean }) =>
      api.matchCommand(m, 'rounds', {
        entryId,
        round,
        value,
        bust,
        advanceRotation: team && !current?.recordId,
      }),
    onSuccess: (fresh, submission) => {
      const correcting = !!current?.recordId;
      setInput('');
      setChosen(correcting ? round : null);
      vibrate();
      const message = submission.bust
        ? `R${round} eccesso`
        : submission.value === null
          ? `R${round} saltato`
          : `R${round} salvato`;
      setFlash(message);
      saved(fresh, message, round, correcting);
    },
    onSettled: () => (inFlight.current = false),
  });
  const remove = useMutation({
    mutationFn: (restorePrevious: boolean) =>
      api.matchCommand(m, 'rounds/void', {
        entryId,
        round,
        restorePrevious,
        reason: restorePrevious ? 'Ripristino del valore precedente' : 'Valore annullato',
      }),
    onSuccess: (fresh, restored) => {
      setInput('');
      saved(fresh, restored ? `R${round} ripristinato` : `R${round} annullato`, round, true);
    },
    onSettled: () => (inFlight.current = false),
  });
  const busy = disabled || record.isPending || remove.isPending;
  const send = (value: number | null, bust = false) => {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    record.mutate({ value, bust });
  };
  const cells = open ? [...rounds, { round: rounds.length + 1, status: 'next' as const }] : rounds;
  return (
    <section className="round-entry" aria-label="Round per round">
      <div className="round-grid" role="radiogroup" aria-label="Round">
        {cells.map((r) => {
          const view = 'value' in r ? r : null;
          return (
            <button
              type="button"
              role="radio"
              key={r.round}
              aria-checked={round === r.round}
              className={`round-cell ${r.status}`}
              disabled={busy}
              onClick={() => {
                setChosen(r.round);
                setInput('');
              }}
            >
              <small>R{r.round}</small>
              <strong>
                {view?.bust
                  ? 'ECCESSO'
                  : view?.status === 'recorded'
                    ? view.value
                    : view?.status === 'skipped'
                      ? 'saltato'
                      : '—'}
              </strong>
              {view?.corrected && (
                <span className="corrected-mark" aria-label="corretto">
                  ✎
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="round-summary" role="status">
        {progressSummary(m, progress)}
        {progress?.official !== null && progress?.official !== undefined
          ? ` · ufficiale ${progress.official}`
          : ''}
      </p>
      {progress?.complete &&
        progress.computed !== null &&
        progress.official !== progress.computed && (
          <button
            className="outline"
            disabled={busy}
            onClick={() => applyComputed(progress.computed!)}
          >
            Usa {progress.computed} come risultato dal totem
          </button>
        )}
      {current?.recordId && (
        <div className="round-record-actions">
          <p>
            {current.status === 'recorded'
              ? `Punteggio registrato per R${round}: `
              : `Stato registrato per R${round}: `}
            <strong>{current.bust ? 'Eccesso' : (current.value ?? 'saltato')}</strong>
            {current.status === 'recorded' && '. Per correggerlo, inserisci il nuovo valore e conferma.'}
          </p>
          <button
            type="button"
            className="outline"
            disabled={busy}
            onClick={() => {
              setInput('');
              setFlash(`Inserisci il nuovo valore per R${round}`);
            }}
          >
            Modifica punteggio R{round}
          </button>
          <button
            type="button"
            className="danger-outline"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={16} aria-hidden="true" /> Elimina punteggio R{round}
          </button>
        </div>
      )}
      <div className="score-paper round-paper">
        <output aria-live="polite" aria-label={`Valore del round ${round}`}>
          {input || (current?.status === 'recorded' ? current.value : '0')}
        </output>
        <span className="paper-caption">
          R{round} · {spec.label.toUpperCase()} · MAX {max}
          {current?.status === 'recorded' ? ' · CORREZIONE' : ''}
        </span>
        <p className={`paper-tag ${flash || record.isPending ? 'shown' : ''} ${flash ? 'ok' : ''}`}>
          {record.isPending ? 'Salvataggio…' : flash}
        </p>
      </div>
      <NumberKeypad
        value={input}
        change={setInput}
        submit={() => input !== '' && send(Number(input))}
        undo={() => {
          if (inFlight.current || busy || !current?.recordId) return;
          inFlight.current = true;
          remove.mutate(current.corrected);
        }}
        busy={busy}
        canUndo={!!current?.recordId}
        maximum={max}
        notify={setFlash}
        quick={
          spec.kind === 'points' ? [0, 26, 45, 60, 81, 100, 140, 180].filter((v) => v <= max) : []
        }
        quickLabel="ROUND"
        limitLabel={`Massimo ${max}`}
        okLabel={`Conferma il round ${round}`}
      />
      <div className="round-tools">
        {gameOf(m).scoring === 'remaining' && (
          <button type="button" disabled={busy} onClick={() => send(null, true)}>
            <Ban size={16} aria-hidden="true" /> Eccesso: mantieni i punti rimasti
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => send(null)}>
          <SkipForward size={16} aria-hidden="true" /> Salta R{round} (non visto)
        </button>
        {current?.corrected && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              inFlight.current = true;
              remove.mutate(true);
            }}
          >
            <RotateCcw size={16} aria-hidden="true" /> Ripristina precedente
          </button>
        )}
      </div>
      <ErrorMessage error={record.error ?? remove.error} />
      <RoundHistory m={m} entryId={entryId} />
      {confirmDelete && (
        <Modal
          variant="dialog"
          tone="danger"
          alert
          title={`Eliminare il punteggio di R${round}?`}
          close={() => setConfirmDelete(false)}
        >
          <p>
            R{round} tornerà da inserire. Il punteggio eliminato resterà nella cronologia delle
            modifiche.
          </p>
          <button type="button" onClick={() => setConfirmDelete(false)}>
            Mantieni punteggio
          </button>
          <button
            type="button"
            className="danger-outline"
            disabled={busy}
            onClick={() => {
              if (inFlight.current || busy || !current?.recordId) return;
              inFlight.current = true;
              remove.mutate(false);
              setConfirmDelete(false);
            }}
          >
            Elimina punteggio R{round}
          </button>
        </Modal>
      )}
    </section>
  );
}

const recordStatus: Record<string, string> = {
  recorded: 'registrato',
  skipped: 'saltato',
  corrected: 'sostituito',
  voided: 'annullato',
};
/** Every observation of a competitor, corrections and annulments included. */
export function RoundHistory({ m, entryId }: { m: Match; entryId: string }) {
  const records = m.rounds
    .filter((r) => r.tournamentEntryId === entryId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!records.length) return null;
  return (
    <details className="round-history">
      <summary>Cronologia dei round ({records.length})</summary>
      <ol>
        {records.map((r) => (
          <li key={r.id} className={`record-${r.status}`}>
            <span>R{r.round}</span>
            <strong>{r.bust ? 'Eccesso' : (r.value ?? '—')}</strong>
            <small>
              {recordStatus[r.status]}
              {r.correctsId ? ' · correzione' : ''}
              {r.reason && !r.bust ? ` · ${r.reason}` : ''} ·{' '}
              {new Date(r.createdAt).toLocaleTimeString('it-IT', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </small>
          </li>
        ))}
      </ol>
    </details>
  );
}

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
  const rotate = useMutation({
    mutationFn: (action: 'advance' | 'undo' | 'pause' | 'resume') =>
      api.matchCommand(m, 'rotation', { entryId, action }),
    onSuccess: (fresh) => {
      vibrate();
      saved(fresh);
    },
  });
  if (!view) return null;
  const busy = disabled || rotate.isPending;
  return (
    <div className="rotation-bar" aria-label="Rotazione della squadra">
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
          onClick={() => rotate.mutate('advance')}
        >
          <SkipForward size={16} />
        </button>
      )}
      <button
        type="button"
        className="mini"
        aria-label="Annulla ultimo avanzamento"
        disabled={busy || !view.canUndo}
        onClick={() => rotate.mutate('undo')}
      >
        <Undo2 size={16} />
      </button>
      <button
        type="button"
        className="mini"
        aria-label={view.paused ? 'Riprendi la rotazione' : 'Metti in pausa la rotazione'}
        disabled={busy}
        onClick={() => rotate.mutate(view.paused ? 'resume' : 'pause')}
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
    <Modal variant="dialog" tone="warning" alert title="Risultato diverso dai round" close={close}>
      <AlertTriangle aria-hidden="true" className="warning-icon" />
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
      <button
        className="primary"
        disabled={busy || !reason.trim()}
        onClick={() =>
          confirm(Object.fromEntries(differences.map((d) => [d.entryId, reason.trim()])))
        }
      >
        CONFERMA IL VALORE DEL TOTEM
      </button>
      <button disabled={busy} onClick={review}>
        Rivedi i round
      </button>
    </Modal>
  );
}
