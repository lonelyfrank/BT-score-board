import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { CrownIcon, DartIcon, PaintSplash } from '../components/BrandIcons';
import { api, pollInterval, storage } from '../services/api';
import { Avatar, ErrorMessage, Header, Loading, Modal, statusLabel } from '../components/ui';
import { NumberKeypad } from '../components/NumberKeypad';

export function Live() {
  const { gameId = '' } = useParams();
  const client = useQueryClient();
  const [draft, setDraft] = useState<{ turnId?: string; value: string }>(() => {
    try {
      return JSON.parse(storage.get(`bt-input:${gameId}`) ?? '{"value":""}');
    } catch {
      return { value: '' };
    }
  });
  const [history, setHistory] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(''), 1800);
    return () => clearTimeout(timer);
  }, [feedback]);
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
  function change(value: string) {
    const next = { turnId: m?.turnState.currentTurn?.id, value };
    setDraft(next);
    storage.set(`bt-input:${gameId}`, JSON.stringify(next));
  }
  const mutation = useMutation({
    mutationFn: async (action: 'score' | 'undo' | 'start' | 'resume') => {
      if (!m) throw new Error('Caricamento partita in corso.');
      if (action === 'score') return api.submitTurn(m, Number(value));
      if (action === 'undo') return api.undo(m);
      return api.matchCommand(m, action);
    },
    onSuccess: (fresh, action) => {
      client.setQueryData(['match', gameId], fresh);
      change('');
      setConfirmUndo(false);
      setFeedback(
        action === 'undo'
          ? 'Ultimo turno annullato'
          : action === 'score'
            ? 'Turno salvato'
            : 'Partita avviata',
      );
      void client.invalidateQueries({ queryKey: ['tournament', fresh.tournamentId] });
      void client.invalidateQueries({ queryKey: ['standings', fresh.tournamentId] });
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
  const run = (action: 'score' | 'undo' | 'start' | 'resume') => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(action);
  };
  if (query.isPending) return <Loading />;
  if (!m)
    return (
      <>
        <Header title="Partita" />
        <ErrorMessage error={query.error} retry={() => void query.refetch()} />
      </>
    );
  const t = tournament.data;
  const name = (id: string) =>
    t?.entries.find((p) => p.id === id)?.displayNameAtRegistration ?? 'Giocatore';
  const turn = m.turnState.currentTurn;
  const active = m.scoreboard.find((s) => s.tournamentEntryId === turn?.participantId);
  const pending = api.getPending(`/matches/${gameId}/scores`);
  const completion = api.getPending(`/matches/${gameId}/turns/complete`);
  const recorded = m.scores.find((s) => !s.voided && s.turnId === turn?.id && s.dartIndex === null);
  const input = draft.turnId === turn?.id ? draft.value : '';
  const value = pending
    ? String(pending.body.score)
    : completion
      ? String(m.scores.find((s) => s.turnId === completion.body.turnId && !s.voided)?.score ?? 0)
      : recorded
        ? String(recorded.score)
        : input;
  const locked = !!pending || !!completion || !!recorded;
  const recent = m.scores
    .filter((s) => !s.voided)
    .slice(-5)
    .reverse();
  const tag = mutation.isPending
    ? 'Salvataggio…'
    : locked
      ? 'Da completare · conferma per recuperare'
      : feedback;
  const back = t?.mode === 'GROUPS' ? `/tornei/${m.tournamentId}` : `/hiscore/${m.tournamentId}`;
  return (
    <div className="live-page">
      <Header
        title="Hi-Score"
        subtitle={`${statusLabel(m.matchType)} · ${turn ? `Turno ${turn.turnNumber} di ${m.scoringConfiguration.turns}` : statusLabel(m.status)}`}
        back={back}
        action={
          <button
            className="icon-button"
            aria-label="Opzioni partita e cronologia"
            onClick={() => setHistory(true)}
          >
            <Settings />
          </button>
        }
      />
      <main className="live-content">
        <div className="scoreboard" role="list" aria-label="Punteggi">
          {m.participants.map((p) => {
            const current = turn?.participantId === p.tournamentEntryId;
            const last = m.scores
              .filter((s) => !s.voided && s.tournamentEntryId === p.tournamentEntryId)
              .slice(-3)
              .map((s) => String(s.score));
            return (
              <article
                role="listitem"
                className={`score-card ${current ? 'selected' : ''}`}
                aria-current={current ? 'true' : undefined}
                key={p.tournamentEntryId}
              >
                {current && <CrownIcon className="card-crown" />}
                <Avatar name={name(p.tournamentEntryId)} />
                <span className="player-name">{name(p.tournamentEntryId)}</span>
                <strong>
                  {m.scoreboard.find((s) => s.tournamentEntryId === p.tournamentEntryId)?.total ??
                    0}
                </strong>
                <span className="turn-chips" aria-label="Ultimi turni">
                  {[...Array<string>(3 - last.length).fill('—'), ...last].map((v, i) => (
                    <span key={i}>{v}</span>
                  ))}
                </span>
              </article>
            );
          })}
        </div>
        {m.status === 'active' && (
          <>
            <div className="score-center">
              <div className="score-stage">
                <div className="turn-row">
                  <div className="turn-banner" aria-live="polite">
                    <DartIcon />
                    <span>TURNO DI {turn ? name(turn.participantId) : '—'}</span>
                  </div>
                  <div
                    className="darts-left"
                    role="img"
                    aria-label={`${m.scoringConfiguration.dartsPerTurn} dardi`}
                  >
                    <span>
                      {Array.from({ length: m.scoringConfiguration.dartsPerTurn }, (_, i) => (
                        <i key={i} />
                      ))}
                    </span>
                  </div>
                </div>
                <div className="paper-area">
                  <PaintSplash className="paper-splash" />
                  <div className={`score-paper ${!value ? 'is-empty' : ''}`}>
                    <output aria-live="polite" aria-label="Punteggio da confermare">
                      {value || '0'}
                    </output>
                  </div>
                  <p className={`paper-tag ${tag ? 'shown' : ''}`} role="status">
                    {tag}
                  </p>
                </div>
              </div>
              <dl className="stats">
                <div>
                  <dt>MEDIA</dt>
                  <dd>{active?.average.toFixed(1) ?? '—'}</dd>
                </div>
                <div>
                  <dt>TURNI</dt>
                  <dd>
                    {active?.turns ?? 0}/{m.scoringConfiguration.turns}
                  </dd>
                </div>
                <div>
                  <dt>MIGLIOR GIRO</dt>
                  <dd>{active?.bestTurn ?? '—'}</dd>
                </div>
              </dl>
            </div>
            <NumberKeypad
              value={value}
              change={change}
              submit={() => run('score')}
              undo={() => setConfirmUndo(true)}
              busy={mutation.isPending || !turn}
              canUndo={recent.length > 0}
              maximum={m.scoringConfiguration.maxTurnScore}
              locked={locked}
              notify={setFeedback}
            />
          </>
        )}
        {['ready', 'scheduled', 'paused'].includes(m.status) && (
          <section className="panel">
            <h2>{statusLabel(m.status)}</h2>
            <button
              className="primary"
              disabled={mutation.isPending}
              onClick={() => run(m.status === 'paused' ? 'resume' : 'start')}
            >
              {m.status === 'paused' ? 'Riprendi partita' : 'Inizia incontro'}
            </button>
          </section>
        )}
        {m.status === 'completed' && (
          <section className="winner">
            <CrownIcon className="winner-crown" />
            <h2>Incontro terminato</h2>
            {m.winnerEntryId ? (
              <p className="winner-name">{name(m.winnerEntryId)} vince!</p>
            ) : (
              <p>Consulta la classifica per qualificazioni e parità.</p>
            )}
            <Link className="primary button" to={back}>
              VAI ALLA CLASSIFICA
            </Link>
            <Link className="button" to="/partite/nuova">
              Nuova partita
            </Link>
            <button
              className="ghost"
              disabled={mutation.isPending || !recent.length}
              onClick={() => setConfirmUndo(true)}
            >
              Annulla ultimo turno
            </button>
          </section>
        )}
        <ErrorMessage error={query.error ?? mutation.error} />
        {m.status !== 'active' && feedback && (
          <p className="live-feedback" role="status">
            {feedback}
          </p>
        )}
        <section className="recent" aria-labelledby="recent-title">
          <h2 id="recent-title">ULTIMI TURNI</h2>
          <ol>
            {Array.from({ length: 5 }, (_, index) => {
              const s = recent[index];
              return (
                <li key={index} className={s && index === 0 ? 'new' : ''}>
                  {s ? (
                    <>
                      <small>{name(s.tournamentEntryId)}</small>
                      <strong>{s.score}</strong>
                    </>
                  ) : (
                    <strong>-</strong>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      </main>
      {history && (
        <Modal title="Cronologia turni" close={() => setHistory(false)}>
          <ol className="history-list">
            {m.scores
              .filter((s) => !s.voided)
              .map((s, i) => (
                <li key={s.id}>
                  <span>
                    {i + 1}. {name(s.tournamentEntryId)}
                  </span>
                  <strong>{s.score}</strong>
                </li>
              ))}
          </ol>
          {!recent.length && <p>Nessun turno registrato.</p>}
          <p className="hint">
            Annulla riapre l’ultimo turno. Le fasi già confermate richiedono la riapertura
            amministrativa.
          </p>
        </Modal>
      )}
      {confirmUndo && (
        <Modal title="Annullare l’ultimo turno?" close={() => setConfirmUndo(false)}>
          <p>Il punteggio verrà rimosso e il turno riaperto.</p>
          <ErrorMessage error={mutation.error} />
          <button className="primary" disabled={mutation.isPending} onClick={() => run('undo')}>
            Conferma annullamento
          </button>
        </Modal>
      )}
    </div>
  );
}
