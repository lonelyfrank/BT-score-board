import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, History, Pause, Undo2 } from 'lucide-react';
import { CrownIcon, DartIcon } from '../components/BrandIcons';
import {
  api,
  dataMode,
  entryMode,
  lastTurnScores,
  pollInterval,
  sharedApi,
  storage,
  type EntryMode,
  type Match,
  type TurnInput,
} from '../services/api';
import { isAdmin, useAccount } from '../services/cloud';
import { tournamentPath } from '../services/session';
import {
  Avatar,
  ErrorMessage,
  Header,
  Loading,
  Modal,
  Segmented,
  statusLabel,
} from '../components/ui';
import { NumberKeypad } from '../components/NumberKeypad';

const undoReasons = ['Punteggio errato', 'Giocatore sbagliato', 'Inserito per errore'];
type Draft = { turnId?: string; value: string; darts: number[] };
type Action =
  | { type: 'score'; input: TurnInput }
  | { type: 'undo'; reason: string }
  | { type: 'correct'; changes: { scoreId: string; score: number }[]; reason: string }
  | { type: 'start' | 'resume' | 'pause' };

/** Turns that hold scores, newest first, with their total and darts. */
function scoredTurns(m: Match) {
  return m.turns
    .map((turn) => {
      const scores = m.scores
        .filter((s) => s.turnId === turn.id && !s.voided)
        .sort((a, b) => (a.dartIndex ?? 0) - (b.dartIndex ?? 0));
      const last = scores.reduce((at, s) => (s.createdAt > at ? s.createdAt : at), '');
      return { turn, scores, last, total: scores.reduce((n, s) => n + s.score, 0) };
    })
    .filter((x) => x.scores.length)
    .sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
}

