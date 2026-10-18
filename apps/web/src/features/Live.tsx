import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Settings, Crown } from 'lucide-react';
import { api, storage } from '../services/api';
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
  const query = useQuery({
    queryKey: ['match', gameId],
    queryFn: () => api.match(gameId),
    refetchInterval: 5000,
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
            ? 'Turno registrato'
            : 'Partita avviata',
      );
      void client.invalidateQueries({ queryKey: ['tournament', fresh.tournamentId] });
      void client.invalidateQueries({ queryKey: ['standings', fresh.tournamentId] });
    },
    onError: () => {
      void query.refetch();
    },
  });
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
            aria-label="Cronologia partita"
            onClick={() => setHistory(true)}
          >
            <Settings />
          </button>
        }
      />
      <main className="live-content">
        <div className="scoreboard">
          {m.participants.map((p) => (
            <article
              className={`score-card ${turn?.participantId === p.tournamentEntryId ? 'selected' : ''}`}
              aria-current={turn?.participantId === p.tournamentEntryId ? 'true' : undefined}
              key={p.tournamentEntryId}
            >
              <Avatar name={name(p.tournamentEntryId)} />
              <span className="player-name">{name(p.tournamentEntryId)}</span>
              <strong>
                {m.scoreboard.find((s) => s.tournamentEntryId === p.tournamentEntryId)?.total ?? 0}
              </strong>
              <small>
                {turn?.participantId === p.tournamentEntryId ? 'AL TIRO' : 'PUNTI TOTALI'}
              </small>
            </article>
          ))}
        </div>
        {m.status === 'active' && (
          <>
            <div className="score-center">
              <div>
                <div className="turn-banner" aria-live="polite">
                  TURNO DI {turn ? name(turn.participantId) : '—'}
                </div>
                <div className={`score-paper ${!value ? 'is-empty' : ''}`}>
                  <output aria-live="polite" aria-label="Punteggio da confermare">
                    {value || '0'}
                  </output>
                  <span>
                    {locked
                      ? 'Da completare · conferma per recuperare'
                      : `${m.scoringConfiguration.dartsPerTurn} dardi · totale turno`}
                  </span>
                </div>
              </div>
              <aside className="stats">
                <div>
                  <span>MEDIA</span>
                  <strong>{active?.average.toFixed(1) ?? '—'}</strong>
                </div>
                <div>
                  <span>TURNI</span>
                  <strong>
                    {active?.turns ?? 0}/{m.scoringConfiguration.turns}
                  </strong>
                </div>
                <div>
                  <span>MIGLIOR GIRO</span>
                  <strong>{active?.bestTurn ?? '—'}</strong>
                </div>
              </aside>
            </div>
            <NumberKeypad
              value={value}
              change={change}
              submit={() => mutation.mutate('score')}
              undo={() => setConfirmUndo(true)}
              busy={mutation.isPending || !turn}
              canUndo={recent.length > 0}
              maximum={m.scoringConfiguration.maxTurnScore}
              locked={locked}
            />
          </>
        )}
        {['ready', 'scheduled', 'paused'].includes(m.status) && (
          <section className="panel">
            <h2>{statusLabel(m.status)}</h2>
            <button
              className="primary"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(m.status === 'paused' ? 'resume' : 'start')}
            >
              {m.status === 'paused' ? 'Riprendi partita' : 'Inizia incontro'}
            </button>
          </section>
        )}
        {m.status === 'completed' && (
          <section className="winner panel">
            <Crown />
            <h2>Incontro terminato</h2>
            <button
              disabled={mutation.isPending || !recent.length}
              onClick={() => setConfirmUndo(true)}
            >
              Annulla ultimo turno
            </button>
            {m.winnerEntryId ? (
              <p className="winner-name">{name(m.winnerEntryId)}</p>
            ) : (
              <p>Consulta la classifica per qualificazioni e parità.</p>
            )}
            <Link className="primary button" to={back}>
              VAI ALLA CLASSIFICA
            </Link>
            <Link className="button" to="/partite/nuova">
              Nuova partita
            </Link>
          </section>
        )}
        <ErrorMessage error={query.error ?? mutation.error} />
        <p className="live-feedback" role="status">
          {mutation.isPending ? 'Registrazione…' : feedback}
        </p>
        <section className="recent">
          <h3>ULTIMI TURNI</h3>
          <div>
            {Array.from({ length: 5 }, (_, index) => {
              const s = recent[index];
              return (
                <article key={index}>
                  {s ? (
                    <>
                      <small>{name(s.tournamentEntryId)}</small>
                      <strong>{s.score}</strong>
                    </>
                  ) : (
                    '—'
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </main>
      {history && (
        <Modal title="Cronologia partita" close={() => setHistory(false)}>
          {m.scores
            .filter((s) => !s.voided)
            .slice()
            .reverse()
            .map((s) => (
              <p key={s.id}>
                {name(s.tournamentEntryId)} · {s.score} punti
              </p>
            ))}
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
          <button
            className="primary"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate('undo')}
          >
            Conferma annullamento
          </button>
        </Modal>
      )}
    </div>
  );
}
