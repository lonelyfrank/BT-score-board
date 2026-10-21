import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Pencil, Undo2 } from 'lucide-react';
import { uuid } from '../../../../packages/application/src/portable.js';
import { CrownIcon } from '../components/BrandIcons';
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
  canOrganizeMatch,
  dependenciesOf,
  evaluateResult,
  gameOf,
  maxScore,
  seatOf,
  sideOf,
  type GameMode,
} from '../services/rules';
import {
  Avatar,
  ErrorMessage,
  Header,
  InBar,
  Modal,
  ScreenBars,
  Switch,
  StatusChip,
  statusLabel,
} from '../components/ui';
import { NumberKeypad } from '../components/NumberKeypad';
import { HeatEditor, HeatTabs, viewedHeat } from '../components/Heats';
import { RotationManager, ScoreReconciliation } from '../components/Rounds';
import { DecisionSheet, TieAlert, entryName } from './Tournaments';

type Form = {
  winner: string | null;
  scores: Record<string, string>;
  target: string;
  special: boolean;
  notes: string;
};
const emptyForm: Form = { winner: null, scores: {}, target: '', special: false, notes: '' };

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
  annotate,
}: {
  query: UseQueryResult<Match>;
  tournament: UseQueryResult<Tournament>;
  /** Inside the guided match screen: no header, rounds are entered from Live and the matrix. */
  embedded?: boolean;
  /** Opens an entry's rounds when its official value differs from them. */
  review?: (entryId: string) => void;
  /** Extra line under a competitor's name (the companion total in the guided screen). */
  annotate?: (entryId: string) => string | null;
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
  const [params, setParams] = useSearchParams();
  const [managing, setManaging] = useState(() => params.get('organize') === '1');
  const [differences, setDifferences] = useState<{
    change: ResultInput;
    rows: { entryId: string; computed: number; official: number }[];
  } | null>(null);
  // One idempotency key per intended result: a repeated tap replays it instead of writing twice.
  const key = useRef(uuid());
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
  const heat = overview.heats.length ? viewedHeat(overview, heatChoice) : null;
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
  const unit = (id: string) => t?.entries.find((e) => e.id === id);
  const memberName = (playerId: string) =>
    t?.entries.flatMap((e) => e.members).find((x) => x.playerId === playerId)?.displayName ??
    'Giocatore';
  const refreshed = (fresh: Match) => {
    client.setQueryData(['match', m.id], fresh);
    void client.invalidateQueries({ queryKey: ['tournament', fresh.tournamentId] });
    void client.invalidateQueries({ queryKey: ['standings', fresh.tournamentId] });
    void client.invalidateQueries({ queryKey: ['session'] });
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
  const canManageHeats = t?.status === 'active' && canOrganizeMatch(m);

  const mutation = useMutation({
    mutationFn: (input: ResultInput) => api.recordResult(m, input, key.current),
    onSuccess: (fresh, sent) => {
      key.current = uuid();
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

  const [topBar, setTopBar] = useState<HTMLDivElement | null>(null);
  const [bottomBar, setBottomBar] = useState<HTMLDivElement | null>(null);
  const correct = () => {
    setForm(formOf(m));
    setEditing(true);
  };
  const rowTag = (id: string, chosen: boolean, out: boolean, score: number | null) => {
    const side = sideOf(m.gameMode as GameMode, seatOf(m, id));
    return out
      ? 'Ritirato'
      : hiScore
        ? chosen
          ? 'In inserimento'
          : score === null
            ? 'Da inserire'
            : 'Registrato'
        : chosen
          ? 'Vince'
          : (side ?? (completed ? '' : 'Tocca se vince'));
  };
  function row(p: Match['participants'][number]) {
    const id = p.tournamentEntryId;
    const out = excluded.has(id);
    const score = recorded(id);
    const chosen = hiScore
      ? current === id && entering
      : (completed && !editing ? winner : (form.winner ?? formResult.derived)) === id;
    const lead = (hiScore && top > 0 && score === top) || (!hiScore && chosen);
    const content = (
      <>
        <span className="n">{seatOf(m, id)}</span>
        <Avatar name={name(id)} size="md" />
        <span className="nm">
          <b>
            {name(id)}
            {lead && <CrownIcon className="inline-crown" role="img" aria-label="In testa" />}
          </b>
          <small>
            {[rowTag(id, chosen, out, score), annotate?.(id)].filter(Boolean).join(' · ')}
          </small>
        </span>
        <strong>{score ?? '—'}</strong>
      </>
    );
    const cls = `rk ${out ? 'out' : ''} ${justSaved === id ? 'just-saved' : ''}`;
    if (!entering || out)
      return (
        <li key={id} className={cls}>
          {content}
        </li>
      );
    return (
      <li key={id}>
        <button
          type="button"
          role="radio"
          aria-checked={chosen}
          className={cls}
          disabled={mutation.isPending || paused}
          onClick={() => {
            if (hiScore) {
              setSelected(id);
              saveInput('');
            } else saveForm({ ...form, winner: form.winner === id ? null : id });
          }}
        >
          {content}
        </button>
      </li>
    );
  }
  const finalRows = ranked.filter((p) => !excluded.has(p.tournamentEntryId));
  const podium = finalRows.length >= 3 && finalRows.every((p) => p.placement !== null);
  const verdict = cancelled
    ? 'Incontro annullato'
    : winner
      ? `Vince ${name(winner).includes(' + ') ? name(winner) : name(winner).split(' ')[0]}!`
      : 'Pari al primo posto';

  const content = (
    <>
      {embedded && completed && !editing && !locked && !ended && (
        <button type="button" className="btn sm ghost result-fix" onClick={correct}>
          <Pencil aria-hidden="true" /> Correggi risultato
        </button>
      )}
      {heated && (
        <InBar at="top">
          <HeatTabs
            overview={overview}
            viewing={heat?.heatId ?? null}
            select={(id) => {
              setHeatChoice(id);
              setSelected(null);
            }}
          />
          {(heat || (!activeHeat && nextHeat)) && (
            <div className="heat-bar">
              {heat && (
                <span>
                  Manche {heat.number} di {overview.heats.length}
                  {heat.missing.length > 0 && heat.status !== 'pending' && heat.status !== 'ready'
                    ? ` · ${heat.missing.length} da inserire`
                    : ''}
                </span>
              )}
              {!activeHeat && nextHeat && t?.status === 'active' && !completed && (
                <button
                  type="button"
                  className="btn sm cta"
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
                  type="button"
                  className="btn sm"
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
              {canManageHeats && (
                <button type="button" className="btn sm" onClick={() => setManaging(true)}>
                  Organizza manche
                </button>
              )}
            </div>
          )}
          <ErrorMessage error={heatCommand.error} />
        </InBar>
      )}
      {!heated && canManageHeats && (
        <button type="button" className="btn sm" onClick={() => setManaging(true)}>
          Organizza manche
        </button>
      )}
      {tracked && entering && !roundsReady && (
        <p className="note warn" role="status">
          <AlertTriangle aria-hidden="true" />
          <span>
            {game.scoreRequired
              ? 'Registra o salta tutti i round di questo partecipante prima del risultato finale.'
              : 'Registra o salta tutti i round prima del risultato finale.'}
          </span>
        </p>
      )}
      {paused && (
        <p className="note warn" role="status">
          <AlertTriangle aria-hidden="true" />
          <span>Torneo in pausa: riprendilo dalla pagina del torneo per registrare risultati.</span>
        </p>
      )}
      {(completed || cancelled) && !editing ? (
        <section className="result-done" aria-labelledby="result-title">
          <div className="result-head">
            <span className="marker">{verdict}</span>
            {!cancelled && <StatusChip tone="success">RISULTATO UFFICIALE</StatusChip>}
          </div>
          <h2 id="result-title" className="visually-hidden">
            {cancelled
              ? 'Incontro annullato'
              : single && t?.status === 'completed'
                ? 'Partita conclusa'
                : 'Risultato registrato'}
          </h2>
          {!cancelled && podium && (
            <ol className="pod" aria-label="Podio">
              {[finalRows[1], finalRows[0], finalRows[2]].map(
                (p, i) =>
                  p && (
                    <li key={p.tournamentEntryId} className={`p${[2, 1, 3][i]}`}>
                      <Avatar
                        name={name(p.tournamentEntryId)}
                        size={i === 1 ? undefined : 'sm'}
                        className={i === 1 ? 'gold' : ''}
                      />
                      <span>{name(p.tournamentEntryId)}</span>
                      <b>
                        {recorded(p.tournamentEntryId) ??
                          (winner === p.tournamentEntryId ? 'V' : '—')}
                      </b>
                      <small>{p.placement}°</small>
                    </li>
                  ),
              )}
            </ol>
          )}
          {!cancelled && (
            <ol className="list" aria-label="Risultato dell’incontro">
              {finalRows.slice(podium ? 3 : 0).map((p, i) => (
                <li
                  key={p.tournamentEntryId}
                  className={`rk ${winner === p.tournamentEntryId ? 'gold' : ''}`}
                >
                  <span
                    className={`n ${(p.placement ?? i + 1) <= 4 ? `r${p.placement ?? i + 1}` : ''}`}
                  >
                    {p.placement ?? i + 1}
                  </span>
                  <Avatar name={name(p.tournamentEntryId)} size="md" />
                  <span className="nm">
                    <b>{name(p.tournamentEntryId)}</b>
                  </span>
                  <strong>
                    {recorded(p.tournamentEntryId) ?? (winner === p.tournamentEntryId ? 'V' : '—')}
                  </strong>
                </li>
              ))}
            </ol>
          )}
          <p className="hint">
            {m.result?.walkover
              ? 'Vinto a tavolino per ritiro dell’avversario.'
              : m.result?.decision
                ? `Deciso dall’organizzatore: ${m.result.decision.reason}`
                : m.result?.special
                  ? 'Vittoria con Shanghai.'
                  : m.result?.targetScore
                    ? `Obiettivo ${m.result.targetScore}.`
                    : 'Il risultato ufficiale resta distinto dai round: correggere un turno non cambia il podio senza conferma.'}
          </p>
          {m.result?.notes && !m.result.walkover && <p className="hint">Note: {m.result.notes}</p>}
          {m.result?.reconciliation.map((r) => (
            <p className="hint" key={r.entryId}>
              {name(r.entryId)}: ufficiale {r.official}, round {r.computed} — {r.reason}
            </p>
          ))}
          {!single && next && (
            <Link className="mrow" to={back}>
              <span>
                Classifica del torneo
                <br />
                <small>{t?.name}</small>
              </span>
              <ChevronRight aria-hidden="true" />
            </Link>
          )}
          <InBar at="bottom">
            {next ? (
              <Link className="btn cta" to={`/partite/${next.id}`}>
                PROSSIMO INCONTRO
              </Link>
            ) : single ? (
              <Link className="btn cta" to="/partite/nuova">
                NUOVA PARTITA
              </Link>
            ) : (
              <Link className="btn cta" to={back}>
                VAI AL TORNEO
              </Link>
            )}
          </InBar>
        </section>
      ) : (
        <ol
          className="list result-rows"
          role={entering ? 'radiogroup' : undefined}
          aria-label={hiScore ? 'Punteggi finali' : 'Chi ha vinto?'}
        >
          {order.map(row)}
        </ol>
      )}
      {entering && hiScore && (
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
          <div className="score-entry">
            <p className="turn-banner eb" aria-live="polite">
              {current
                ? `PUNTEGGIO DI ${name(current)}`
                : heat?.status === 'completed'
                  ? `MANCHE ${heat.number} COMPLETATA`
                  : 'TUTTI REGISTRATI'}
            </p>
            <div className="paper">
              <div>
                <output aria-live="polite" aria-label="Punteggio finale da confermare">
                  {input || (current && recorded(current) !== null ? recorded(current) : '–')}
                </output>
                <small>
                  FINALE DAL TOTEM · {game.rounds ?? m.scoringConfiguration.turns} ROUND · MAX{' '}
                  {limit}
                </small>
              </div>
            </div>
            <p
              className={`paper-tag ${flash || mutation.isPending ? 'shown' : ''} ${flash ? 'ok' : ''}`}
              role="status"
            >
              {mutation.isPending
                ? 'Salvataggio…'
                : (flash ??
                  (current
                    ? 'Il totem conta i punti: qui si registra il totale che mostra.'
                    : !activeHeat && nextHeat && t?.status === 'active'
                      ? `Avvia la manche ${nextHeat.number} per continuare, oppure tocca un giocatore per correggerlo.`
                      : 'Tocca un giocatore per correggere il suo punteggio.'))}
            </p>
          </div>
          <NumberKeypad
            value={input}
            change={saveInput}
            submit={() => current && input !== '' && send({ scores: { [current]: Number(input) } })}
            busy={mutation.isPending || !current || paused || !roundsReady}
            maximum={limit}
            notify={(text) => setFlash(text)}
            limitLabel={`Massimo ${limit}`}
          />
          <InBar at="bottom">
            <div className="acts pair">
              <button
                type="button"
                className="btn undo"
                aria-label={
                  current ? `Rimuovi il punteggio di ${name(current)}` : 'Rimuovi punteggio'
                }
                disabled={mutation.isPending || !current || paused || recorded(current) === null}
                onClick={() => current && send({ scores: { [current]: null } })}
              >
                <Undo2 aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn cta"
                aria-label={current ? `Conferma il punteggio di ${name(current)}` : 'Conferma'}
                disabled={mutation.isPending || !current || paused || !roundsReady || input === ''}
                onClick={() =>
                  current && input !== '' && send({ scores: { [current]: Number(input) } })
                }
              >
                {mutation.isPending ? 'Salvataggio…' : input ? `Conferma ${input}` : 'Conferma'}
              </button>
            </div>
            {editing && (
              <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
                Fine correzione
              </button>
            )}
          </InBar>
        </>
      )}
      {entering && !hiScore && (
        <section className="card pad result-form" aria-label="Dettagli del risultato">
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
            <legend className="field-l">{game.scoreLabel} (facoltativo)</legend>
            {playing.map((p) => (
              <label key={p.tournamentEntryId}>
                <span>
                  {name(p.tournamentEntryId)}
                  {sideOf(m.gameMode as GameMode, seatOf(m, p.tournamentEntryId)) && (
                    <small>
                      {' '}
                      · {sideOf(m.gameMode as GameMode, seatOf(m, p.tournamentEntryId))}
                    </small>
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
              <span>
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
          <InBar at="bottom">
            {editing ? (
              <div className="acts split">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditing(false)}
                  disabled={mutation.isPending}
                >
                  Annulla correzione
                </button>
                <button
                  type="button"
                  className="btn cta"
                  disabled={!!formResult.reason || mutation.isPending || paused}
                  onClick={() => send(formResult.input)}
                >
                  {mutation.isPending ? 'Salvataggio…' : 'SALVA CORREZIONE'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn cta"
                disabled={!!formResult.reason || mutation.isPending || paused}
                onClick={() => send(formResult.input)}
              >
                {mutation.isPending ? 'Salvataggio…' : 'CONFERMA RISULTATO'}
              </button>
            )}
            {formResult.reason && (
              <p className="form-reason" role="status">
                {formResult.reason}
              </p>
            )}
          </InBar>
        </section>
      )}
      {cancellable && (
        <button type="button" className="btn ghost danger" onClick={() => setCancelling(true)}>
          Annulla incontro (non si gioca)…
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
      {managing && (
        <HeatEditor
          m={m}
          name={name}
          close={() => {
            setManaging(false);
            setParams(
              (p) => {
                const next = new URLSearchParams(p);
                next.delete('organize');
                return next;
              },
              { replace: true },
            );
          }}
        />
      )}
      {closingHeat && activeHeat && (
        <Modal
          variant="dialog"
          tone="warning"
          alert
          title={`Completare la manche ${activeHeat.number}?`}
          close={() => setClosingHeat(false)}
          footer={
            <>
              <button
                type="button"
                className="btn cta"
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
              <button
                type="button"
                className="btn"
                disabled={heatCommand.isPending}
                onClick={() => setClosingHeat(false)}
              >
                Torna alla manche
              </button>
            </>
          }
        >
          <p>
            Mancano i risultati di {activeHeat.missing.map(name).join(', ')}. Restano da inserire:
            la classifica li aspetta e non conta zero.
          </p>
          <ErrorMessage error={heatCommand.error} />
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
            review?.(differences.rows[0]!.entryId);
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
        <Modal
          title="Annullare l’incontro?"
          close={() => setCancelling(false)}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={() => setCancelling(false)}>
                Torna indietro
              </button>
              <button
                type="button"
                className="btn cta"
                disabled={!cancelReason.trim() || cancelMatch.isPending}
                onClick={() => cancelMatch.mutate()}
              >
                ANNULLA INCONTRO
              </button>
            </>
          }
        >
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
    </>
  );
  if (embedded) return content;
  return (
    <ScreenBars.Provider value={{ top: topBar, bottom: bottomBar }}>
      <div className="screen result-screen">
        <Header
          title={t?.name ?? game.label}
          subtitle={subtitle}
          back={back}
          action={
            completed && !editing && !locked && !ended ? (
              <button
                type="button"
                className="ibtn box"
                aria-label="Correggi risultato"
                onClick={correct}
              >
                <Pencil />
              </button>
            ) : undefined
          }
        />
        <div className="toolbar" ref={setTopBar} />
        <main className="result-main">{content}</main>
        <div className="actionbar" ref={setBottomBar} />
      </div>
    </ScreenBars.Provider>
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
      footer={
        <>
          <button type="button" className="btn cta" disabled={busy} onClick={proceed}>
            CORREGGI E RIAPRI
          </button>
          <button type="button" className="btn" disabled={busy} onClick={close}>
            Lascia com’è
          </button>
        </>
      }
    >
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
    </Modal>
  );
}
