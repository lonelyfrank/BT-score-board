import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Trophy, ChevronRight, ChartNoAxesColumnIncreasing, Lock } from 'lucide-react';
import { CrownIcon, DartIcon, TrophyEmblem } from '../components/BrandIcons';
import { StageTimeline, tournamentSteps } from '../components/StageTimeline';
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
      <Header
        title={highscore ? 'Hi-Score Nights' : 'Tornei'}
        decor={highscore ? undefined : <Trophy strokeWidth={1.8} />}
      />
      <main className="content with-graffiti">
        <Link className="primary button cta" to="/tornei/nuovo">
          <Trophy className="cta-icon" fill="currentColor" /> NUOVO TORNEO
        </Link>
        <ErrorMessage error={query.error} retry={() => void query.refetch()} />
        {query.isPending && <Loading />}
        <div className="tournament-list">
          {query.data?.items
            .filter((t) => !highscore || t.mode === 'QUICK_HIGH_SCORE')
            .map((t) => (
              <Link
                className="event-card"
                key={t.id}
                to={`${t.mode === 'QUICK_HIGH_SCORE' ? '/hiscore' : '/tornei'}/${t.id}`}
              >
                <TrophyEmblem />
                <div>
                  <h2>{t.name}</h2>
                  <p>
                    {new Date(t.createdAt).toLocaleDateString('it-IT', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}{' '}
                    · {t.mode === 'GROUPS' ? 'A gironi' : 'Hi-Score'}
                  </p>
                </div>
                <span className={`status-tag status-${t.status}`}>{statusLabel(t.status)}</span>
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
const entryName = (t: Tournament, id: string) =>
  t.entries.find((e) => e.id === id)?.displayNameAtRegistration ?? '?';
function RankBadge({ placement }: { placement: number }) {
  return <span className={`rank-badge rank-${placement}`}>{placement}</span>;
}
function Ranking({
  table,
  t,
  highlight = 0,
  title = true,
}: {
  table: Standings[number];
  t: Tournament;
  highlight?: number;
  title?: boolean;
}) {
  return (
    <section className="ranking">
      {title && <h2>{table.groupName ?? statusLabel(table.stageKind)}</h2>}
      <ol aria-label={`Classifica ${table.groupName ?? statusLabel(table.stageKind)}`}>
        {table.rows.map((row) => (
          <li
            className={`ranking-row ${row.placement <= highlight ? 'top' : ''} ${row.placement === 1 ? 'first' : ''}`}
            key={row.tournamentEntryId}
          >
            <RankBadge placement={row.placement} />
            <Avatar name={entryName(t, row.tournamentEntryId)} />
            <span className="ranking-name">
              {entryName(t, row.tournamentEntryId)}
              {row.placement === 1 && !row.tied && (
                <CrownIcon role="img" aria-label="Primo classificato" aria-hidden={undefined} />
              )}
              {row.tied && <small> · pari merito</small>}
            </span>
            <strong>{table.stageKind === 'group' ? row.points : row.total}</strong>
          </li>
        ))}
      </ol>
      {!table.rows.length && <p className="hint">In attesa dei primi risultati.</p>}
    </section>
  );
}
function Podium({ t }: { t: Tournament }) {
  const placed = [...t.results].sort((a, b) => a.finalPlacement - b.finalPlacement);
  const order = [placed[1], placed[0], placed[2]];
  return (
    <section className="podium" aria-labelledby="podium-title">
      <h2 id="podium-title">Podio finale</h2>
      <ol>
        {order.map(
          (r) =>
            r && (
              <li key={r.tournamentEntryId} className={`place-${r.finalPlacement}`}>
                {r.finalPlacement === 1 && <CrownIcon className="podium-crown" />}
                <Avatar name={entryName(t, r.tournamentEntryId)} />
                <span>{entryName(t, r.tournamentEntryId)}</span>
                <small>{r.points} punti</small>
                <span className="podium-step" aria-label={`${r.finalPlacement}° posto`}>
                  {r.finalPlacement}
                </span>
              </li>
            ),
        )}
      </ol>
      {placed.length > 3 && (
        <ul className="podium-rest">
          {placed.slice(3).map((r) => (
            <li key={r.tournamentEntryId}>
              {r.finalPlacement}° · {entryName(t, r.tournamentEntryId)} · {r.points} punti
            </li>
          ))}
        </ul>
      )}
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
          <article className="match-card" key={m.id}>
            <div className="section-title">
              <h3>
                {statusLabel(m.matchType)} {m.sequence}
              </h3>
              <span className={`status-tag status-${m.status}`}>{statusLabel(m.status)}</span>
            </div>
            <ul>
              {m.participants.map((p) => (
                <li
                  className={`match-player ${m.winnerEntryId === p.tournamentEntryId ? 'win' : ''}`}
                  key={p.tournamentEntryId}
                >
                  <Avatar name={entryName(t, p.tournamentEntryId)} />
                  <span>{entryName(t, p.tournamentEntryId)}</span>
                  <strong>{p.finalScore ?? '—'}</strong>
                </li>
              ))}
            </ul>
            <Link
              className={`button ${m.status === 'completed' ? '' : 'outline'}`}
              to={`/partite/${m.id}`}
            >
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
  const qualStage = stages.find((s) => s.kind === 'qualification' || s.kind === 'group');
  const finalists = tables
    .find((r) => r.stageKind === 'qualification')
    ?.rows.slice(0, t.tournamentConfiguration.qualifiers);
  return (
    <>
      <Header
        title={highscore ? 'Hi-Score Nights' : 'Torneo'}
        back={highscore ? '/hiscore' : '/tornei'}
        decor={highscore ? undefined : <Trophy strokeWidth={1.8} fill="currentColor" />}
      />
      <main className="content tournament-page with-graffiti">
        <Tabs
          tabs={
            highscore
              ? [
                  { id: 'qualification', label: 'Qualifica' },
                  { id: 'final', label: `Finale Top ${t.tournamentConfiguration.qualifiers}` },
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
        {!highscore && (
          <div className="event-heading">
            <TrophyEmblem />
            <div>
              <h2>{t.name}</h2>
              <p>
                {new Date(t.createdAt).toLocaleDateString('it-IT', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}{' '}
                · {t.entries.length} giocatori
              </p>
            </div>
            <span className={`status-tag status-${t.status}`}>{statusLabel(t.status)}</span>
          </div>
        )}
        <ErrorMessage
          error={query.error ?? ranking.error ?? mutation.error}
          retry={() => {
            void query.refetch();
            void ranking.refetch();
          }}
        />
        {tab === 'overview' && (
          <>
            <div className="choice-group static" aria-label="Formato torneo">
              <span className={t.mode === 'GROUPS' ? 'on' : ''}>A gironi</span>
              <span className={t.mode === 'GROUPS' ? '' : 'on'}>
                <ChartNoAxesColumnIncreasing size={18} strokeWidth={3} aria-hidden="true" />
                Hi-Score
              </span>
            </div>
            <section className="settings-card">
              <h2>Impostazioni</h2>
              <div className="options">
                <div className="settings-row">
                  <span>Formato</span>
                  <strong>{t.mode === 'GROUPS' ? 'A gironi' : 'Hi-Score'}</strong>
                </div>
                <div className="settings-row">
                  <span>Turni per giocatore</span>
                  <strong>{t.scoringConfiguration.turns}</strong>
                </div>
                {t.mode === 'GROUPS' ? (
                  <>
                    <div className="settings-row">
                      <span>Numero gironi</span>
                      <strong>{t.tournamentConfiguration.groupCount}</strong>
                    </div>
                    <div className="settings-row">
                      <span>Qualificati per girone</span>
                      <strong>{t.tournamentConfiguration.qualifiersPerGroup}</strong>
                    </div>
                  </>
                ) : (
                  <div className="settings-row">
                    <span>Migliori alla finale</span>
                    <strong>{t.tournamentConfiguration.qualifiers}</strong>
                  </div>
                )}
              </div>
            </section>
            {isDraft && (
              <section className="form-section">
                <PlayerPicker selected={players} change={setPlayers} />
                <button
                  disabled={!players.length || mutation.isPending}
                  onClick={() => command('register')}
                >
                  Iscrivi giocatori
                </button>
                <p className="hint">
                  Iscritti:{' '}
                  {t.entries.map((p) => p.displayNameAtRegistration).join(', ') || 'nessuno'}
                </p>
              </section>
            )}
            {controls}
            <StageTimeline steps={tournamentSteps(t)} />
            {matchCards(stageMatches)}
          </>
        )}
        {tab === 'qualification' && (
          <>
            <section className="phase-card">
              <DartIcon className="phase-icon" />
              <div>
                <h2>Qualifica</h2>
                <p>
                  {t.scoringConfiguration.turns}{' '}
                  {t.scoringConfiguration.turns === 1 ? 'turno' : 'turni'} ·{' '}
                  {statusLabel(qualStage?.status ?? (isDraft ? 'ready' : t.status))}
                </p>
              </div>
              {qualStage?.status === 'finalized' ? (
                <span className="badge solid">Terminata</span>
              ) : (
                <span className={`status-tag status-${t.status}`}>{statusLabel(t.status)}</span>
              )}
            </section>
            <p className="event-line">
              {t.name} · {t.entries.length} giocatori
            </p>
            {tables
              .filter((r) => r.stageKind === 'qualification')
              .map((r) => (
                <Ranking
                  table={r}
                  t={t}
                  key={r.targetId}
                  highlight={t.tournamentConfiguration.qualifiers}
                  title={false}
                />
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
            <section className="finals-card">
              <div className="finals-head">
                <DartIcon className="phase-icon" />
                <div>
                  <h2>Finale · Top {t.tournamentConfiguration.qualifiers}</h2>
                  <p>Prossima fase · finale unica, punteggio azzerato</p>
                </div>
              </div>
              {finalists && finalists.length > 0 && (
                <ul className="finalists">
                  {finalists.map((row) => (
                    <li key={row.tournamentEntryId}>
                      <RankBadge placement={row.placement} />
                      <Avatar name={entryName(t, row.tournamentEntryId)} />
                      <span>{entryName(t, row.tournamentEntryId)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <button
              className="primary cta"
              disabled={!stages.some((s) => s.kind === 'final')}
              onClick={() => setTab('final')}
            >
              VAI ALLA FINALE <ChevronRight strokeWidth={2.6} />
            </button>
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
                <section key={g.id} className="group-block">
                  <h2>{g.name}</h2>
                  {tables
                    .filter((r) => r.targetId === g.id)
                    .map((r) => (
                      <Ranking
                        table={r}
                        t={t}
                        key={r.targetId}
                        highlight={t.tournamentConfiguration.qualifiersPerGroup}
                        title={false}
                      />
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
                    ? 'Il formato Hi-Score usa un unico girone di qualifica.'
                    : 'I gironi vengono generati all’avvio del torneo.'}
                </p>
              </Empty>
            )}
            {controls}
            {matchCards(stageMatches.filter((m) => m.matchType === 'tiebreak'))}
          </>
        )}
        {tab === 'final' && (
          <>
            {t.results.length > 0 && <Podium t={t} />}
            {!stages.some(
              (s) =>
                s.kind === 'final' || s.kind === 'semifinal' || s.kind.startsWith('elimination_'),
            ) ? (
              <div className="empty locked">
                <Lock aria-hidden="true" />
                <h2>Fase finale bloccata</h2>
                <p>Il tabellone si sblocca quando la qualifica è confermata.</p>
              </div>
            ) : (
              matchCards(
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
              )
            )}
            {controls}
          </>
        )}
        {tab === 'ranking' && (
          <>
            {tables.map((table) => (
              <div className="table-scroll" key={table.targetId}>
                <table>
                  <caption>
                    {table.groupName ?? statusLabel(table.stageKind)} ·{' '}
                    {t.scoringConfiguration.turns} turni · ordinata dal backend
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Giocatore</th>
                      <th scope="col" className="num">
                        {table.stageKind === 'group' ? 'Punti' : 'Totale'}
                      </th>
                      <th scope="col" className="num">
                        Media/turno
                      </th>
                      <th scope="col" className="num">
                        Best
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((r) => (
                      <tr key={r.tournamentEntryId} className={`rank-${r.placement}`}>
                        <td className="pos">{r.placement}</td>
                        <td>
                          {entryName(t, r.tournamentEntryId)}
                          {r.tied && <small> · pari</small>}
                        </td>
                        <td className="num strong">
                          {table.stageKind === 'group' ? r.points : r.total}
                        </td>
                        <td className="num muted">{r.average.toFixed(1)}</td>
                        <td className="num muted">{r.bestTurn}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {!tables.length && (
              <Empty title="Classifica vuota">
                <p>La classifica compare dopo i primi incontri.</p>
              </Empty>
            )}
            {controls}
          </>
        )}
        <div className="graffiti" aria-hidden="true">
          Good
          <br />
          darts
          <br />
          good
          <br />
          friends
        </div>
        {tie && (
          <Modal title="Spareggio" close={() => setTie(false)}>
            <p>
              Seleziona la classifica e l’intero gruppo a pari merito. Il risultato sarà deciso sul
              bersaglio.
            </p>
            <label className="field">
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
