import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Trophy, ChevronRight, Crown } from 'lucide-react';
import { api, type Player, type Tournament, type Standings } from '../services/api';
import {
  Avatar,
  Empty,
  ErrorMessage,
  Header,
  Loading,
  Modal,
  Tabs,
  useTab,
  statusLabel,
} from '../components/ui';
import { PlayerPicker } from './Players';

export function TournamentList({ highscore = false }: { highscore?: boolean }) {
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ['tournaments', offset],
    queryFn: () => api.tournaments(offset),
  });
  return (
    <>
      <Header title={highscore ? 'Hi-Score Nights' : 'Tornei'} />
      <main className="content">
        <Link className="primary button" to="/tornei/nuovo">
          <Trophy /> NUOVO TORNEO
        </Link>
        <ErrorMessage error={query.error} retry={() => void query.refetch()} />
        {query.isPending && <Loading />}
        <div className="tournament-list">
          {query.data?.items
            .filter((t) => !highscore || t.mode === 'QUICK_HIGH_SCORE')
            .map((t) => (
              <Link
                className="panel event-heading"
                key={t.id}
                to={`${t.mode === 'QUICK_HIGH_SCORE' ? '/hiscore' : '/tornei'}/${t.id}`}
              >
                <Trophy />
                <div>
                  <h2>{t.name}</h2>
                  <p>
                    {statusLabel(t.status)} · {t.mode === 'GROUPS' ? 'A gironi' : 'Hi-Score'}
                  </p>
                  <small>{new Date(t.createdAt).toLocaleDateString('it-IT')}</small>
                </div>
                <ChevronRight />
              </Link>
            ))}
        </div>
        {query.data &&
          !query.data.items.some((t) => !highscore || t.mode === 'QUICK_HIGH_SCORE') && (
            <Empty title="Il bersaglio vi aspetta">
              <p>
                Nessun torneo {highscore ? 'Hi-Score ' : ''}in questa pagina. Crea il prossimo
                evento del locale.
              </p>
            </Empty>
          )}
        {query.data && query.data.total > 100 && (
          <div className="pagination">
            <button disabled={!offset} onClick={() => setOffset(offset - 100)}>
              Precedenti
            </button>
            <button
              disabled={offset + 100 >= query.data.total}
              onClick={() => setOffset(offset + 100)}
            >
              Successivi
            </button>
          </div>
        )}
      </main>
    </>
  );
}
function Ranking({ table, t }: { table: Standings[number]; t: Tournament }) {
  return (
    <section className="ranking panel">
      <h2>{table.groupName ?? statusLabel(table.stageKind)}</h2>
      {table.rows.map((row) => (
        <div className={`ranking-row rank-${row.placement}`} key={row.tournamentEntryId}>
          <span className="rank-badge">{row.placement}</span>
          <Avatar
            name={
              t.entries.find((e) => e.id === row.tournamentEntryId)?.displayNameAtRegistration ??
              '?'
            }
          />
          <span>
            {t.entries.find((e) => e.id === row.tournamentEntryId)?.displayNameAtRegistration}
            {row.tied && <small> · pari merito</small>}
          </span>
          {row.placement === 1 && !row.tied && <Crown size={16} aria-label="Primo posto" />}
          <strong>{table.stageKind === 'group' ? row.points : row.total}</strong>
        </div>
      ))}
      {!table.rows.length && <p>In attesa dei primi risultati.</p>}
    </section>
  );
}
export function TournamentDetail({ highscore = false }: { highscore?: boolean }) {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const [tab, setTab] = useTab(highscore ? 'qualification' : 'overview');
  const [tie, setTie] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const query = useQuery({
    queryKey: ['tournament', id],
    queryFn: () => api.tournament(id),
    refetchInterval: 5000,
  });
  const ranking = useQuery({
    queryKey: ['standings', id],
    queryFn: () => api.standings(id),
    enabled: !!query.data,
    refetchInterval: 5000,
  });
  const mutation = useMutation({
    mutationFn: async ({ action, extra }: { action: string; extra?: Record<string, unknown> }) => {
      let t = await api.tournament(id);
      if (action === 'register') {
        for (const player of players) {
          if (!t.entries.some((e) => e.playerId === player.id))
            t = await api.tournamentCommand(t, 'players', {
              playerId: player.id,
              seed: t.entries.length + 1,
            });
        }
        return t;
      }
      return api.tournamentCommand(t, action, extra);
    },
    onSuccess: (t) => {
      client.setQueryData(['tournament', id], t);
      void client.invalidateQueries({ queryKey: ['standings', id] });
      setTie(false);
      setPlayers([]);
    },
    onError: () => {
      void query.refetch();
      void ranking.refetch();
    },
  });
  if (query.isPending) return <Loading />;
  const t = query.data;
  if (!t)
    return (
      <>
        <Header title="Torneo" />
        <ErrorMessage error={query.error} retry={() => void query.refetch()} />
      </>
    );
  const stages = t.stages.filter((s) => s.status !== 'invalidated');
  const stage = stages.at(-1);
  const stageMatches = t.matches.filter((m) => m.stageId === stage?.id && m.status !== 'cancelled');
  const done = stageMatches.length > 0 && stageMatches.every((m) => m.status === 'completed');
  const qualification = stage?.kind === 'qualification' || stage?.kind === 'group';
  const final = stage?.kind === 'final';
  const tables = ranking.data?.filter((r) => r.stageStatus !== 'invalidated') ?? [];
  const isDraft = ['draft', 'registration', 'ready'].includes(t.status);
  const command = (action: string, extra?: Record<string, unknown>) =>
    mutation.mutate({ action, extra });
  const matchCards = (matches: Tournament['matches']) =>
    matches.length ? (
      <div className="match-grid">
        {matches.map((m) => (
          <article className="panel match-card" key={m.id}>
            <div className="section-title">
              <h3>
                {statusLabel(m.matchType)} {m.sequence}
              </h3>
              <span className="badge">{statusLabel(m.status)}</span>
            </div>
            {m.participants.map((p) => (
              <div className="match-player" key={p.tournamentEntryId}>
                <Avatar
                  name={
                    t.entries.find((e) => e.id === p.tournamentEntryId)
                      ?.displayNameAtRegistration ?? '?'
                  }
                />
                <span>
                  {t.entries.find((e) => e.id === p.tournamentEntryId)?.displayNameAtRegistration}
                </span>
                <strong>{p.finalScore ?? '—'}</strong>
              </div>
            ))}
            <Link className="button" to={`/partite/${m.id}`}>
              {m.status === 'completed'
                ? 'Vedi risultato'
                : m.status === 'active'
                  ? 'Riprendi incontro'
                  : 'Gioca l’incontro'}
              <ChevronRight size={18} />
            </Link>
          </article>
        ))}
      </div>
    ) : (
      <Empty title="Fase non ancora disponibile">
        <p>Completa e conferma la qualificazione per proseguire.</p>
      </Empty>
    );
  const controls = (
    <div className="stage-actions">
      {isDraft ? (
        <button className="primary" disabled={mutation.isPending} onClick={() => command('start')}>
          AVVIA TORNEO
        </button>
      ) : t.status === 'paused' ? (
        <button className="primary" disabled={mutation.isPending} onClick={() => command('resume')}>
          RIPRENDI TORNEO
        </button>
      ) : (
        t.status === 'active' && (
          <>
            {qualification && stage?.status === 'open' && (
              <button
                className="primary"
                disabled={!done || mutation.isPending}
                onClick={() => command('qualification/finalize')}
              >
                CONFERMA QUALIFICA
              </button>
            )}
            {qualification && stage?.status === 'finalized' && (
              <button
                className="primary"
                disabled={mutation.isPending}
                onClick={() => command('finals/generate')}
              >
                GENERA FINALE
              </button>
            )}
            {!qualification &&
              !final &&
              (stage?.kind === 'semifinal' || stage?.kind.startsWith('elimination_')) && (
                <button
                  className="primary"
                  disabled={!done || mutation.isPending}
                  onClick={() => command('elimination/advance')}
                >
                  PROSSIMO TURNO
                </button>
              )}
            {final && (
              <button
                className="primary"
                disabled={!done || mutation.isPending}
                onClick={() => command('complete')}
              >
                CONFERMA RISULTATO FINALE
              </button>
            )}
            {done &&
              tables.some((r) => r.stageId === stage?.id && r.rows.some((row) => row.tied)) && (
                <button
                  disabled={mutation.isPending}
                  onClick={() => {
                    setTargetId(
                      tables.find((r) => r.stageId === stage?.id && r.rows.some((row) => row.tied))
                        ?.targetId ?? '',
                    );
                    setEntryIds([]);
                    setTie(true);
                  }}
                >
                  Organizza spareggio
                </button>
              )}
          </>
        )
      )}
    </div>
  );
  return (
    <>
      <Header
        title={highscore ? 'Hi-Score Nights' : 'Torneo'}
        back={highscore ? '/hiscore' : '/tornei'}
      />
      <main className="content tournament-page">
        <Tabs
          tabs={
            highscore
              ? [
                  { id: 'qualification', label: 'Qualifica' },
                  { id: 'final', label: 'Finale' },
                  { id: 'ranking', label: 'Classifica' },
                ]
              : [
                  { id: 'overview', label: 'Panoramica' },
                  { id: 'groups', label: 'Gironi' },
                  { id: 'final', label: 'Finale' },
                  { id: 'ranking', label: 'Classifica' },
                ]
          }
          value={tab}
          change={setTab}
        />
        <div className="event-heading">
          <Trophy />
          <div>
            <h2>{t.name}</h2>
            <p>
              {t.entries.length} giocatori · {statusLabel(t.status)}
            </p>
          </div>
        </div>
        <ErrorMessage
          error={query.error ?? ranking.error ?? mutation.error}
          retry={() => {
            void query.refetch();
            void ranking.refetch();
          }}
        />
        {tab === 'overview' && (
          <>
            <section className="panel">
              <h2>Impostazioni</h2>
              <div className="settings-row">
                <span>Formato</span>
                <strong>{t.mode === 'GROUPS' ? 'A gironi' : 'Hi-Score'}</strong>
              </div>
              <div className="settings-row">
                <span>Turni per giocatore</span>
                <strong>{t.scoringConfiguration.turns}</strong>
              </div>
              <div className="settings-row">
                <span>
                  {t.mode === 'GROUPS' ? 'Gironi / qualificati per girone' : 'Migliori alla finale'}
                </span>
                <strong>
                  {t.mode === 'GROUPS'
                    ? `${t.tournamentConfiguration.groupCount} / ${t.tournamentConfiguration.qualifiersPerGroup}`
                    : t.tournamentConfiguration.qualifiers}
                </strong>
              </div>
            </section>
            {isDraft && (
              <section className="panel">
                <PlayerPicker selected={players} change={setPlayers} />
                <button
                  disabled={!players.length || mutation.isPending}
                  onClick={() => command('register')}
                >
                  Iscrivi giocatori
                </button>
                <p>
                  Iscritti:{' '}
                  {t.entries.map((p) => p.displayNameAtRegistration).join(', ') || 'nessuno'}
                </p>
              </section>
            )}
            {controls}
            <h2>Stato torneo</h2>
            <ol className="stage-list">
              {stages.length ? (
                stages.map((s) => (
                  <li key={s.id}>
                    <strong>{statusLabel(s.kind)}</strong>
                    <span>{statusLabel(s.status)}</span>
                  </li>
                ))
              ) : (
                <li>Qualifica · Non iniziata</li>
              )}
            </ol>
            {matchCards(stageMatches)}
          </>
        )}
        {tab === 'qualification' && (
          <>
            <section className="panel qualification-status">
              <h2>Qualifica</h2>
              <p>
                {t.scoringConfiguration.turns} turni ·{' '}
                {statusLabel(stages.find((s) => s.kind === 'qualification')?.status ?? 'ready')}
              </p>
            </section>
            {tables
              .filter((r) => r.stageKind === 'qualification')
              .map((r) => (
                <Ranking table={r} t={t} key={r.targetId} />
              ))}
            {matchCards(
              t.matches.filter(
                (m) =>
                  ['qualification', 'tiebreak'].includes(m.matchType) &&
                  stages.some((s) => s.id === m.stageId && s.kind === 'qualification') &&
                  m.status !== 'cancelled',
              ),
            )}
            {controls}
            <section className="panel">
              <h2>Finale · Top {t.tournamentConfiguration.qualifiers}</h2>
              <p>I qualificati giocano una finale unica, con punteggio azzerato.</p>
              <button
                className="primary"
                disabled={!stages.some((s) => s.kind === 'final')}
                onClick={() => setTab('final')}
              >
                VAI ALLA FINALE <ChevronRight />
              </button>
            </section>
            {isDraft && (
              <Link className="button" to={`/tornei/${id}`}>
                Completa iscrizioni e avvia
              </Link>
            )}
          </>
        )}
        {tab === 'groups' && (
          <>
            {t.groups
              .filter((g) => g.status !== 'invalidated')
              .map((g) => (
                <section key={g.id}>
                  <h2>{g.name}</h2>
                  {tables
                    .filter((r) => r.targetId === g.id)
                    .map((r) => (
                      <Ranking table={r} t={t} key={r.targetId} />
                    ))}
                  {matchCards(
                    t.matches.filter((m) => m.groupId === g.id && m.status !== 'cancelled'),
                  )}
                </section>
              ))}
            {!t.groups.length && (
              <Empty title="Nessun girone">
                <p>
                  {t.mode === 'QUICK_HIGH_SCORE'
                    ? 'Questo torneo usa una qualifica Hi-Score.'
                    : 'Avvia il torneo per generare i gironi.'}
                </p>
              </Empty>
            )}
            {controls}
            {matchCards(stageMatches.filter((m) => m.matchType === 'tiebreak'))}
          </>
        )}
        {tab === 'final' && (
          <>
            {t.results.length > 0 && (
              <section className="panel winner">
                <Crown />
                <h2>Risultato ufficiale</h2>
                {t.results.map((r) => (
                  <p key={r.tournamentEntryId}>
                    {r.finalPlacement}° ·{' '}
                    {t.entries.find((e) => e.id === r.tournamentEntryId)?.displayNameAtRegistration}{' '}
                    · {r.points} punti
                  </p>
                ))}
              </section>
            )}
            {matchCards(
              t.matches.filter(
                (m) =>
                  stages.some(
                    (s) =>
                      s.id === m.stageId &&
                      (s.kind === 'final' ||
                        s.kind === 'semifinal' ||
                        s.kind.startsWith('elimination_')),
                  ) && m.status !== 'cancelled',
              ),
            )}
            {controls}
          </>
        )}
        {tab === 'ranking' && (
          <>
            {tables.map((table) => (
              <div key={table.targetId}>
                <Ranking table={table} t={t} />
                <div className="table-scroll">
                  <table>
                    <caption>
                      {table.groupName ?? statusLabel(table.stageKind)} · statistiche
                    </caption>
                    <thead>
                      <tr>
                        <th>Giocatore</th>
                        <th>Media</th>
                        <th>Best</th>
                        <th>Turni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((r) => (
                        <tr key={r.tournamentEntryId}>
                          <td>
                            {
                              t.entries.find((e) => e.id === r.tournamentEntryId)
                                ?.displayNameAtRegistration
                            }
                          </td>
                          <td>{r.average.toFixed(1)}</td>
                          <td>{r.bestTurn}</td>
                          <td>{r.turns}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {!tables.length && (
              <Empty title="Classifica in attesa">I risultati compariranno dopo l’avvio.</Empty>
            )}
            {controls}
          </>
        )}
        <div className="graffiti" aria-hidden="true">
          Good darts.
          <br />
          Good friends.
        </div>
        {tie && (
          <Modal title="Spareggio" close={() => setTie(false)}>
            <p>
              Seleziona la classifica e l’intero gruppo a pari merito. Il risultato sarà deciso sul
              bersaglio.
            </p>
            <label>
              Classifica
              <select
                value={targetId}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  setEntryIds([]);
                }}
              >
                {tables
                  .filter((r) => r.stageId === stage?.id)
                  .map((r) => (
                    <option key={r.targetId} value={r.targetId}>
                      {r.groupName ?? `${statusLabel(r.stageKind)} ${tables.indexOf(r) + 1}`}
                    </option>
                  ))}
              </select>
            </label>
            {tables
              .find((r) => r.targetId === targetId)
              ?.rows.map((r) => (
                <label className="check-row" key={r.tournamentEntryId}>
                  <input
                    type="checkbox"
                    checked={entryIds.includes(r.tournamentEntryId)}
                    onChange={(e) =>
                      setEntryIds(
                        e.target.checked
                          ? [...entryIds, r.tournamentEntryId]
                          : entryIds.filter((x) => x !== r.tournamentEntryId),
                      )
                    }
                  />
                  {t.entries.find((e) => e.id === r.tournamentEntryId)?.displayNameAtRegistration} ·{' '}
                  {r.total}
                </label>
              ))}
            <ErrorMessage error={mutation.error} />
            <button
              className="primary"
              disabled={entryIds.length < 2 || mutation.isPending}
              onClick={() => command('tiebreaks', { targetId, entryIds })}
            >
              Crea incontro di spareggio
            </button>
          </Modal>
        )}
      </main>
    </>
  );
}
