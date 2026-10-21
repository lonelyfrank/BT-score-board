import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ArrowDown, Lock, LockOpen, Plus, Shuffle, Trash2 } from 'lucide-react';
import { ErrorMessage, Modal, Segmented } from './ui';
import { uuid } from '../../../../packages/application/src/portable.js';
import { api, type Match } from '../services/api';
import {
  planHeats,
  heatSlots,
  canOrganizeHeat,
  canOrganizeMatch,
  comparableAcrossHeats,
  type GameMode,
} from '../services/rules';

type Overview = Match['heatOverview'];
type HeatRow = Overview['heats'][number];

export const heatStatusLabel: Record<string, string> = {
  pending: 'in attesa',
  ready: 'confermata',
  active: 'al bersaglio',
  completed: 'giocata',
  cancelled: 'annullata',
};

/**
 * The heats of a match in their order: which one is at the board, the next one, the played
 * ones and how many results each still misses. Tapping a heat shows its players.
 */
export function HeatTimeline({
  overview,
  viewing,
  select,
}: {
  overview: Overview;
  viewing: string | null;
  select: (heatId: string) => void;
}) {
  return (
    <div className="heat-timeline" role="radiogroup" aria-label="Manche">
      {overview.heats.map((h) => {
        const tag =
          h.heatId === overview.nextHeatId && h.status !== 'active'
            ? 'prossima'
            : heatStatusLabel[h.status];
        return (
          <button
            type="button"
            role="radio"
            key={h.heatId}
            aria-checked={viewing === h.heatId}
            className={`heat-chip status-${h.status}`}
            onClick={() => select(h.heatId)}
          >
            <strong>M{h.number}</strong>
            <small>
              {tag}
              {h.missing.length > 0 && h.status !== 'pending' && h.status !== 'ready'
                ? ` · ${h.missing.length} da inserire`
                : ''}
            </small>
          </button>
        );
      })}
    </div>
  );
}

/** Which heat to show: the one chosen, else the one at the board, else the next, else the last. */
export function viewedHeat(overview: Overview, chosen: string | null): HeatRow | null {
  const find = (id: string | null) => overview.heats.find((h) => h.heatId === id) ?? null;
  return (
    find(chosen) ??
    find(overview.currentHeatId) ??
    find(overview.nextHeatId) ??
    overview.heats.at(-1) ??
    null
  );
}

