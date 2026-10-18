import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, History, Pause } from 'lucide-react';
import { CrownIcon, DartIcon, PaintSplash } from '../components/BrandIcons';
import {
  api,
  entryMode,
  lastTurnScores,
  pollInterval,
  sharedApi,
  storage,
  type EntryMode,
  type Match,
  type TurnInput,
} from '../services/api';
import { tournamentPath } from '../services/session';
import { Avatar, ErrorMessage, Header, Loading, Modal, statusLabel } from '../components/ui';
import { NumberKeypad } from '../components/NumberKeypad';

const undoReasons = ['Punteggio errato', 'Giocatore sbagliato', 'Inserito per errore'];
const quickTotals = [20, 40, 60, 80, 100, 120, 140, 180];
const quickDarts = [0, 5, 20, 25, 40, 50, 57, 60];
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
        <main className="content">
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
  const back = t ? tournamentPath(t) : '/';
  const recent = turns.slice(0, 5);
  const editTurn = turns.find((x) => x.turn.id === editing);
  const fixInvalid =
    !editTurn ||
    fix.values.some((v) => v === '') ||
    fix.values.some(
      (v, i) =>
        Number(v) > (editTurn.scores[i]!.dartIndex === null ? config.maxTurnScore : config.maxDartScore),
    ) ||
    fix.values.reduce((n, v) => n + Number(v), 0) > config.maxTurnScore;

  return (
    <div className="live-page">
      <Header
        title="Hi-Score"
        subtitle={subtitle}
        back={back}
        action={
          <button
            className="icon-button"
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
      <main className="live-content">
        <div
          className="scoreboard"
          role="list"
          aria-label="Punteggi totali"
          style={{ gridTemplateColumns: `repeat(${m.participants.length}, minmax(80px, 1fr))` }}
        >
          {order.map((p) => {
            const current = live && turn?.participantId === p.tournamentEntryId;
            const row = m.scoreboard.find((s) => s.tournamentEntryId === p.tournamentEntryId);
            return (
              <article
                role="listitem"
                className={`score-card ${current ? 'selected' : ''}`}
                aria-current={current ? 'true' : undefined}
                key={p.tournamentEntryId}
              >
                {top > 0 && row?.total === top && (
                  <CrownIcon className="card-crown" role="img" aria-label="In testa" />
                )}
                <Avatar name={name(p.tournamentEntryId)} />
                <span className="player-name">{name(p.tournamentEntryId)}</span>
                <strong>{row?.total ?? 0}</strong>
                <span className={`card-tag ${current ? 'on' : ''}`}>
                  {current ? 'AL TIRO' : `${row?.turns ?? 0}/${config.turns} TURNI`}
                </span>
              </article>
            );
          })}
        </div>
        {tournamentPaused && (
          <p className="live-warning" role="status">
            Torneo in pausa: riprendilo dalla pagina del torneo per registrare punteggi.
          </p>
        )}
        {live && (
          <>
            <div className="score-center">
              <div className="score-stage">
                <div className="turn-row">
                  <div className="turn-banner" aria-live="polite">
                    <DartIcon />
                    <span>TURNO DI {turn ? name(turn.participantId) : '—'}</span>
                  </div>
                  <div className="entry-toggle" role="radiogroup" aria-label="Modo di inserimento">
                    {(['total', 'dart'] as const).map((id) => (
                      <button
                        key={id}
                        role="radio"
                        aria-checked={(id === 'dart') === dartMode}
                        aria-label={id === 'total' ? 'Totale turno' : 'Per freccetta'}
                        disabled={darts.length > 0 || recovering || mutation.isPending}
                        onClick={() => {
                          setMode(id);
                          entryMode.set(id);
                          change('');
                        }}
                      >
                        {id === 'total' ? 'TOT' : `×${config.dartsPerTurn}`}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="paper-area">
                  <PaintSplash className="paper-splash" />
                  <div className={`score-paper ${dartMode ? 'darts' : ''} ${input ? '' : 'is-empty'}`}>
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
                      <div className="dart-slots">
                        {Array.from({ length: config.dartsPerTurn }, (_, k) => {
                          const done = k < darts.length;
                          const current = k === darts.length;
                          return (
                            <span key={k} className={done ? 'done' : current ? 'cur' : ''}>
                              <small>F{k + 1}</small>
                              {done ? darts[k] : current ? input || '·' : '–'}
                            </span>
                          );
                        })}
                        <b>= {darts.reduce((n, d) => n + d, 0) + Number(input || 0)}</b>
                      </div>
                    ) : (
                      <span className="paper-caption">
                        TOTALE TURNO · MAX {config.maxTurnScore}
                      </span>
                    )}
                  </div>
                  {recovering ? (
                    <div className="recover" role="alert">
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
                    </div>
                  ) : (
                    <p
                      className={`paper-tag ${flash || mutation.isPending ? 'shown' : ''} ${flash?.ok ? 'ok' : ''}`}
                      role="status"
                    >
                      {mutation.isPending ? 'Salvataggio…' : flash?.text}
                    </p>
                  )}
                </div>
              </div>
              <dl className="stats">
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
            <NumberKeypad
              value={recovering ? '' : input}
              change={change}
              submit={confirm}
              undo={askUndo}
              busy={busy}
              canUndo={localDarts.length > 0 || undoable.length > 0}
              maximum={limit}
              locked={recovering}
              notify={(text) => setFlash({ text, ok: false })}
              quick={dartMode ? quickDarts : quickTotals}
              quickLabel={dartMode ? 'FRECCETTA' : 'COLPI RAPIDI'}
              limitLabel={`Massimo ${limit} ${dartMode ? 'per freccetta' : 'per turno'}`}
              okLabel={
                recovering
                  ? 'Riprova invio'
                  : dartMode
                    ? lastDart
                      ? 'Conferma ultima freccetta e chiudi il turno'
                      : `Conferma freccetta ${darts.length + 1}`
                    : 'Conferma totale e chiudi il turno'
              }
            />
          </>
        )}
        {m.status === 'completed' && (
          <section className="match-panel done">
            <div className="panel-head">
              <span className="panel-icon">
                <CrownIcon />
              </span>
              <div>
                <h2>Incontro terminato</h2>
                <p>
                  {config.turns} {config.turns === 1 ? 'turno' : 'turni'} per giocatore completati
                </p>
              </div>
            </div>
            <ol className="final-rows" aria-label="Classifica dell’incontro">
              {ranked.map((p, i) => (
                <li key={p.tournamentEntryId} className={i === 0 ? 'first' : ''}>
                  <span>{p.placement ?? i + 1}</span>
                  <span>{name(p.tournamentEntryId)}</span>
                  <strong>{p.finalScore ?? 0}</strong>
                </li>
              ))}
            </ol>
            <p className="hint">
              Risultato dell’incontro. Qualificazione e vincitore ufficiale si confermano nel torneo.
            </p>
            <Link className="primary button" to={back}>
              VAI ALLA CLASSIFICA
            </Link>
            <div className="pair">
              <button
                disabled={mutation.isPending || !undoable.length}
                onClick={() => {
                  setReason('');
                  setUndoOpen(true);
                }}
              >
                Annulla ultimo turno
              </button>
              <Link className="button" to="/partite/nuova">
                Nuova partita
              </Link>
            </div>
          </section>
        )}
        {m.status === 'paused' && (
          <section className="match-panel">
            <div className="panel-head">
              <span className="panel-icon warning">
                <Pause fill="currentColor" />
              </span>
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
            <button
              className="primary"
              disabled={mutation.isPending || tournamentPaused}
              onClick={() => run({ type: 'resume' })}
            >
              RIPRENDI INCONTRO
            </button>
          </section>
        )}
        {['ready', 'scheduled'].includes(m.status) && (
          <section className="match-panel">
            <div className="panel-head">
              <span className="panel-icon">
                <DartIcon />
              </span>
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
            <button
              className="primary"
              disabled={mutation.isPending || tournamentPaused}
              onClick={() => run({ type: 'start' })}
            >
              INIZIA INCONTRO
            </button>
          </section>
        )}
        <ErrorMessage error={query.error ?? mutation.error} />
        {!live && flash && (
          <p className="live-feedback" role="status">
            {flash.text}
          </p>
        )}
        <section className="recent" aria-labelledby="recent-title">
          <h2 id="recent-title">ULTIMI PUNTEGGI</h2>
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
          <div className="recover-actions">
            <button
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
            <button className="warning" disabled={mutation.isPending} onClick={confirm}>
              RIPROVA INVIO
            </button>
          </div>
        )}
      </main>
      {undoOpen && (
        <Modal title="Annullare l’ultimo punteggio?" close={() => setUndoOpen(false)}>
          <p>
            {undoTarget
              ? `Verranno rimossi ${undoTarget.total} punti di ${name(undoTarget.turn.participantId)} e il suo turno sarà riaperto.`
              : 'Nessun punteggio da annullare.'}
          </p>
          <fieldset className="reasons">
            <legend>Motivo (obbligatorio, resta nello storico)</legend>
            <div>
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
          <button
            className="primary"
            disabled={!reason || !undoTarget || mutation.isPending}
            onClick={() => run({ type: 'undo', reason })}
          >
            ANNULLA E RIAPRI IL TURNO
          </button>
          <button onClick={() => setUndoOpen(false)}>Lascia com’è</button>
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
                    <button
                      className="small"
                      onClick={() => {
                        setEditing(open ? null : x.turn.id);
                        setFix({ values: x.scores.map((s) => String(s.score)), reason: '' });
                      }}
                    >
                      Correggi
                    </button>
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
                      <button className="save" disabled={fixInvalid || mutation.isPending}>
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
          {live && (
            <button
              className="warning-outline"
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
