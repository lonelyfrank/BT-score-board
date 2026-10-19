import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen, Plus, Shuffle } from 'lucide-react';
import { ErrorMessage, Modal, Segmented } from './ui';
import { api, type Match } from '../services/api';

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

/**
 * Rearranges the heats not played yet: two taps swap two players, «Sposta qui» moves one,
 * a new heat takes the selected player. Confirmed heats are locked; played heats never change.
 */
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
  const editable = m.heats.filter((h) => h.status === 'pending' || h.status === 'ready');
  const [layout, setLayout] = useState(() =>
    editable.map((h) => ({
      heatId: h.id as string | null,
      entryIds: [...h.entryIds],
      locked: h.status === 'ready',
    })),
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<'balanced' | 'sequential' | 'random'>('balanced');
  const capacity = m.heatCapacity;
  const dirty =
    layout.length !== editable.length ||
    layout.some(
      (h, i) => h.heatId !== editable[i]?.id || h.entryIds.join() !== editable[i]?.entryIds.join(),
    );
  const done = (fresh: Match) => {
    client.setQueryData(['match', m.id], fresh);
    void client.invalidateQueries({ queryKey: ['tournament', fresh.tournamentId] });
    void client.invalidateQueries({ queryKey: ['session'] });
  };
  const save = useMutation({
    mutationFn: () =>
      api.matchCommand(m, 'heats/arrange', {
        heats: layout
          .filter((h) => h.entryIds.length)
          .map((h) => ({ heatId: h.heatId, entryIds: h.entryIds })),
      }),
    onSuccess: (fresh) => {
      done(fresh);
      close();
    },
  });
  const regenerate = useMutation({
    mutationFn: () =>
      api.matchCommand(m, 'heats/generate', {
        strategy,
        ...(strategy === 'random' ? { seed: Math.floor(Math.random() * 2 ** 32) } : {}),
      }),
    onSuccess: (fresh) => {
      done(fresh);
      close();
    },
  });
  const lock = useMutation({
    mutationFn: ({ heatId, locked }: { heatId: string; locked: boolean }) =>
      api.matchCommand(m, 'heats/lock', { heatId, locked }),
    onSuccess: (fresh) => {
      done(fresh);
      close();
    },
  });
  const busy = save.isPending || regenerate.isPending || lock.isPending;
  const where = (id: string) => layout.findIndex((h) => h.entryIds.includes(id));

  function tap(id: string) {
    if (picked === null) return setPicked(id);
    if (picked === id) return setPicked(null);
    const a = where(picked),
      b = where(id);
    if (layout[a]!.locked || layout[b]!.locked) return;
    const next = layout.map((h) => ({ ...h, entryIds: [...h.entryIds] }));
    const i = next[a]!.entryIds.indexOf(picked),
      j = next[b]!.entryIds.indexOf(id);
    next[a]!.entryIds[i] = id;
    next[b]!.entryIds[j] = picked;
    setLayout(next);
    setPicked(null);
  }
  function moveTo(index: number | null) {
    if (picked === null) return;
    const from = where(picked);
    if (layout[from]!.locked) return;
    const next = layout.map((h) => ({
      ...h,
      entryIds: h.entryIds.filter((x) => x !== picked),
    }));
    if (index === null) next.push({ heatId: null, entryIds: [picked], locked: false });
    else next[index]!.entryIds.push(picked);
    setLayout(next.filter((h) => h.entryIds.length || h.locked));
    setPicked(null);
  }
  const played = m.heats.length - editable.length;
  return (
    <Modal title="Gestisci manche" close={close}>
      <p className="hint">
        {played > 0 &&
          `${played} ${played === 1 ? 'manche già giocata resta' : 'manche già giocate restano'} com’è. `}
        Tocca due giocatori per scambiarli. Massimo {capacity} per manche.
      </p>
      <ol className="heat-editor">
        {layout.map((h, index) => (
          <li key={h.heatId ?? `new-${index}`} className={h.locked ? 'locked' : ''}>
            <div className="team-head">
              <strong>Manche {played + index + 1}</strong>
              <small>
                {h.entryIds.length}/{capacity}
              </small>
              {h.heatId && !dirty && (
                <button
                  type="button"
                  className="mini"
                  aria-pressed={h.locked}
                  aria-label={h.locked ? 'Sblocca manche' : 'Conferma manche'}
                  disabled={busy}
                  onClick={() => lock.mutate({ heatId: h.heatId!, locked: !h.locked })}
                >
                  {h.locked ? <Lock size={16} /> : <LockOpen size={16} />}
                </button>
              )}
            </div>
            <div className="team-members">
              {h.entryIds.map((id) => (
                <button
                  type="button"
                  key={id}
                  className="chip"
                  aria-pressed={picked === id}
                  disabled={busy || h.locked}
                  onClick={() => tap(id)}
                >
                  {name(id)}
                </button>
              ))}
              {picked &&
                !h.locked &&
                !h.entryIds.includes(picked) &&
                h.entryIds.length < capacity && (
                  <button type="button" className="chip move-here" onClick={() => moveTo(index)}>
                    Sposta qui
                  </button>
                )}
            </div>
          </li>
        ))}
      </ol>
      {picked && (
        <button type="button" className="dashed" onClick={() => moveTo(null)}>
          <Plus size={16} aria-hidden="true" className="accent-icon" /> Nuova manche con{' '}
          {name(picked)}
        </button>
      )}
      <ErrorMessage error={save.error ?? regenerate.error ?? lock.error} />
      <button className="primary" disabled={busy || !dirty} onClick={() => save.mutate()}>
        {save.isPending ? 'Salvataggio…' : 'SALVA MANCHE'}
      </button>
      <div className="options padded stack">
        <div className="stack-row">
          <span>Rigenera le manche non confermate</span>
          <Segmented
            label="Strategia delle manche"
            value={strategy}
            change={setStrategy}
            options={[
              { id: 'sequential', label: 'In ordine' },
              { id: 'random', label: 'Casuale' },
              { id: 'balanced', label: 'Bilanciata' },
            ]}
          />
        </div>
        <button type="button" disabled={busy || dirty} onClick={() => regenerate.mutate()}>
          <Shuffle size={16} aria-hidden="true" /> Rigenera
        </button>
      </div>
    </Modal>
  );
}