type DraftHeat = {
  key: string;
  heatId: string | null;
  slots: (string | null)[];
  fixed: boolean;
  locked: boolean;
  status: string;
};
const freshHeat = (slots: (string | null)[]): DraftHeat => ({
  key: uuid(),
  heatId: null,
  slots,
  fixed: false,
  locked: false,
  status: 'pending',
});
function draftOf(m: Match): DraftHeat[] {
  if (!m.heats.length)
    return [
      {
        ...freshHeat(
          heatSlots(
            {
              entryIds: [...m.participants]
                .sort((a, b) => a.playingOrder - b.playingOrder)
                .map((p) => p.tournamentEntryId),
            },
            m.heatCapacity,
          ),
        ),
        fixed: !canOrganizeMatch(m),
      },
    ];
  return m.heats.map((h) => ({
    key: h.id,
    heatId: h.id,
    slots: heatSlots(h, Math.max(m.heatCapacity, ...(h.slotPositions ?? []), h.entryIds.length)),
    fixed: !canOrganizeHeat(m, h),
    locked: h.status === 'ready',
    status: h.status,
  }));
}
/** Draft-only edits: one versioned command commits the complete layout. */
export function HeatEditor({
  m,
  name,
  close,
}: {
  m: Match;
  name: (entryId: string) => string;
  close: () => void;
}) {
  const client = useQueryClient();
  const [base, setBase] = useState(m);
  const originalLayout = useMemo(() => draftOf(base), [base]);
  const [layout, setLayout] = useState(() => draftOf(m));
  const [picked, setPicked] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('Tocca un partecipante, poi lo slot di destinazione.');
  const [strategy, setStrategy] = useState<'sequential' | 'balanced' | 'custom' | 'random'>(
    'sequential',
  );
  const capacity = base.heatCapacity;
  const stale = base.version !== m.version || base.tournamentVersion !== m.tournamentVersion;
  const assigned = layout.flatMap((h) => h.slots.filter((id): id is string => id !== null));
  const expected = base.participants.map((p) => p.tournamentEntryId);
  const empty = layout.some((h) => !h.fixed && h.slots.every((id) => id === null));
  const invalid = empty
    ? 'Rimuovi le manche vuote oppure assegna un partecipante.'
    : assigned.length !== expected.length ||
        new Set(assigned).size !== assigned.length ||
        expected.some((id) => !assigned.includes(id))
      ? 'Assegna ogni partecipante esattamente una volta.'
      : !comparableAcrossHeats(base.gameMode as GameMode) &&
          layout.filter((h) => h.status !== 'cancelled').length > 1
        ? 'Questo gioco richiede un unico confronto sul totem: non può essere diviso in manche indipendenti.'
        : '';
  const done = (fresh: Match) => {
    client.setQueryData(['match', m.id], fresh);
    void client.invalidateQueries({ queryKey: ['tournament', fresh.tournamentId] });
    void client.invalidateQueries({ queryKey: ['session'] });
    close();
  };
  const save = useMutation({
    mutationFn: () =>
      api.matchCommand(base, 'heats/arrange', {
        heats: layout
          .filter((h) => !h.fixed)
          .map((h) => ({
            heatId: h.heatId,
            entryIds: h.slots.filter((id) => id !== null),
            slotPositions: h.slots.flatMap((id, i) => (id === null ? [] : [i + 1])),
          })),
      }),
    onSuccess: done,
  });
  const lock = useMutation({
    mutationFn: ({ heatId, locked }: { heatId: string; locked: boolean }) =>
      api.matchCommand(base, 'heats/lock', { heatId, locked }),
    onSuccess: done,
  });
  const busy = save.isPending || lock.isPending;
  const dirty =
    JSON.stringify(layout.map((h) => [h.heatId, h.slots])) !==
    JSON.stringify(originalLayout.map((h) => [h.heatId, h.slots]));
  function reset() {
    setBase(m);
    setLayout(draftOf(m));
    setPicked(null);
    setStrategy('sequential');
    setFeedback('Distribuzione salvata ripristinata.');
    save.reset();
    lock.reset();
  }
  function tap(index: number, slot: number) {
    const target = layout[index]!;
    if (target.fixed || target.locked) return;
    const id = target.slots[slot]!;
    if (!picked) {
      setPicked(id);
      return;
    }
    if (id === picked) {
      setPicked(null);
      return;
    }
    const from = layout.findIndex((h) => h.slots.includes(picked));
    const position = layout[from]!.slots.indexOf(picked);
    const next = layout.map((h) => ({ ...h, slots: [...h.slots] }));
    next[from]!.slots[position] = id;
    next[index]!.slots[slot] = picked;
    setLayout(next);
    setPicked(null);
    setStrategy('custom');
    setFeedback(
      id
        ? `${name(picked)} e ${name(id)} scambiati.`
        : `${name(picked)} spostato in manche ${index + 1}, slot ${slot + 1}.`,
    );
  }
  function reorder(index: number, direction: number) {
    const next = [...layout];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    setLayout(next);
    setStrategy('custom');
    setFeedback('Ordine delle manche aggiornato.');
  }
  function distribute(value: 'sequential' | 'balanced' | 'custom' | 'random') {
    setStrategy(value);
    setPicked(null);
    if (value === 'custom') return;
    const fixed = (h: DraftHeat) => h.fixed || h.locked;
    const ids = layout
      .filter((h) => !fixed(h))
      .flatMap((h) => h.slots.filter((id): id is string => id !== null));
    const parts = planHeats(ids, capacity, value).map((entryIds) =>
      freshHeat(heatSlots({ entryIds }, capacity)),
    );
    const next: DraftHeat[] = [];
    for (const [i, h] of layout.entries()) {
      if (fixed(h)) {
        if (next.length !== i) {
          setFeedback(
            'La proposta sposterebbe una manche bloccata: modifica manualmente quelle in attesa.',
          );
          return;
        }
        next.push(h);
      } else if (parts.length) next.push(parts.shift()!);
    }
    next.push(...parts);
    setLayout(next);
    setFeedback('Proposta aggiornata. Conferma per salvarla.');
  }
  return (
    <Modal title="Organizza manche" close={busy ? () => {} : close}>
      <p className="hint">
        {expected.length} partecipanti · {layout.length} manche · {assigned.length} slot assegnati
      </p>
      <fieldset disabled={busy || stale} className="heat-organizer">
        <Segmented
          label="Distribuzione nelle manche"
          value={strategy}
          change={distribute}
          options={[
            { id: 'sequential', label: 'Riempimento' },
            { id: 'balanced', label: 'Bilanciata' },
            { id: 'custom', label: 'Personalizzata' },
          ]}
        />
        <p className="hint">
          Seleziona un partecipante e tocca uno slot libero per spostarlo, oppure un altro
          partecipante per scambiarli. Le squadre occupano un solo slot.
        </p>
        <ol className="heat-editor">
          {layout.map((h, index) => (
            <li key={h.key} className={h.fixed || h.locked ? 'locked' : ''}>
              <div className="team-head">
                <strong>Manche {index + 1}</strong>
                <small>
                  {h.slots.filter(Boolean).length}/{capacity} · {heatStatusLabel[h.status]}
                </small>
              </div>
              <div className="heat-slots">
                {h.slots.map((id, slot) => (
                  <button
                    type="button"
                    key={slot}
                    className={`heat-slot ${id ? '' : 'heat-slot-empty'}`}
                    aria-label={`Manche ${index + 1}, slot ${slot + 1}: ${id ? name(id) : 'libero'}`}
                    aria-pressed={!!id && picked === id}
                    disabled={h.fixed || h.locked || (!id && !picked)}
                    onClick={() => tap(index, slot)}
                  >
                    <small>Slot {slot + 1}</small>
                    <span>{id ? name(id) : 'libero'}</span>
                  </button>
                ))}
              </div>
              {h.fixed ? (
                <p className="hint">
                  Manche avviata, chiusa o con cronologia: composizione e ordine protetti.
                </p>
              ) : h.locked ? (
                <p className="hint">Manche confermata: sbloccala prima di modificarla.</p>
              ) : null}
              <div className="heat-actions">
                {!h.fixed && (
                  <>
                    <button
                      type="button"
                      aria-label={`Anticipa manche ${index + 1}`}
                      disabled={
                        h.locked ||
                        index === 0 ||
                        layout[index - 1]?.fixed ||
                        layout[index - 1]?.locked
                      }
                      onClick={() => reorder(index, -1)}
                    >
                      <ArrowUp size={16} /> Prima
                    </button>
                    <button
                      type="button"
                      aria-label={`Posticipa manche ${index + 1}`}
                      disabled={
                        h.locked ||
                        index === layout.length - 1 ||
                        layout[index + 1]?.fixed ||
                        layout[index + 1]?.locked
                      }
                      onClick={() => reorder(index, 1)}
                    >
                      <ArrowDown size={16} /> Dopo
                    </button>
                    {h.slots.every((id) => id === null) && (
                      <button
                        type="button"
                        aria-label={`Elimina manche ${index + 1}`}
                        onClick={() => {
                          setLayout(layout.filter((_, i) => i !== index));
                          setFeedback('Manche vuota rimossa.');
                        }}
                      >
                        <Trash2 size={16} /> Elimina
                      </button>
                    )}
                    {h.heatId && !dirty && (
                      <button
                        type="button"
                        onClick={() => lock.mutate({ heatId: h.heatId!, locked: !h.locked })}
                      >
                        {h.locked ? <LockOpen size={16} /> : <Lock size={16} />}
                        {h.locked ? 'Sblocca manche' : 'Blocca manche'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
        <div className="heat-actions">
          <button
            type="button"
            disabled={!comparableAcrossHeats(base.gameMode as GameMode) || layout.length >= 256}
            onClick={() => {
              setLayout([...layout, freshHeat(Array.from({ length: capacity }, () => null))]);
              setStrategy('custom');
              setFeedback('Nuova manche: assegna almeno un partecipante.');
            }}
          >
            <Plus size={16} /> Nuova manche
          </button>
          <button
            type="button"
            onClick={() => distribute(strategy === 'custom' ? 'sequential' : strategy)}
          >
            <Shuffle size={16} /> Applica automatico
          </button>
          <button type="button" onClick={() => distribute('random')}>
            Casuale
          </button>
        </div>
      </fieldset>
      <p role="status" className="hint">
        {feedback}
      </p>
      {invalid ? (
        <p role="alert" className="hint">
          {invalid}
        </p>
      ) : (
        <p className="hint">Distribuzione valida · tutti i partecipanti assegnati.</p>
      )}
      {stale && (
        <p role="alert">
          La partita è cambiata in un’altra schermata. Ripristina la distribuzione per caricare i
          dati aggiornati.
        </p>
      )}
      <ErrorMessage error={save.error ?? lock.error} />
      <button type="button" disabled={busy} onClick={reset}>
        Ripristina distribuzione
      </button>
      <button
        type="button"
        className="primary"
        disabled={busy || stale || !!invalid || layout.every((h) => h.fixed)}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Salvataggio…' : 'Conferma organizzazione'}
      </button>
    </Modal>
  );
}
