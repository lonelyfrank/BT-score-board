import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Info, Pencil } from 'lucide-react';
import { CrownIcon, DartIcon, PaintSplash } from '../components/BrandIcons';
import {
  api,
  ApiError,
  storage,
  type Match,
  type ResultInput,
  type Tournament,
} from '../services/api';
import { tournamentPath } from '../services/session';
import {
  currentEntry,
  nextAfter,
  parseDraft,
  serializeDraft,
  type Draft,
} from '../services/result-flow';
import {
  dependenciesOf,
  evaluateResult,
  gameOf,
  maxScore,
  sideOf,
  type GameMode,
} from '../services/rules';
import {
  Avatar,
  ErrorMessage,
  Header,
  Modal,
  Segmented,
  Switch,
  StatusChip,
  statusLabel,
} from '../components/ui';
import { NumberKeypad } from '../components/NumberKeypad';
import { HeatEditor, HeatTimeline, viewedHeat } from '../components/Heats';
import {
  RotationManager,
  RoundScoreEntry,
  ScoreReconciliation,
  progressSummary,
} from '../components/Rounds';
import { DecisionSheet, TieAlert, entryName } from './Tournaments';

type Form = {
  winner: string | null;
  scores: Record<string, string>;
  target: string;
  special: boolean;
  notes: string;
};
const emptyForm: Form = { winner: null, scores: {}, target: '', special: false, notes: '' };
const newKey = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`.replace('.', '');

/** The form prefilled with what is recorded: corrections start from the current result. */
function formOf(m: Match): Form {
  const r = m.result;
  if (!r) return emptyForm;
  return {
    winner: r.declaredWinnerEntryId,
    scores: Object.fromEntries(
      Object.entries(r.scores).map(([id, v]) => [id, v === null ? '' : String(v)]),
    ),
    target: r.targetScore === null ? '' : String(r.targetScore),
    special: r.special === 'SHANGHAI',
    notes: r.notes ?? '',
  };
}
const toNumber = (v: string) => (v.trim() === '' ? null : Number(v));

/**
 * Final result of a match as shown by the totem: Hi-Score totals one player at a time, or the
 * winner (with optional scores) for the other games. Corrections that would invalidate later
 * phases ask for an explicit confirmation first.
 */
export function ResultEntry({
  query,
  tournament,
  embedded = false,
  review,
}: {
  query: UseQueryResult<Match>;
  tournament: UseQueryResult<Tournament>;
  /** Inside the guided match screen: no header, rounds are entered from Live and the matrix. */
  embedded?: boolean;
  /** Opens an entry's rounds when its official value differs from them. */
  review?: (entryId: string) => void;
}) {
  const m = query.data!;
  const t = tournament.data;
  const client = useQueryClient();
  const navigate = useNavigate();
  const game = gameOf(m);
  const overview = m.heatOverview;
  const heated = overview.heats.filter((h) => h.status !== 'cancelled').length > 1;
  // Hi-Score, or any match over several heats: each competitor's score is the result.
  const hiScore = game.scoreRequired || heated;
  const tracked = m.tracking !== 'FINAL_ONLY';
  const draftKey = `bt-result:${m.id}`;
  // Digits typed for a competitor survive a reload together with that competitor only.
  const [restored] = useState(() => parseDraft(storage.get(`${draftKey}:input`)));
  const [draft, setDraft] = useState<Draft | null>(restored);
  const [selected, setSelected] = useState<string | null>(restored?.entryId ?? null);
  const [form, setForm] = useState<Form>(() => {
    try {
      return { ...formOf(m), ...JSON.parse(storage.get(`${draftKey}:form`) ?? '{}') };
    } catch {
      return formOf(m);
    }
  });
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<ResultInput | null>(null);
  const [decide, setDecide] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [closingHeat, setClosingHeat] = useState(false);
  const [heatChoice, setHeatChoice] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [entry, setEntry] = useState<'final' | 'rounds'>(() =>
    m.tracking === 'ROUND_BY_ROUND' && !embedded ? 'rounds' : 'final',
  );
  const [differences, setDifferences] = useState<{
    change: ResultInput;
    rows: { entryId: string; computed: number; official: number }[];
  } | null>(null);
  // One idempotency key per intended result: a repeated tap replays it instead of writing twice.
  const key = useRef(newKey());
  const inFlight = useRef(false);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => {
      setFlash(null);
      setJustSaved(null);
    }, 1800);
    return () => clearTimeout(timer);
  }, [flash]);
  const saveInput = (value: string) => {
    const next = value && current ? { entryId: current, value } : null;
    setDraft(next);
    if (next) storage.set(`${draftKey}:input`, serializeDraft(next));
    else storage.remove(`${draftKey}:input`);
  };
  const saveForm = (next: Form) => {
    setForm(next);
    storage.set(`${draftKey}:form`, JSON.stringify(next));
  };

  const excluded = new Set(m.excludedEntryIds);
  // Over several heats the screen follows one heat: the one at the board by default.
  const heat = heated ? viewedHeat(overview, heatChoice) : null;
  const order = heat
    ? heat.entryIds.map((id) => m.participants.find((p) => p.tournamentEntryId === id)!)
    : [...m.participants].sort((a, b) => a.playingOrder - b.playingOrder);
  const playing = order.filter((p) => !excluded.has(p.tournamentEntryId));
  const name = (id: string) => (t ? entryName(t, id) : 'Giocatore');
  const recorded = (id: string) => m.result?.scores[id] ?? null;
  // The whole match, every heat: what the header counts as still to record.
  const toRecord = m.participants.filter(
    (p) => !excluded.has(p.tournamentEntryId) && recorded(p.tournamentEntryId) === null,
  ).length;
  // Hi-Score: whose total is being typed. Defaults to the next player still without a score;
  // a recorded one is corrected only after an explicit tap on its card.
  const current = currentEntry(playing, selected, (id) => recorded(id) !== null);
  const input = draft && draft.entryId === current ? draft.value : '';
  const entryRoundsReady = (entryId: string) => {
    const progress = m.progress.find((x) => x.tournamentEntryId === entryId);
    return !!progress && progress.rounds.length > 0 && progress.missing.length === 0;
  };
  // ROUND_BY_ROUND: every round recorded or skipped before the official result.
  const roundsReady =
    m.tracking !== 'ROUND_BY_ROUND' ||
    (game.scoreRequired
      ? !!current && entryRoundsReady(current)
      : playing.every((p) => entryRoundsReady(p.tournamentEntryId)));
  const limit = maxScore(m.gameMode as GameMode, m.scoringConfiguration);
  const completed = m.status === 'completed';
  const cancelled = m.status === 'cancelled';
  const locked = !!m.result?.walkover || !!m.result?.decision;
  const paused = t?.status === 'paused';
  const ended = t?.status === 'cancelled';
  const entering = !cancelled && !ended && (!completed || editing);
  const rounds = tracked && entry === 'rounds' && entering;
  const unit = (id: string) => t?.entries.find((e) => e.id === id);
  const memberName = (playerId: string) =>
    t?.entries.flatMap((e) => e.members).find((x) => x.playerId === playerId)?.displayName ??
    'Giocatore';
  // Winner games in round mode: the competitor whose rounds are entered.
  const roundTarget =
    selected && playing.some((p) => p.tournamentEntryId === selected)
      ? selected
      : (current ?? null);
  const refreshed = (fresh: Match) => {
    client.setQueryData(['match', m.id], fresh);
    void client.invalidateQueries({ queryKey: ['tournament', fresh.tournamentId] });
    void client.invalidateQueries({ queryKey: ['standings', fresh.tournamentId] });
    void client.invalidateQueries({ queryKey: ['session'] });
  };
  const roundSaved = (fresh: Match, roundNumber: number, corrected: boolean, entryId: string) => {
    refreshed(fresh);
    if (corrected) return;
    const entries = playing.map((p) => p.tournamentEntryId);
    const currentIndex = entries.indexOf(entryId);
    const cyclic = Array.from(
      { length: entries.length },
      (_, index) => entries[(currentIndex + index + 1) % entries.length]!,
    );
    if (fresh.trackingSpec.rounds !== null) {
      for (let number = 1; number <= fresh.trackingSpec.rounds; number++) {
        const next = cyclic.find((candidate) =>
          fresh.progress
            .find((progress) => progress.tournamentEntryId === candidate)
            ?.rounds.some((r) => r.round === number && r.status === 'missing'),
        );
        if (next) {
          setSelected(next);
          return;
        }
      }
      setSelected(null);
      setEntry('final');
      setFlash('Tutti i round registrati · inserisci il risultato finale');
      return;
    }
    const next =
      cyclic.find((candidate) => {
        const progress = fresh.progress.find((p) => p.tournamentEntryId === candidate);
        return (progress?.rounds.length ?? 0) + 1 <= roundNumber;
      }) ?? cyclic[0];
    if (next) setSelected(next);
  };
  const heatCommand = useMutation({
    mutationFn: ({
      action,
      heatId,
    }: {
      action: 'heats/start' | 'heats/complete';
      heatId: string;
    }) => api.matchCommand(m, action, { heatId }),
    onSuccess: (fresh, { action, heatId }) => {
      refreshed(fresh);
      setHeatChoice(action === 'heats/start' ? heatId : null);
      setSelected(null);
      setFlash(action === 'heats/start' ? 'Manche al bersaglio' : 'Manche completata');
    },
  });
  const nextHeat = overview.heats.find((h) => h.heatId === overview.nextHeatId);
  const activeHeat = overview.heats.find((h) => h.heatId === overview.currentHeatId);
  const canManageHeats =
    heated &&
    t?.status === 'active' &&
    !completed &&
    !cancelled &&
    overview.heats.some((h) => h.status === 'pending' || h.status === 'ready');

  const mutation = useMutation({
    mutationFn: (input: ResultInput) => api.recordResult(m, input, key.current),
    onSuccess: (fresh, sent) => {
      key.current = newKey();
      client.setQueryData(['match', m.id], fresh);
      void client.invalidateQueries({ queryKey: ['tournament', fresh.tournamentId] });
      void client.invalidateQueries({ queryKey: ['standings', fresh.tournamentId] });
      void client.invalidateQueries({ queryKey: ['session'] });
      void client.invalidateQueries({ queryKey: ['tournaments'] });
      setConfirm(null);
      try {
        navigator.vibrate?.(12);
      } catch {
        /* No haptics. */
      }
      // The screen stays on the heat just saved: a completed heat is shown with its results
      // until the organizer starts the next one.
      if (heat) setHeatChoice(heat.heatId);
      if (hiScore) {
        const [savedId, value] = Object.entries(sent.scores ?? {})[0] ?? [null, null];
        setDraft(null);
        storage.remove(`${draftKey}:input`);
        // Move on to the next player still to record, in playing order.
        setSelected(
          nextAfter(
            order,
            savedId,
            (id) =>
              !fresh.excludedEntryIds.includes(id) && (fresh.result?.scores[id] ?? null) === null,
          ),
        );
        setJustSaved(value === null ? null : savedId);
        setFlash(
          value === null
            ? 'Punteggio rimosso'
            : `Salvato: ${savedId ? name(savedId) : 'punteggio'} ${value}`,
        );
      } else {
        storage.remove(`${draftKey}:form`);
        setForm(formOf(fresh));
        setFlash('Risultato salvato');
      }
      if (fresh.status === 'completed') setEditing(false);
    },
    onError: (error, sent) => {
      // The totem's value differs from complete rounds: review them or confirm with a reason.
      if (error instanceof ApiError && error.code === 'RESULT_DIFFERS_FROM_ROUNDS') {
        const rows = Object.entries(sent.scores ?? {}).flatMap(([entryId, official]) => {
          const p = m.progress.find((x) => x.tournamentEntryId === entryId);
          return official !== null && p?.computed != null && p.computed !== official
            ? [{ entryId, computed: p.computed, official }]
            : [];
        });
        if (rows.length) setDifferences({ change: sent, rows });
      }
      // A phase confirmed meanwhile (another tab): re-read, then ask before invalidating it.
      if (error instanceof ApiError && error.code === 'RESULT_HAS_DEPENDENTS') {
        void tournament.refetch();
        setConfirm(sent);
      }
      void query.refetch();
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const cancelMatch = useMutation({
    mutationFn: () => api.matchCommand(m, 'cancel', { reason: cancelReason.trim() }),
    onSuccess: (fresh) => {
      client.setQueryData(['match', m.id], fresh);
      void client.invalidateQueries({ queryKey: ['tournament', fresh.tournamentId] });
      void client.invalidateQueries({ queryKey: ['standings', fresh.tournamentId] });
      setCancelling(false);
    },
  });
  const cancellable =
    (m.matchType === 'group' || m.matchType === 'tiebreak') &&
    !completed &&
    !cancelled &&
    t?.status === 'active';
  /** Sends a change, after confirmation when it would invalidate confirmed phases or playoffs. */
  function send(change: ResultInput) {
    if (inFlight.current || mutation.isPending) return;
    const dependencies = t ? dependenciesOf(t, m) : null;
    if (dependencies?.required && !change.confirmInvalidation) return setConfirm(change);
    inFlight.current = true;
    mutation.mutate(change);
  }

  // Winner-based games: what the form would record, and why it cannot yet.
  const formResult = useMemo(() => {
    const scores = Object.fromEntries(
      playing
        .map((p) => [p.tournamentEntryId, toNumber(form.scores[p.tournamentEntryId] ?? '')])
        .filter(([, v]) => v !== null),
    ) as Record<string, number>;
    const cleared = Object.fromEntries(
      Object.keys(m.result?.scores ?? {})
        .filter((id) => !(id in scores))
        .map((id) => [id, null]),
    );
    const target = toNumber(form.target);
    const input: ResultInput = {
      scores: { ...cleared, ...scores },
      winnerEntryId: form.winner,
      targetScore: game.target ? target : undefined,
      special: game.specialWin ? (form.special ? 'SHANGHAI' : null) : undefined,
      notes: form.notes.trim() || null,
    };
    let reason = '';
    let derived: string | null = null;
    if (!roundsReady) reason = 'Registra o salta tutti i round prima del risultato finale.';
    else if (Object.values(scores).some((v) => !Number.isInteger(v) || v < 0 || v > limit))
      reason = `${game.scoreLabel}: da 0 a ${limit}.`;
    else if (
      game.target &&
      target !== null &&
      (target < game.target.min || target > game.target.max)
    )
      reason = `Obiettivo tra ${game.target.min} e ${game.target.max}.`;
    else if (form.special && !form.winner) reason = 'Tocca chi ha fatto Shanghai.';
    else
      try {
        const outcome = evaluateResult(
          m.gameMode as GameMode,
          playing.map((p) => p.tournamentEntryId),
          {
            scores,
            declaredWinnerEntryId: form.winner,
            targetScore: target,
            special: form.special ? 'SHANGHAI' : null,
          },
        );
        derived = outcome.winnerEntryId;
        if (!outcome.complete) reason = 'Tocca il vincitore mostrato dal totem.';
      } catch (error) {
        reason =
          (error as { code?: string }).code === 'RESULT_INCONSISTENT'
            ? 'Il vincitore non corrisponde ai punteggi inseriti.'
            : 'Controlla i valori inseriti.';
      }
    return { input, reason, derived };
  }, [form, playing, m.result, game, limit, m.gameMode, roundsReady]);

  const isFinal = t?.stages.find((s) => s.id === m.stageId)?.kind === 'final';
  const single = t?.mode === 'SINGLE_MATCH';
  const back = !t
    ? '/'
    : single
      ? '/tornei'
      : `${tournamentPath(t)}${t.mode === 'QUICK_HIGH_SCORE' && isFinal ? '?tab=final' : ''}`;
  const next = t?.matches
    .filter(
      (x) =>
        x.id !== m.id &&
        ['ready', 'active'].includes(x.status) &&
        t.stages.some((s) => s.id === x.stageId && s.status === 'open'),
    )
    .sort((a, b) => a.sequence - b.sequence)[0];
  const ranked = [...m.participants].sort(
    (a, b) => (a.placement ?? 99) - (b.placement ?? 99) || a.playingOrder - b.playingOrder,
  );
  const top = Math.max(0, ...playing.map((p) => recorded(p.tournamentEntryId) ?? 0));
  const winner = completed ? m.winnerEntryId : null;
  // An unresolved draw of a single match or a final: settled by a playoff or a decision.
  const tie =
    completed &&
    !m.winnerEntryId &&
    m.matchType !== 'tiebreak' &&
    t?.status === 'active' &&
    (single || isFinal) &&
    !t.matches.some((x) => x.tieTarget === m.id && !['completed', 'cancelled'].includes(x.status));
  const tiedEntries = tie
    ? m.participants.filter((p) => p.placement === 1).map((p) => p.tournamentEntryId)
    : [];
  const stageLabel = single ? 'Partita singola' : statusLabel(m.matchType);
  const subtitle = `${stageLabel} · ${
    cancelled
      ? 'annullato'
      : completed
        ? 'risultato registrato'
        : hiScore
          ? `${toRecord} da registrare`
          : 'da registrare'
  }`;
  const compact = order.length > 4;

  function card(p: Match['participants'][number]) {
    const id = p.tournamentEntryId;
    const out = excluded.has(id);
    const score = recorded(id);
    const chosen =
      hiScore || rounds
        ? (rounds ? roundTarget : current) === id && entering
        : (completed && !editing ? winner : (form.winner ?? formResult.derived)) === id;
    const side = sideOf(m.gameMode as GameMode, p.playingOrder);
    const tag = out
      ? 'RITIRATO'
      : hiScore
        ? chosen
          ? 'IN INSERIMENTO'
          : score === null
            ? 'DA INSERIRE'
            : 'REGISTRATO'
        : chosen
          ? 'VINCE'
          : (side ?? (completed ? '' : 'TOCCA SE VINCE'));
    const content = (
      <>
        {((hiScore && top > 0 && score === top) || (!hiScore && chosen)) && (
          <CrownIcon className="card-crown" role="img" aria-label="In testa" />
        )}
        <Avatar name={name(id)} />
        <span className="player-name">{name(id)}</span>
        <strong>{score ?? '—'}</strong>
        <span className={`card-tag ${chosen ? 'on' : ''}`}>{tag}</span>
      </>
    );
    if (!entering || out)
      return (
        <article
          role="listitem"
          key={id}
          className={`score-card ${chosen ? 'selected' : ''} ${out ? 'out' : ''} ${justSaved === id ? 'just-saved' : ''}`}
        >
          {content}
        </article>
      );
    return (
      <button
        type="button"
        role="radio"
        aria-checked={chosen}
        key={id}
        className={`score-card ${chosen ? 'selected' : ''} ${justSaved === id ? 'just-saved' : ''}`}
        disabled={mutation.isPending || paused}
        onClick={() => {
          if (hiScore || rounds) {
            setSelected(id);
            saveInput('');
          } else saveForm({ ...form, winner: form.winner === id ? null : id });
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={embedded ? 'result-page embedded' : 'live-page result-page'}>
      {embedded ? (
        completed &&
        !editing &&
        !locked &&
        !ended && (
          <button
            className="result-cancel"
            onClick={() => {
              setForm(formOf(m));
              setEditing(true);
            }}
          >
            <Pencil size={16} aria-hidden="true" /> Correggi risultato
          </button>
        )
      ) : (
        <Header
          title={game.label}
          subtitle={subtitle}
          back={back}
          action={
            completed && !editing && !locked && !ended ? (
              <button
                className="icon-button"
                aria-label="Correggi risultato"
                onClick={() => {
                  setForm(formOf(m));
                  setEditing(true);
                }}
              >
                <Pencil />
              </button>
            ) : undefined
          }
        />
      )}
      <main className="live-content">
        {heated && (
          <section className="heat-panel" aria-label="Manche">
            <HeatTimeline
              overview={overview}
              viewing={heat?.heatId ?? null}
              select={(id) => {
                setHeatChoice(id);
                setSelected(null);
              }}
            />
            <div className="heat-actions">
              {heat && (
                <span className="heat-now">
                  Manche {heat.number} di {overview.heats.length}
                  {heat.missing.length > 0 && heat.status !== 'pending' && heat.status !== 'ready'
                    ? ` · ${heat.missing.length} da inserire`
                    : ''}
                </span>
              )}
              {!activeHeat && nextHeat && t?.status === 'active' && !completed && (
                <button
                  className="primary"
                  disabled={heatCommand.isPending}
                  onClick={() =>
                    heatCommand.mutate({ action: 'heats/start', heatId: nextHeat.heatId })
                  }
                >
                  AVVIA MANCHE {nextHeat.number}
                </button>
              )}
              {activeHeat && heat?.heatId === activeHeat.heatId && (
                <button
                  disabled={heatCommand.isPending}
                  onClick={() =>
                    activeHeat.missing.length
                      ? setClosingHeat(true)
                      : heatCommand.mutate({ action: 'heats/complete', heatId: activeHeat.heatId })
                  }
                >
                  Completa manche
                </button>
              )}
              {canManageHeats && <button onClick={() => setManaging(true)}>Gestisci manche</button>}
            </div>
            <ErrorMessage error={heatCommand.error} />
          </section>
        )}
        {tracked && entering && !embedded && (
          <Segmented
            label="Cosa inserisci"
            value={entry}
            change={(v) => {
              setEntry(v);
              saveInput('');
            }}
            options={[
              { id: 'final', label: 'Risultato finale' },
              { id: 'rounds', label: 'Round per round' },
            ]}
          />
        )}
        {tracked && entering && entry === 'final' && !roundsReady && (
          <p className="hint" role="status">
            {game.scoreRequired
              ? 'Registra o salta tutti i round di questo partecipante prima del risultato finale.'
              : 'Registra o salta tutti i round prima del risultato finale.'}
          </p>
        )}
        {compact ? (
          <ol className="result-list" role="radiogroup" aria-label="Giocatori">
            {order.map((p) => {
              const id = p.tournamentEntryId;
              const out = excluded.has(id);
              const chosen = entering && (rounds ? roundTarget : current) === id && !out;
              return (
                <li key={id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    className={`${chosen ? 'selected' : ''} ${justSaved === id ? 'just-saved' : ''}`}
                    disabled={!entering || out || mutation.isPending || paused}
                    onClick={() => {
                      setSelected(id);
                      saveInput('');
                    }}
                  >
                    <span className="order">{p.playingOrder}</span>
                    <Avatar name={name(id)} />
                    <span className="result-name">{name(id)}</span>
                    <small>
                      {out
                        ? 'RITIRATO'
                        : rounds
                          ? progressSummary(
                              m,
                              m.progress.find((x) => x.tournamentEntryId === id),
                            ).replace('Nessun round registrato', 'nessun round')
                          : recorded(id) === null
                            ? 'da inserire'
                            : ''}
                    </small>
                    <strong>{recorded(id) ?? '—'}</strong>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <div
            className="scoreboard"
            role={entering ? 'radiogroup' : 'list'}
            aria-label={hiScore ? 'Punteggi finali' : 'Chi ha vinto?'}
            style={{
              gridTemplateColumns: `repeat(${order.length}, minmax(var(--bt-card-min), 1fr))`,
            }}
          >
            {order.map(card)}
          </div>
        )}
        {paused && (
          <p className="live-warning" role="status">
            Torneo in pausa: riprendilo dalla pagina del torneo per registrare risultati.
          </p>
        )}
        {rounds && roundTarget && (
          <>
            <p className="round-target" role="status" aria-live="polite">
              Round di <strong>{name(roundTarget)}</strong>
            </p>
            {(unit(roundTarget)?.members.length ?? 0) > 1 && (
              <RotationManager
                m={m}
                entryId={roundTarget}
                playerName={memberName}
                disabled={paused || !entering}
                saved={refreshed}
              />
            )}
            <RoundScoreEntry
              key={roundTarget}
              m={m}
              entryId={roundTarget}
              team={(unit(roundTarget)?.members.length ?? 0) > 1}
              disabled={paused || mutation.isPending}
              saved={(fresh, _message, roundNumber, corrected) =>
                roundSaved(fresh, roundNumber, corrected, roundTarget)
              }
              applyComputed={(value) => {
                if (hiScore) send({ scores: { [roundTarget]: value } });
                else {
                  saveForm({ ...form, scores: { ...form.scores, [roundTarget]: String(value) } });
                  setEntry('final');
                }
              }}
            />
          </>
        )}
        {entering && hiScore && !rounds && (
          <>
            {current && (unit(current)?.members.length ?? 0) > 1 && (
              <RotationManager
                m={m}
                entryId={current}
                playerName={memberName}
                disabled={paused}
                saved={refreshed}
              />
            )}
            <div className="score-center single">
              <div className="score-stage">
                <div className="turn-row">
                  <div className="turn-banner" aria-live="polite">
                    <DartIcon />
                    <span>
                      {current
                        ? `PUNTEGGIO DI ${name(current)}`
                        : heat?.status === 'completed'
                          ? `MANCHE ${heat.number} COMPLETATA`
                          : 'TUTTI REGISTRATI'}
                    </span>
                  </div>
                </div>
                <div className="paper-area">
                  <PaintSplash className="paper-splash" />
                  <div className={`score-paper ${input ? '' : 'is-empty'}`}>
                    <output aria-live="polite" aria-label="Punteggio finale da confermare">
                      {input || (current && recorded(current) !== null ? recorded(current) : '0')}
                    </output>
                    <span className="paper-caption">
                      FINALE DAL TOTEM · {game.rounds ?? m.scoringConfiguration.turns} ROUND · MAX{' '}
                      {limit}
                    </span>
                  </div>
                  <p
                    className={`paper-tag ${flash || mutation.isPending ? 'shown' : ''} ${flash ? 'ok' : ''}`}
                    role="status"
                  >
                    {mutation.isPending ? 'Salvataggio…' : flash}
                  </p>
                </div>
                <p className="totem-note">
                  <Info aria-hidden="true" />
                  {current
                    ? 'Il totem conta i punti: qui si registra il totale che mostra.'
                    : !activeHeat && nextHeat && t?.status === 'active'
                      ? `Avvia la manche ${nextHeat.number} per continuare, oppure tocca un giocatore per correggerlo.`
                      : 'Tocca un giocatore per correggere il suo punteggio.'}
                </p>
              </div>
            </div>
            <NumberKeypad
              value={input}
              change={saveInput}
              submit={() =>
                current && input !== '' && send({ scores: { [current]: Number(input) } })
              }
              undo={() => current && send({ scores: { [current]: null } })}
              busy={mutation.isPending || !current || paused || !roundsReady}
              canUndo={!!current && recorded(current) !== null}
              maximum={limit}
              notify={(text) => setFlash(text)}
              quick={[]}
              quickLabel="DAL TOTEM"
              limitLabel={`Massimo ${limit}`}
              okLabel={current ? `Conferma il punteggio di ${name(current)}` : 'Conferma'}
            />
          </>
        )}
        {entering && !hiScore && !rounds && (
          <section className="result-form" aria-label="Dettagli del risultato">
            {game.target && (
              <label className="field">
                Obiettivo del totem ({game.target.min}–{game.target.max}, facoltativo)
                <input
                  inputMode="numeric"
                  value={form.target}
                  onChange={(e) =>
                    saveForm({ ...form, target: e.target.value.replace(/\D/g, '').slice(0, 3) })
                  }
                />
              </label>
            )}
            <fieldset className="result-scores">
              <legend>{game.scoreLabel} (facoltativo)</legend>
              {playing.map((p) => (
                <label key={p.tournamentEntryId}>
                  <span>
                    {name(p.tournamentEntryId)}
                    {sideOf(m.gameMode as GameMode, p.playingOrder) && (
                      <small> · {sideOf(m.gameMode as GameMode, p.playingOrder)}</small>
                    )}
                  </span>
                  <input
                    inputMode="numeric"
                    aria-label={`${game.scoreLabel} di ${name(p.tournamentEntryId)}`}
                    value={form.scores[p.tournamentEntryId] ?? ''}
                    onChange={(e) =>
                      saveForm({
                        ...form,
                        scores: {
                          ...form.scores,
                          [p.tournamentEntryId]: e.target.value.replace(/\D/g, '').slice(0, 4),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </fieldset>
            {game.specialWin && (
              <div className="switch-row">
                <span className="row-label">
                  <span id="special-label">Vittoria con Shanghai</span>
                  <small>Singolo, doppio e triplo del numero nello stesso round</small>
                </span>
                <Switch
                  checked={form.special}
                  change={(special) => saveForm({ ...form, special })}
                  labelledBy="special-label"
                />
              </div>
            )}
            <label className="field">
              Note (facoltative)
              <input
                maxLength={500}
                value={form.notes}
                onChange={(e) => saveForm({ ...form, notes: e.target.value })}
              />
            </label>
            {!form.winner && formResult.derived && (
              <p className="hint">Dai punteggi vince {name(formResult.derived)}.</p>
            )}
            <button
              className="primary cta"
              disabled={!!formResult.reason || mutation.isPending || paused}
              onClick={() => send(formResult.input)}
            >
              {mutation.isPending
                ? 'Salvataggio…'
                : editing
                  ? 'SALVA CORREZIONE'
                  : 'CONFERMA RISULTATO'}
            </button>
            {formResult.reason && (
              <p className="form-reason" role="status">
                {formResult.reason}
              </p>
            )}
            {editing && (
              <button onClick={() => setEditing(false)} disabled={mutation.isPending}>
                Annulla correzione
              </button>
            )}
          </section>
        )}
        {cancellable && (
          <button className="result-cancel" onClick={() => setCancelling(true)}>
            Annulla incontro (non si gioca)…
          </button>
        )}
        {entering && hiScore && editing && (
          <button className="result-cancel" onClick={() => setEditing(false)}>
            Fine correzione
          </button>
        )}
        <ErrorMessage error={query.error ?? mutation.error} />
        {tie && (
          <TieAlert
            action={{
              label: 'SPAREGGIO SUL BERSAGLIO',
              disabled: mutation.isPending,
              run: async () => {
                if (!t) return;
                const fresh = await api.tournamentCommand(t, 'tiebreaks', {
                  targetId: m.id,
                  entryIds: tiedEntries,
                });
                client.setQueryData(['tournament', t.id], fresh);
                const playoff = fresh.matches.at(-1);
                if (playoff) navigate(`/partite/${playoff.id}`);
              },
            }}
            secondary={{ label: 'DECIDE L’ORGANIZZATORE', run: () => setDecide(true) }}
          >
            <strong>Parità per il primo posto.</strong> Decide uno spareggio sul totem oppure una
            decisione esplicita dell’organizzatore.
          </TieAlert>
        )}
        {(completed || cancelled) && !editing && (
          <section className="match-panel done">
            <div className="panel-head">
              <span className="panel-icon">
                <CrownIcon />
              </span>
              <div>
                <h2>
                  {cancelled
                    ? 'Incontro annullato'
                    : single && t?.status === 'completed'
                      ? 'Partita conclusa'
                      : 'Risultato registrato'}
                </h2>
                <p>
                  {m.result?.walkover
                    ? 'Vinto a tavolino per ritiro dell’avversario'
                    : m.result?.decision
                      ? `Deciso dall’organizzatore: ${m.result.decision.reason}`
                      : m.result?.special
                        ? 'Vittoria con Shanghai'
                        : m.result?.targetScore
                          ? `Obiettivo ${m.result.targetScore}`
                          : game.rules}
                </p>
              </div>
            </div>
            {!cancelled && (
              <div className="official">
                <StatusChip tone="success">RISULTATO UFFICIALE</StatusChip>
                <span className="hint">dal totem</span>
              </div>
            )}
            {!cancelled && (
              <ol className="final-rows" aria-label="Risultato dell’incontro">
                {ranked
                  .filter((p) => !excluded.has(p.tournamentEntryId))
                  .map((p, i) => (
                    <li
                      key={p.tournamentEntryId}
                      className={winner === p.tournamentEntryId ? 'first' : ''}
                    >
                      <span>{p.placement ?? i + 1}</span>
                      <span>{name(p.tournamentEntryId)}</span>
                      <strong>
                        {recorded(p.tournamentEntryId) ??
                          (winner === p.tournamentEntryId ? 'V' : '—')}
                      </strong>
                    </li>
                  ))}
              </ol>
            )}
            {m.result?.notes && !m.result.walkover && (
              <p className="hint">Note: {m.result.notes}</p>
            )}
            {m.result?.reconciliation.map((r) => (
              <p className="hint" key={r.entryId}>
                {name(r.entryId)}: ufficiale {r.official}, round {r.computed} — {r.reason}
              </p>
            ))}
            {next ? (
              <Link className="primary button" to={`/partite/${next.id}`}>
                PROSSIMO INCONTRO
              </Link>
            ) : single ? (
              <Link className="primary button" to="/partite/nuova">
                NUOVA PARTITA
              </Link>
            ) : (
              <Link className="primary button" to={back}>
                VAI AL TORNEO
              </Link>
            )}
            {!single && next && (
              <Link className="button" to={back}>
                Classifica del torneo
              </Link>
            )}
          </section>
        )}
      </main>
      {confirm && t && (
        <CorrectionDialog
          t={t}
          m={m}
          busy={mutation.isPending}
          error={mutation.error}
          close={() => setConfirm(null)}
          proceed={() => {
            inFlight.current = true;
            mutation.mutate({ ...confirm, confirmInvalidation: true });
          }}
        />
      )}
      {managing && <HeatEditor m={m} name={name} close={() => setManaging(false)} />}
      {closingHeat && activeHeat && (
        <Modal
          variant="dialog"
          tone="warning"
          alert
          title={`Completare la manche ${activeHeat.number}?`}
          close={() => setClosingHeat(false)}
        >
          <AlertTriangle aria-hidden="true" className="warning-icon" />
          <p>
            Mancano i risultati di {activeHeat.missing.map(name).join(', ')}. Restano da inserire:
            la classifica li aspetta e non conta zero.
          </p>
          <ErrorMessage error={heatCommand.error} />
          <button
            className="primary"
            disabled={heatCommand.isPending}
            onClick={() =>
              heatCommand.mutate(
                { action: 'heats/complete', heatId: activeHeat.heatId },
                { onSuccess: () => setClosingHeat(false) },
              )
            }
          >
            COMPLETA LA MANCHE
          </button>
          <button disabled={heatCommand.isPending} onClick={() => setClosingHeat(false)}>
            Torna alla manche
          </button>
        </Modal>
      )}
      {differences && (
        <ScoreReconciliation
          differences={differences.rows}
          name={name}
          busy={mutation.isPending}
          error={null}
          close={() => setDifferences(null)}
          review={() => {
            if (review) review(differences.rows[0]!.entryId);
            else {
              setSelected(differences.rows[0]!.entryId);
              setEntry('rounds');
            }
            setDifferences(null);
          }}
          confirm={(reasons) => {
            const change = { ...differences.change, reconciliation: reasons };
            setDifferences(null);
            inFlight.current = true;
            mutation.mutate(change);
          }}
        />
      )}
      {cancelling && (
        <Modal title="Annullare l’incontro?" close={() => setCancelling(false)}>
          <p>
            L’incontro non verrà giocato e non conta in classifica. Resta nello storico come
            annullato.
          </p>
          <label className="field">
            Motivo (obbligatorio)
            <input
              value={cancelReason}
              placeholder="es. chiusura del locale"
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </label>
          <ErrorMessage error={cancelMatch.error} />
          <button
            className="primary"
            disabled={!cancelReason.trim() || cancelMatch.isPending}
            onClick={() => cancelMatch.mutate()}
          >
            ANNULLA INCONTRO
          </button>
          <button onClick={() => setCancelling(false)}>Torna indietro</button>
        </Modal>
      )}
      {decide && t && (
        <DecisionSheet
          t={t}
          entries={tiedEntries}
          title="Decisione dell’organizzatore"
          close={() => setDecide(false)}
          done={(fresh) => {
            client.setQueryData(['tournament', t.id], fresh);
            void query.refetch();
            setDecide(false);
          }}
          targetId={m.id}
        />
      )}
    </div>
  );
}

/** The consequences of a correction, listed before anything is overwritten. */
function CorrectionDialog({
  t,
  m,
  busy,
  error,
  close,
  proceed,
}: {
  t: Tournament;
  m: Match;
  busy: boolean;
  error: unknown;
  close: () => void;
  proceed: () => void;
}) {
  const d = dependenciesOf(t, m);
  return (
    <Modal
      variant="dialog"
      tone="warning"
      alert
      title="Correggere un risultato già usato?"
      close={close}
    >
      <AlertTriangle aria-hidden="true" className="warning-icon" />
      <ul className="consequences">
        {d?.reopens && <li>La fase «{statusLabel(d.reopens.kind)}» verrà riaperta.</li>}
        {!!d?.matches.length && (
          <li>
            {d.matches.length} {d.matches.length === 1 ? 'incontro' : 'incontri'} delle fasi
            successive {d.matches.length === 1 ? 'verrà annullato' : 'verranno annullati'}.
          </li>
        )}
        {!!d?.playoffs.length && (
          <li>
            {d.playoffs.length} {d.playoffs.length === 1 ? 'spareggio' : 'spareggi'} non{' '}
            {d.playoffs.length === 1 ? 'vale' : 'valgono'} più.
          </li>
        )}
        {d?.tournamentCompleted && (
          <li>Il risultato ufficiale del torneo verrà ritirato fino a una nuova conferma.</li>
        )}
      </ul>
      <p className="hint">
        Tutto resta nello storico delle modifiche. Le fasi annullate vanno rigenerate.
      </p>
      <ErrorMessage error={error} />
      <button className="primary" disabled={busy} onClick={proceed}>
        CORREGGI E RIAPRI
      </button>
      <button disabled={busy} onClick={close}>
        Lascia com’è
      </button>
    </Modal>
  );
}
