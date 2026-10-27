import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronUp,
  GripVertical,
  Lock,
  LockOpen,
  Plus,
  Shuffle,
  Trash2,
} from 'lucide-react';
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
 * The heats of a match as tabs: which one is at the board, the next one, the played ones and
 * how many results each still misses.
 */
export function HeatTabs({
  overview,
  viewing,
  select,
}: {
  overview: Overview;
  viewing: string | null;
  select: (heatId: string) => void;
}) {
  const heats = overview.heats.filter((h) => h.status !== 'cancelled');
  return (
    <div
      className="htabs"
      role="radiogroup"
      aria-label="Manche"
      style={{ gridTemplateColumns: `repeat(${Math.min(heats.length, 4)}, minmax(0, 1fr))` }}
    >
      {heats.map((h) => {
        const tag =
          h.heatId === overview.nextHeatId && h.status !== 'active'
            ? 'prossima'
            : heatStatusLabel[h.status];
        const missing =
          h.missing.length > 0 && h.status !== 'pending' && h.status !== 'ready'
            ? ` · ${h.missing.length} da inserire`
            : '';
        return (
          <button
            type="button"
            role="radio"
            key={h.heatId}
            aria-checked={viewing === h.heatId}
            aria-label={`M${h.number} ${tag}${missing}`}
            className={`htab ${h.status === 'completed' ? 'done' : ''} ${h.status === 'active' ? 'live' : ''}`}
            onClick={() => select(h.heatId)}
          >
            <strong>M{h.number}</strong>
            <small>{missing ? `${h.missing.length} da inserire` : tag}</small>
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
  /** Earlier in the same heat: swaps with the seat before. */
  function up(index: number, slot: number) {
    const h = layout[index]!;
    if (slot === 0 || h.fixed || h.locked) return;
    const next = layout.map((x) => ({ ...x, slots: [...x.slots] }));
    const seats = next[index]!.slots;
    [seats[slot - 1], seats[slot]] = [seats[slot]!, seats[slot - 1]!];
    setLayout(next);
    setStrategy('custom');
    setFeedback(`${name(seats[slot - 1]!)} anticipato in manche ${index + 1}.`);
  }
  /** To the next heat still open with a free seat. */
  function moveOut(index: number, slot: number) {
    const id = layout[index]!.slots[slot]!;
    const order = [...layout.keys()].map((k) => (index + 1 + k) % layout.length);
    const to = order.find(
      (j) =>
        j !== index && !layout[j]!.fixed && !layout[j]!.locked && layout[j]!.slots.includes(null),
    );
    if (to === undefined) {
      setFeedback(
        'Nessuna manche in attesa con un posto libero: aggiungine una o scambia due giocatori.',
      );
      return;
    }
    const next = layout.map((x) => ({ ...x, slots: [...x.slots] }));
    next[index]!.slots[slot] = null;
    next[to]!.slots[next[to]!.slots.indexOf(null)] = id;
    setLayout(next);
    setStrategy('custom');
    setFeedback(`${name(id)} spostato in manche ${to + 1}.`);
  }
  const fixedHeats = layout.filter((h) => h.fixed);
  return (
    <Modal
      title="Organizza manche"
      subtitle={`${layout.map((h) => h.slots.filter(Boolean).length).join(' + ')} · le manche giocate restano bloccate`}
      close={busy ? () => {} : close}
      tall
      footer={
        <>
          <button type="button" className="btn ghost" disabled={busy} onClick={close}>
            Annulla
          </button>
          <button
            type="button"
            className="btn cta"
            aria-label="Conferma organizzazione"
            disabled={busy || stale || !!invalid || layout.every((h) => h.fixed)}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Salvataggio…' : 'Salva ordine'}
          </button>
          <p role={invalid ? 'alert' : 'status'} className={`form-reason ${invalid ? '' : 'ok'}`}>
            {invalid || feedback}
          </p>
        </>
      }
    >
      <fieldset disabled={busy || stale} className="heat-organizer">
        {fixedHeats.length > 0 && (
          <div className="card locked-heats">
            {fixedHeats.map((h) => (
              <p key={h.key} className="lockrow">
                <Lock aria-hidden="true" />
                <b>M{layout.indexOf(h) + 1}</b> {heatStatusLabel[h.status]} ·{' '}
                {h.slots
                  .filter((id): id is string => !!id)
                  .map((id) => name(id).split(' ')[0])
                  .join(', ')}
              </p>
            ))}
          </div>
        )}
        <Segmented
          label="Distribuzione nelle manche"
          small
          value={strategy}
          change={distribute}
          options={[
            { id: 'sequential', label: 'Riempi' },
            { id: 'balanced', label: 'Bilanciata' },
            { id: 'random', label: 'Casuale' },
            { id: 'custom', label: 'Manuale' },
          ]}
        />
        <p className="hint">
          ↑ anticipa nella manche, ⇄ sposta nella manche successiva con un posto libero. Tocca un
          giocatore e poi un altro (o un posto libero) per scambiarli. Le squadre occupano un solo
          posto.
        </p>
        <ol className="heats">
          {layout.map((h, index) =>
            h.fixed ? null : (
              <li key={h.key} className={`heat ${h.locked ? 'locked' : ''}`}>
                <div className="heat-h">
                  <strong>M{index + 1}</strong>
                  <span>
                    {h.slots.filter(Boolean).length}/{capacity} · {heatStatusLabel[h.status]}
                  </span>
                  <span className="heat-tools">
                    <button
                      type="button"
                      className="mini"
                      aria-label={`Anticipa manche ${index + 1}`}
                      disabled={
                        h.locked ||
                        index === 0 ||
                        layout[index - 1]?.fixed ||
                        layout[index - 1]?.locked
                      }
                      onClick={() => reorder(index, -1)}
                    >
                      <ArrowUp />
                    </button>
                    <button
                      type="button"
                      className="mini"
                      aria-label={`Posticipa manche ${index + 1}`}
                      disabled={
                        h.locked ||
                        index === layout.length - 1 ||
                        layout[index + 1]?.fixed ||
                        layout[index + 1]?.locked
                      }
                      onClick={() => reorder(index, 1)}
                    >
                      <ArrowDown />
                    </button>
                    {h.slots.every((id) => id === null) && (
                      <button
                        type="button"
                        className="mini"
                        aria-label={`Elimina manche ${index + 1}`}
                        onClick={() => {
                          setLayout(layout.filter((_, i) => i !== index));
                          setFeedback('Manche vuota rimossa.');
                        }}
                      >
                        <Trash2 />
                      </button>
                    )}
                    {h.heatId && !dirty && (
                      <button
                        type="button"
                        className="mini"
                        aria-label={h.locked ? 'Sblocca manche' : 'Blocca manche'}
                        onClick={() => lock.mutate({ heatId: h.heatId!, locked: !h.locked })}
                      >
                        {h.locked ? <LockOpen /> : <Lock />}
                      </button>
                    )}
                  </span>
                </div>
                <div className="heat-slots">
                  {h.slots.map((id, slot) => (
                    <div
                      key={slot}
                      className={`mv ${id ? '' : 'free'} ${id && picked === id ? 'picked' : ''}`}
                    >
                      <GripVertical aria-hidden="true" className="grip" />
                      <button
                        type="button"
                        className="slot"
                        aria-label={`Manche ${index + 1}, slot ${slot + 1}: ${id ? name(id) : 'libero'}`}
                        aria-pressed={!!id && picked === id}
                        disabled={h.locked || (!id && !picked)}
                        onClick={() => tap(index, slot)}
                      >
                        <span className="pos">{slot + 1}</span>
                        <b>{id ? name(id) : picked ? 'Sposta qui' : 'posto libero'}</b>
                      </button>
                      {id && (
                        <span className="acts">
                          <button
                            type="button"
                            className="mini"
                            aria-label={`Anticipa ${name(id)}`}
                            disabled={h.locked || slot === 0}
                            onClick={() => up(index, slot)}
                          >
                            <ChevronUp />
                          </button>
                          <button
                            type="button"
                            className="mini"
                            aria-label={`Sposta ${name(id)} in un’altra manche`}
                            disabled={h.locked}
                            onClick={() => moveOut(index, slot)}
                          >
                            <ArrowLeftRight />
                          </button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {h.locked && (
                  <p className="hint">Manche confermata: sbloccala prima di modificarla.</p>
                )}
              </li>
            ),
          )}
        </ol>
        <div className="heat-more">
          <button
            type="button"
            className="btn sm"
            disabled={!comparableAcrossHeats(base.gameMode as GameMode) || layout.length >= 256}
            onClick={() => {
              setLayout([...layout, freshHeat(Array.from({ length: capacity }, () => null))]);
              setStrategy('custom');
              setFeedback('Nuova manche: assegna almeno un partecipante.');
            }}
          >
            <Plus aria-hidden="true" /> Nuova manche
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => distribute(strategy === 'custom' ? 'sequential' : strategy)}
          >
            <Shuffle aria-hidden="true" /> Applica automatico
          </button>
        </div>
        <p className="hint">
          {expected.length} partecipanti · {layout.length} manche · {assigned.length} posti
          assegnati
        </p>
        {stale && (
          <p role="alert" className="form-reason">
            La partita è cambiata in un’altra schermata. Ripristina la distribuzione per caricare i
            dati aggiornati.
          </p>
        )}
        <ErrorMessage error={save.error ?? lock.error} />
        <button type="button" className="text-link" disabled={busy} onClick={reset}>
          Ripristina distribuzione
        </button>
      </fieldset>
    </Modal>
  );
}