export function Live() {
  const { gameId = '' } = useParams();
  const client = useQueryClient();
  // In cloud mode only admins record scores: the server enforces it, the screen just hides the controls.
  const account = useAccount();
  const readOnly = dataMode === 'cloud' && !isAdmin(account);
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      return { darts: [], ...JSON.parse(storage.get(`bt-input:${gameId}`) ?? '{"value":""}') };
    } catch {
      return { value: '', darts: [] };
    }
  });
  const [mode, setMode] = useState<EntryMode>(entryMode.get);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [fix, setFix] = useState<{ values: string[]; reason: string }>({ values: [], reason: '' });
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(timer);
  }, [flash]);
  const query = useQuery({
    queryKey: ['match', gameId],
    queryFn: () => api.match(gameId),
    refetchInterval: pollInterval,
  });
  const m = query.data;
  const tournament = useQuery({
    queryKey: ['tournament', m?.tournamentId],
    queryFn: () => api.tournament(m!.tournamentId),
    enabled: !!m,
  });
  const turn = m?.turnState.currentTurn ?? null;
  function save(next: Draft) {
    setDraft(next);
    storage.set(`bt-input:${gameId}`, JSON.stringify(next));
  }
  // A draft belongs to one turn: once the turn moved on it is forgotten.
  const own = draft.turnId === turn?.id;
  const input = own ? draft.value : '';
  const localDarts = own ? draft.darts : [];
  const change = (value: string) => save({ turnId: turn?.id, value, darts: localDarts });

  const mutation = useMutation({
    mutationFn: async (action: Action) => {
      if (!m) throw new Error('Caricamento partita in corso.');
      if (action.type === 'score') return api.submitTurn(m, action.input);
      if (action.type === 'undo') return api.undo(m, action.reason);
      if (action.type === 'correct') return api.correct(m, action.changes, action.reason);
      return api.matchCommand(m, action.type);
    },
    onSuccess: (fresh, action) => {
      client.setQueryData(['match', gameId], fresh);
      setUndoOpen(false);
      setEditing(null);
      if (action.type === 'score') {
        save({ value: '', darts: [] });
        try {
          navigator.vibrate?.(12);
        } catch {
          /* No haptics. */
        }
      }
      if (action.type === 'pause') setHistoryOpen(false);
      setFlash({
        ok: true,
        text: {
          score: 'Turno registrato',
          undo: 'Turno riaperto',
          correct: 'Punteggio corretto',
          start: 'Incontro iniziato',
          resume: 'Incontro ripreso',
          pause: 'Incontro in pausa',
        }[action.type],
      });
      void client.invalidateQueries({ queryKey: ['tournament', fresh.tournamentId] });
      void client.invalidateQueries({ queryKey: ['standings', fresh.tournamentId] });
      void client.invalidateQueries({ queryKey: ['session'] });
    },
    onError: () => {
      // The draft stays: the same player can confirm again once the problem is solved.
      void query.refetch();
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  // A second tap can arrive before React disables the keypad: only one command at a time.
  const inFlight = useRef(false);
  const run = (action: Action) => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(action);
  };

  if (query.isPending) return <Loading />;
  if (!m)
    return (
      <>
        <Header title="Partita" />
        <main>
          <ErrorMessage error={query.error} retry={() => void query.refetch()} />
        </main>
      </>
    );
  const t = tournament.data;
  const name = (id: string) =>
    t?.entries.find((p) => p.id === id)?.displayNameAtRegistration ?? 'Giocatore';
  const config = m.scoringConfiguration;
  const live = m.status === 'active';
  const tournamentPaused = t?.status === 'paused';

  // What the server already holds for the current turn, and any unconfirmed send (shared mode).
  const onServer = m.scores.filter((s) => !s.voided && s.turnId === turn?.id);
  const serverDarts = onServer.filter((s) => s.dartIndex !== null).map((s) => s.score);
  const serverTotal = onServer.find((s) => s.dartIndex === null);
  const pending = api.getPending(`/matches/${gameId}/scores`);
  const completion = api.getPending(`/matches/${gameId}/turns/complete`);
  const recovering = !!pending || !!completion || !!serverTotal;
  const darts = [...serverDarts, ...localDarts];
  const dartMode = mode === 'dart' || serverDarts.length > 0;
  const limit = dartMode ? config.maxDartScore : config.maxTurnScore;
  const pendingValue = pending
    ? Number(pending.body.score)
    : serverTotal
      ? serverTotal.score
      : completion
        ? onServer.reduce((n, s) => n + s.score, 0)
        : null;
  const shown = pendingValue !== null && !dartMode ? String(pendingValue) : input || '0';
  const busy = mutation.isPending || !turn || tournamentPaused;
  const lastDart = darts.length + 1 === config.dartsPerTurn;

  function confirm() {
    if (recovering) {
      // Same request again: the adapter replays the unconfirmed command.
      return run({
        type: 'score',
        input: dartMode ? [...darts, ...(input ? [Number(input)] : [])] : (pendingValue ?? 0),
      });
    }
    if (input === '') return;
    const value = Number(input);
    if (!dartMode) return run({ type: 'score', input: value });
    const next = [...darts, value];
    if (next.length < config.dartsPerTurn)
      return save({ turnId: turn?.id, value: '', darts: [...localDarts, value] });
    run({ type: 'score', input: next });
  }
  function askUndo() {
    if (localDarts.length) {
      save({ turnId: turn?.id, value: '', darts: localDarts.slice(0, -1) });
      setFlash({ ok: true, text: 'Freccetta annullata' });
      return;
    }
    setReason('');
    setUndoOpen(true);
  }

  const turns = scoredTurns(m);
  const undoable = lastTurnScores(m);
  const undoTarget = turns.find((x) => x.turn.id === undoable[0]?.turnId);
  const totals = m.scoreboard.map((s) => s.total);
  const top = Math.max(0, ...totals);
  const active = m.scoreboard.find((s) => s.tournamentEntryId === turn?.participantId);
  const ranked = [...m.participants].sort(
    (a, b) =>
      (a.placement ?? 99) - (b.placement ?? 99) || (b.finalScore ?? 0) - (a.finalScore ?? 0),
  );
  const order = [...m.participants].sort((a, b) => a.playingOrder - b.playingOrder);
  const stage = statusLabel(m.matchType);
  const subtitle = live
    ? `${stage} · turno ${turn?.turnNumber ?? '—'} di ${config.turns}`
    : `${stage} · ${m.status === 'completed' ? 'conclusa' : m.status === 'paused' ? 'in pausa' : 'pronta'}`;
  // Back to the phase the match belongs to: a Hi-Score final opens the Finale tab.
  const finalStage =
    t?.mode === 'QUICK_HIGH_SCORE' && t.stages.find((s) => s.id === m.stageId)?.kind === 'final';
  const back = t ? `${tournamentPath(t)}${finalStage ? '?tab=final' : ''}` : '/';
  const recent = turns.slice(0, 5);
  const editTurn = turns.find((x) => x.turn.id === editing);
  const fixInvalid =
    !editTurn ||
    fix.values.some((v) => v === '') ||
    fix.values.some(
      (v, i) =>
        Number(v) >
        (editTurn.scores[i]!.dartIndex === null ? config.maxTurnScore : config.maxDartScore),
    ) ||
    fix.values.reduce((n, v) => n + Number(v), 0) > config.maxTurnScore;

  return (
    <div className="screen legacy-screen">
      <Header
        title="Hi-Score"
        subtitle={subtitle}
        back={back}
        action={
          <button
            type="button"
            className="ibtn box"
            aria-label="Cronologia e opzioni incontro"
            onClick={() => {
              setEditing(null);
              setHistoryOpen(true);
            }}
          >
            <History />
          </button>
        }
      />
      <main className="legacy-main">
        <ol className="list" aria-label="Punteggi totali">
          {order.map((p) => {
            const current = live && turn?.participantId === p.tournamentEntryId;
            const row = m.scoreboard.find((s) => s.tournamentEntryId === p.tournamentEntryId);
            return (
              <li
                className={`rk ${current ? 'me' : ''}`}
                aria-current={current ? 'true' : undefined}
                key={p.tournamentEntryId}
              >
                <span className="n">{p.playingOrder}</span>
                <Avatar name={name(p.tournamentEntryId)} size="md" />
                <span className="nm">
                  <b>
                    {name(p.tournamentEntryId)}
                    {top > 0 && row?.total === top && (
                      <CrownIcon className="inline-crown" role="img" aria-label="In testa" />
                    )}
                  </b>
                  <small>{current ? 'AL TIRO' : `${row?.turns ?? 0}/${config.turns} TURNI`}</small>
                </span>
                <strong>{row?.total ?? 0}</strong>
              </li>
            );
          })}
        </ol>
        {tournamentPaused && (
          <p className="note warn" role="status">
            <AlertTriangle aria-hidden="true" />
            <span>
              Torneo in pausa: riprendilo dalla pagina del torneo per registrare punteggi.
            </span>
          </p>
        )}
        {live && (
          <>
            <p className="turn-banner eb" aria-live="polite">
              TURNO DI {turn ? name(turn.participantId) : '—'}
            </p>
            <div className="legacy-entry">
              {!readOnly && (
                <Segmented
                  label="Modo di inserimento"
                  small
                  value={dartMode ? 'dart' : 'total'}
                  change={(id) => {
                    setMode(id);
                    entryMode.set(id);
                    change('');
                  }}
                  options={[
                    {
                      id: 'total',
                      label: 'Totale turno',
                      disabled: darts.length > 0 || recovering || mutation.isPending,
                    },
                    {
                      id: 'dart',
                      label: `Per freccetta ×${config.dartsPerTurn}`,
                      disabled: darts.length > 0 || recovering || mutation.isPending,
                    },
                  ]}
                />
              )}
              <dl className="card stat3">
                <div>
                  <dt>MEDIA</dt>
                  <dd>{active?.turns ? active.average.toFixed(1) : '—'}</dd>
                </div>
                <div>
                  <dt>TURNI</dt>
                  <dd>
                    {active?.turns ?? 0}/{config.turns}
                  </dd>
                </div>
                <div>
                  <dt>MIGLIOR GIRO</dt>
                  <dd>{active?.turns ? active.bestTurn : '—'}</dd>
                </div>
              </dl>
            </div>
            {!readOnly && (
              <>
                <div className="paper">
                  <div>
                    <output
                      aria-live="polite"
                      aria-label={
                        dartMode
                          ? `Freccetta ${darts.length + 1} da confermare`
                          : 'Totale turno da confermare'
                      }
                    >
                      {shown}
                    </output>
                    {dartMode ? (
                      <small>
                        {Array.from({ length: config.dartsPerTurn }, (_, k) =>
                          k < darts.length ? darts[k] : k === darts.length ? input || '·' : '–',
                        ).join(' + ')}{' '}
                        = {darts.reduce((n, d) => n + d, 0) + Number(input || 0)}
                      </small>
                    ) : (
                      <small>TOTALE TURNO · MAX {config.maxTurnScore}</small>
                    )}
                  </div>
                </div>
                {recovering ? (
                  <p className="note warn" role="alert">
                    <AlertTriangle aria-hidden="true" />
                    <span>
                      Invio non confermato
                      {pendingValue !== null && (
                        <>
                          : <strong>{pendingValue}</strong>
                        </>
                      )}{' '}
                      a {turn ? name(turn.participantId) : '—'}. Riprova con la stessa richiesta.
                    </span>
                  </p>
                ) : (
                  <p
                    className={`paper-tag ${flash || mutation.isPending ? 'shown' : ''} ${flash?.ok ? 'ok' : ''}`}
                    role="status"
                  >
                    {mutation.isPending ? 'Salvataggio…' : flash?.text}
                  </p>
                )}
                <NumberKeypad
                  value={recovering ? '' : input}
                  change={change}
                  submit={confirm}
                  busy={busy}
                  maximum={limit}
                  locked={recovering}
                  notify={(text) => setFlash({ text, ok: false })}
                  limitLabel={`Massimo ${limit} ${dartMode ? 'per freccetta' : 'per turno'}`}
                />
              </>
            )}
          </>
        )}
        {m.status === 'completed' && (
          <section className="card pad">
            <div className="panel-head">
              <CrownIcon />
              <div>
                <h2>Incontro terminato</h2>
                <p>
                  {config.turns} {config.turns === 1 ? 'turno' : 'turni'} per giocatore completati
                </p>
              </div>
            </div>
            <ol className="list" aria-label="Classifica dell’incontro">
              {ranked.map((p, i) => (
                <li key={p.tournamentEntryId} className={`rk ${i === 0 ? 'gold' : ''}`}>
                  <span className={`n r${Math.min(4, p.placement ?? i + 1)}`}>
                    {p.placement ?? i + 1}
                  </span>
                  <Avatar name={name(p.tournamentEntryId)} size="md" />
                  <span className="nm">
                    <b>{name(p.tournamentEntryId)}</b>
                  </span>
                  <strong>{p.finalScore ?? 0}</strong>
                </li>
              ))}
            </ol>
            <p className="hint">
              Risultato dell’incontro. Qualificazione e vincitore ufficiale si confermano nel
              torneo.
            </p>
            <Link className="btn cta" to={back}>
              VAI ALLA CLASSIFICA
            </Link>
            {readOnly ? null : (
              <div className="pair">
                <button
                  type="button"
                  className="btn"
                  disabled={mutation.isPending || !undoable.length}
                  onClick={() => {
                    setReason('');
                    setUndoOpen(true);
                  }}
                >
                  Annulla ultimo turno
                </button>
                <Link className="btn" to="/partite/nuova">
                  Nuova partita
                </Link>
              </div>
            )}
          </section>
        )}
        {m.status === 'paused' && (
          <section className="card pad">
            <div className="panel-head">
              <Pause fill="currentColor" className="warning-icon" />
              <div>
                <h2>Incontro in pausa</h2>
                <p>
                  Turno {turn?.turnNumber ?? '—'} di {config.turns}
                </p>
              </div>
            </div>
            <p>
              Il turno di {turn ? name(turn.participantId) : '—'} resta dov’era. Nessun punteggio si
              può registrare finché l’incontro è in pausa.
            </p>
            {!readOnly && (
              <button
                type="button"
                className="btn cta"
                disabled={mutation.isPending || tournamentPaused}
                onClick={() => run({ type: 'resume' })}
              >
                RIPRENDI INCONTRO
              </button>
            )}
          </section>
        )}
        {['ready', 'scheduled'].includes(m.status) && (
          <section className="card pad">
            <div className="panel-head">
              <DartIcon />
              <div>
                <h2>Incontro pronto</h2>
                <p>
                  {m.participants.length} giocatori · {config.turns}{' '}
                  {config.turns === 1 ? 'turno' : 'turni'}
                </p>
              </div>
            </div>
            <p>
              Ordine di tiro: {order.map((p) => name(p.tournamentEntryId)).join(' → ')}. Il
              bersaglio è libero.
            </p>
            {!readOnly && (
              <button
                type="button"
                className="btn cta"
                disabled={mutation.isPending || tournamentPaused}
                onClick={() => run({ type: 'start' })}
              >
                INIZIA INCONTRO
              </button>
            )}
          </section>
        )}
        <ErrorMessage error={query.error ?? mutation.error} />
        {!live && flash && (
          <p className="hint" role="status">
            {flash.text}
          </p>
        )}
        <section className="recent" aria-labelledby="recent-title">
          <h2 id="recent-title" className="set-h">
            Ultimi punteggi
          </h2>
          <ol>
            {Array.from({ length: 5 }, (_, index) => {
              const x = recent[index];
              return (
                <li key={index} className={x && index === 0 ? 'new' : ''}>
                  {x ? (
                    <>
                      <small>{name(x.turn.participantId)}</small>
                      <strong>{x.total}</strong>
                    </>
                  ) : (
                    <strong>—</strong>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
        {live && recovering && sharedApi && (
          <div className="pair">
            <button
              type="button"
              className="btn"
              disabled={mutation.isPending}
              onClick={async () => {
                // The server is the reference: re-read it, then forget the unconfirmed send.
                const fresh = await query.refetch();
                if (fresh.data) {
                  sharedApi!.clearPending(gameId);
                  client.setQueryData(['match', gameId], { ...fresh.data });
                  setFlash({ ok: true, text: 'Stato riletto dal server' });
                }
              }}
            >
              Ricarica stato
            </button>
            <button
              type="button"
              className="btn warn"
              disabled={mutation.isPending}
              onClick={confirm}
            >
              RIPROVA INVIO
            </button>
          </div>
        )}
      </main>
      {live && !readOnly && (
        <div className="actionbar">
          <div className="acts pair">
            <button
              type="button"
              className="btn undo"
              aria-label="Annulla ultimo punteggio"
              disabled={busy || !(localDarts.length > 0 || undoable.length > 0)}
              onClick={askUndo}
            >
              <Undo2 aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn cta"
              disabled={busy || (input === '' && !recovering)}
              aria-label={
                recovering
                  ? 'Riprova invio'
                  : dartMode
                    ? lastDart
                      ? 'Conferma ultima freccetta e chiudi il turno'
                      : `Conferma freccetta ${darts.length + 1}`
                    : 'Conferma totale e chiudi il turno'
              }
              onClick={confirm}
            >
              {recovering
                ? 'Riprova invio'
                : dartMode
                  ? lastDart
                    ? 'Chiudi il turno'
                    : `Freccetta ${darts.length + 1}`
                  : 'Conferma totale'}
            </button>
          </div>
        </div>
      )}
      {undoOpen && (
        <Modal
          title="Annullare l’ultimo punteggio?"
          close={() => setUndoOpen(false)}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={() => setUndoOpen(false)}>
                Lascia com’è
              </button>
              <button
                type="button"
                className="btn cta"
                disabled={!reason || !undoTarget || mutation.isPending}
                onClick={() => run({ type: 'undo', reason })}
              >
                ANNULLA E RIAPRI IL TURNO
              </button>
            </>
          }
        >
          <p>
            {undoTarget
              ? `Verranno rimossi ${undoTarget.total} punti di ${name(undoTarget.turn.participantId)} e il suo turno sarà riaperto.`
              : 'Nessun punteggio da annullare.'}
          </p>
          <fieldset className="reasons">
            <legend className="field-l">Motivo (obbligatorio, resta nello storico)</legend>
            <div className="chips">
              {undoReasons.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="chip"
                  aria-pressed={reason === r}
                  onClick={() => setReason(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </fieldset>
          <ErrorMessage error={mutation.error} />
        </Modal>
      )}
      {historyOpen && (
        <Modal title="Cronologia incontro" close={() => setHistoryOpen(false)}>
          <ol className="history-list">
            {turns.map((x) => {
              const open = editing === x.turn.id;
              return (
                <li key={x.turn.id} className={open ? 'editing' : ''}>
                  <div className="history-row">
                    <span>
                      <span>
                        {name(x.turn.participantId)} · turno {x.turn.turnNumber}
                      </span>
                      <small>
                        {x.scores[0]!.dartIndex === null
                          ? 'Totale turno'
                          : `Freccette: ${x.scores.map((s) => s.score).join(' + ')}`}
                      </small>
                    </span>
                    <strong>{x.total}</strong>
                    {!readOnly && (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          setEditing(open ? null : x.turn.id);
                          setFix({ values: x.scores.map((s) => String(s.score)), reason: '' });
                        }}
                      >
                        Correggi
                      </button>
                    )}
                  </div>
                  {open && (
                    <form
                      className="fix-row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const changes = x.scores
                          .map((s, i) => ({ scoreId: s.id, score: Number(fix.values[i]) }))
                          .filter((c, i) => c.score !== x.scores[i]!.score);
                        if (!changes.length) return setEditing(null);
                        run({ type: 'correct', changes, reason: fix.reason.trim() });
                      }}
                    >
                      {x.scores.map((s, i) => (
                        <input
                          key={s.id}
                          inputMode="numeric"
                          aria-label={
                            s.dartIndex === null ? 'Nuovo totale' : `Freccetta ${s.dartIndex}`
                          }
                          value={fix.values[i] ?? ''}
                          onChange={(e) => {
                            const values = [...fix.values];
                            values[i] = e.target.value.replace(/\D/g, '').slice(0, 4);
                            setFix({ ...fix, values });
                          }}
                        />
                      ))}
                      <input
                        className="reason"
                        aria-label="Motivo della correzione (facoltativo)"
                        placeholder="Motivo (facoltativo)"
                        value={fix.reason}
                        onChange={(e) => setFix({ ...fix, reason: e.target.value })}
                      />
                      <button className="btn sm cta" disabled={fixInvalid || mutation.isPending}>
                        Salva
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ol>
          {!turns.length && <p className="hint">Nessun punteggio registrato.</p>}
          <ErrorMessage error={mutation.error} />
          <p className="hint">
            Le correzioni restano nello storico con il valore precedente. Una fase già confermata va
            riaperta dall’organizzatore nel torneo.
          </p>
          {live && !readOnly && (
            <button
              type="button"
              className="btn warn-outline"
              disabled={mutation.isPending}
              onClick={() => run({ type: 'pause' })}
            >
              Metti in pausa l’incontro
            </button>
          )}
        </Modal>
      )}
    </div>
  );
}
