import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, ArrowUpDown } from 'lucide-react';
import { CrownIcon, TrophyEmblem } from '../components/BrandIcons';
import {
  StageTimeline,
  groupSteps,
  knockoutTitle,
  plannedPairs,
} from '../components/StageTimeline';
import {
  Empty,
  ErrorMessage,
  Header,
  Loading,
  Modal,
  PauseButton,
  StatusChip,
  Tabs,
  statusLabel,
  tournamentTone,
  useTab,
} from '../components/ui';
import { api, type Tournament } from '../services/api';
import { gameOf, isResultRecording } from '../services/rules';
import {
  BackupLink,
  BoardCard,
  DecisionSheet,
  DraftPanel,
  Podium,
  ResultsTable,
  TieAlert,
  TieSheet,
  blockingTies,
  entryName,
  groupLabel,
  isDraft,
  liveStages,
  names,
  playable,
  useTournament,
  type Row,
  type Table,
  type TMatch,
} from './Tournaments';

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

function MatchRow({ t, m, reorder }: { t: Tournament; m: TMatch; reorder?: (() => void) | null }) {
  const [a, b] = m.participants;
  const live = m.status === 'active' || m.status === 'paused';
  const done = m.status === 'completed';
  const tag = live
    ? 'IN CORSO'
    : done
      ? m.winnerEntryId
        ? 'CONCLUSA'
        : 'PARI'
      : m.status === 'cancelled'
        ? 'ANNULLATA'
        : 'DA GIOCARE';
  const side = (p?: TMatch['participants'][number]) =>
    !p
      ? 'bye'
      : `${done && m.winnerEntryId === p.tournamentEntryId ? 'win' : ''} ${done && m.winnerEntryId && m.winnerEntryId !== p.tournamentEntryId ? 'lose' : ''}`;
  const results = isResultRecording(t);
  const score = (p?: TMatch['participants'][number]) =>
    p
      ? (p.finalScore ??
        (results
          ? null
          : m.scores
              .filter((s) => !s.voided && s.tournamentEntryId === p.tournamentEntryId)
              .reduce((n, s) => n + s.score, 0)))
      : 0;
  // Winner-only games may have no scores: the winner's side is highlighted instead.
  const middle = m.result?.walkover
    ? 'a tav.'
    : score(a) === null && score(b) === null
      ? done
        ? m.winnerEntryId === a?.tournamentEntryId
          ? '1–0'
          : m.winnerEntryId
            ? '0–1'
            : '='
        : 'vs'
      : `${score(a) ?? '—'}–${score(b) ?? '—'}`;
  const content = (
    <>
      <span className="seq">#{m.sequence}</span>
      <span className={side(a)}>{a ? entryName(t, a.tournamentEntryId) : '—'}</span>
      <span className="score">{done || live ? middle : 'vs'}</span>
      <span className={`right ${side(b)}`}>{b ? entryName(t, b.tournamentEntryId) : 'bye'}</span>
      <span className={`tag ${live ? 'live' : done && !m.winnerEntryId ? 'tie' : ''}`}>{tag}</span>
    </>
  );
  if (reorder !== undefined)
    return (
      <div className="match-row">
        {content}
        {reorder && (
          <button
            className="mini"
            aria-label={`Anticipa incontro #${m.sequence}`}
            onClick={reorder}
          >
            <ArrowUp size={16} />
          </button>
        )}
      </div>
    );
  return (
    <Link className={`match-row ${live ? 'live' : ''}`} to={`/partite/${m.id}`}>
      {content}
    </Link>
  );
}

function GroupTable({
  t,
  table,
  cut,
  qualified,
}: {
  t: Tournament;
  table: Table;
  cut: number;
  qualified: string[];
}) {
  const c = t.tournamentConfiguration;
  // Score difference only where scores are comparable points (Hi-Score).
  const byScore =
    (c.groupRanking ?? (t.gameMode === 'HI_SCORE' ? 'POINTS_SCORE' : 'POINTS_WINS')) ===
    'POINTS_SCORE';
  const columns = byScore ? ['G', 'V', 'N', 'P', 'Diff', 'Pti'] : ['G', 'V', 'N', 'P', 'Pti'];
  return (
    <div className="panel table-panel">
      <div className="table-scroll">
        <table>
          <caption>Classifica {groupLabel(table.groupName)}</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Giocatore</th>
              {columns.map((h) => (
                <th scope="col" className="num" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.tournamentEntryId} className={r.placement <= cut ? 'in' : ''}>
                <td className="pos">{r.placement}</td>
                <td>
                  {entryName(t, r.tournamentEntryId)}
                  {r.tied && r.played > 0 && <small className="tie-tag">PARI</small>}
                  {r.withdrawn && <small className="tie-tag">RITIRATO</small>}
                  {qualified.includes(r.tournamentEntryId) && <small className="q-tag">Q</small>}
                </td>
                <td className="num muted">{r.played}</td>
                <td className="num muted">{r.wins}</td>
                <td className="num muted">{r.draws}</td>
                <td className="num muted">{r.losses}</td>
                {byScore && <td className="num muted">{signed(r.difference)}</td>}
                <td className="num strong">{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Ordine:{' '}
        {byScore
          ? 'punti, differenza, punti segnati, scontro diretto (solo tra 2), poi spareggio o decisione.'
          : 'punti, vittorie, scontro diretto (solo tra 2), poi spareggio o decisione.'}{' '}
        V {c.winPoints} · N {c.drawPoints} · P {c.lossPoints}.
      </p>
    </div>
  );
}

export function GroupsDetail() {
  const { id = '' } = useParams();
  const { query, mutation, tables, command, error, retry } = useTournament(id);
  const [tab, setTab] = useTab('overview');
  const [group, setGroup] = useState(0);
  const [reordering, setReordering] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [tie, setTie] = useState<{ table: Table; group: Row[] } | null>(null);
  const [decision, setDecision] = useState<{ table: Table; group: Row[] } | null>(null);
  const [leaving, setLeaving] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const t = query.data;
  const event = useQuery({
    queryKey: ['events'],
    queryFn: () => api.events(),
    enabled: !!t?.eventId,
  });
  if (query.isPending) return <Loading />;
  if (!t)
    return (
      <>
        <Header title="Torneo" back="/tornei" />
        <main className="content">
          <ErrorMessage error={query.error} retry={retry} />
        </main>
      </>
    );
  const c = t.tournamentConfiguration;
  const stages = liveStages(t);
  const groupStage = stages.find((s) => s.kind === 'group');
  const knockout = stages.filter((s) => !['group', 'qualification'].includes(s.kind));
  const current = stages.at(-1);
  const active = t.status === 'active';
  const paused = t.status === 'paused';
  const ended = ['completed', 'cancelled'].includes(t.status);
  const groups = t.groups.filter((g) => g.status !== 'invalidated');
  const selected = groups[Math.min(group, groups.length - 1)];
  const stageMatches = (stageId?: string) =>
    t.matches.filter((m) => m.stageId === stageId && m.status !== 'cancelled');
  const openTiebreak = t.matches.find(
    (m) => m.matchType === 'tiebreak' && m.stageId === current?.id && playable(m),
  );
  const groupMatches = stageMatches(groupStage?.id).filter((m) => m.matchType !== 'tiebreak');
  const groupsDone = groupMatches.length > 0 && groupMatches.every((m) => m.status === 'completed');
  // Ties that the group stage cannot be confirmed with: any tied place inside the cut.
  const groupTie =
    groupStage?.status === 'open' && groupsDone && !openTiebreak
      ? tables
          .filter((r) => r.stageKind === 'group')
          .map((table) => ({
            table,
            group: blockingTies(table.rows, c.qualifiersPerGroup, true)[0],
          }))
          .find((x) => x.group)
      : undefined;
  // A knockout match tied on points has no winner until its playoff.
  const knockoutTie =
    current && current.kind !== 'group' && !openTiebreak
      ? stageMatches(current.id)
          .filter((m) => m.matchType !== 'tiebreak' && m.status === 'completed' && !m.winnerEntryId)
          .map((m) => {
            const table = tables.find((r) => r.targetId === m.id);
            return { table, group: table ? blockingTies(table.rows, 1)[0] : undefined };
          })
          .find((x) => x.table && x.group)
      : undefined;
  const tieToShow = groupTie ?? knockoutTie;
  const onBoard =
    t.matches.find((m) => m.status === 'active' || m.status === 'paused') ??
    t.matches
      .filter((m) => m.status === 'ready' && m.stageId === current?.id)
      .sort((a, b) => a.sequence - b.sequence)[0];
  const finalStage = knockout.find((s) => s.kind === 'final');
  const finalMatch = stageMatches(finalStage?.id).find((m) => m.matchType === 'final');
  const canFinalize = active && groupsDone && !groupTie && !openTiebreak;
  const knockoutOpen =
    current && current.kind !== 'group' && current.kind !== 'final' && current.status === 'open';
  const knockoutDone =
    knockoutOpen &&
    stageMatches(current.id).every(
      (m) => m.status === 'completed' && (m.winnerEntryId || m.matchType === 'tiebreak'),
    );
  const note = paused
    ? 'Torneo in pausa: nessun punteggio può essere registrato.'
    : t.status === 'completed'
      ? 'Torneo concluso: risultati ufficiali confermati.'
      : t.status === 'cancelled'
        ? 'Torneo annullato.'
        : tieToShow
          ? 'Parità da decidere con uno spareggio.'
          : groupStage?.status === 'open'
            ? groupsDone
              ? 'Tutti gli incontri dei gironi sono conclusi.'
              : `${groupMatches.filter(playable).length} ${groupMatches.filter(playable).length === 1 ? 'incontro' : 'incontri'} da completare prima della conferma.`
            : !knockout.length
              ? `Qualificati: ${names(
                  t,
                  (groupStage?.qualifiedEntryIds ?? []).map((tournamentEntryId) => ({
                    tournamentEntryId,
                  })),
                )}.`
              : finalMatch?.status === 'completed'
                ? 'Finale giocata: conferma il risultato.'
                : `${knockoutTitle(current!.kind)} in corso.`;
  const eventName = event.data?.items.find((e) => e.id === t.eventId)?.name;
  const ready = t.matches
    .filter(
      (m) => m.status === 'ready' && stages.some((s) => s.id === m.stageId && s.status === 'open'),
    )
    .sort((a, b) => a.sequence - b.sequence);
  const moveUp = (m: TMatch) => {
    const ids = ready.map((x) => x.id);
    const i = ids.indexOf(m.id);
    [ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!];
    command('matches/reorder', { matchIds: ids });
  };
  const selectedTable = tables.find((r) => r.targetId === selected?.id);
  const selectedMatches = t.matches
    .filter(
      (m) => m.groupId === selected?.id && m.matchType !== 'tiebreak' && m.status !== 'cancelled',
    )
    .sort((a, b) => a.sequence - b.sequence);
  const rounds = [...new Set(selectedMatches.map((m) => m.scheduleRound))].sort((a, b) => a - b);
  const seeds = groupStage?.qualifiedEntryIds ?? [];
  const seedOf = (entry: string) => seeds.indexOf(entry) + 1;
  return (
    <>
      <Header
        title="Torneo"
        back="/tornei"
        action={
          <PauseButton
            paused={paused}
            disabled={(!active && !paused) || mutation.isPending}
            toggle={() => command(paused ? 'resume' : 'pause')}
          />
        }
      />
      <main className="content tournament-page">
        <Tabs
          label="Sezioni torneo"
          tabs={[
            { id: 'overview', label: 'Panoramica', attention: !!tieToShow },
            { id: 'groups', label: 'Gironi' },
            { id: 'bracket', label: 'Tabellone' },
            { id: 'ranking', label: 'Classifica' },
          ]}
          value={tab}
          change={setTab}
        />
        <div className="event-heading">
          <TrophyEmblem />
          <div>
            <h2>{t.name}</h2>
            <p>
              {[
                gameOf(t).label,
                `${t.entries.length} giocatori`,
                `${c.groupCount} gironi`,
                eventName,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <StatusChip tone={tournamentTone(t.status)}>
            {statusLabel(t.status).toUpperCase()}
          </StatusChip>
        </div>
        <ErrorMessage error={error} retry={retry} />
        {tab === 'overview' && (
          <>
            {isDraft(t) && <DraftPanel t={t} busy={mutation.isPending} command={command} />}
            {t.status === 'completed' && (
              <>
                <Podium t={t} />
                <BackupLink />
              </>
            )}
            <StageTimeline steps={groupSteps(t)} />
            {tieToShow?.table && tieToShow.group && (
              <TieAlert
                action={{
                  label: 'ORGANIZZA SPAREGGIO',
                  disabled: !active || mutation.isPending,
                  run: () => setTie({ table: tieToShow.table!, group: tieToShow.group! }),
                }}
                secondary={{
                  label: 'DECIDE L’ORGANIZZATORE',
                  disabled: !active || mutation.isPending,
                  run: () => setDecision({ table: tieToShow.table!, group: tieToShow.group! }),
                }}
              >
                <strong>
                  Parità
                  {tieToShow.table.groupName ? ` nel ${groupLabel(tieToShow.table.groupName)}` : ''}
                  .
                </strong>{' '}
                {names(t, tieToShow.group)} sono pari al {tieToShow.group[0]!.placement}° posto:
                decide uno spareggio sul bersaglio o l’organizzatore.
              </TieAlert>
            )}
            {onBoard && !ended && (
              <BoardCard
                t={t}
                match={onBoard}
                title={
                  onBoard.groupId
                    ? `${groupLabel(groups.find((g) => g.id === onBoard.groupId)?.name)} · round ${onBoard.scheduleRound}`
                    : statusLabel(onBoard.matchType)
                }
              />
            )}
            {!isDraft(t) && !ended && (
              <div className="stage-actions">
                {groupStage?.status === 'open' && (
                  <button
                    className="primary"
                    disabled={!canFinalize || mutation.isPending}
                    onClick={() => command('qualification/finalize')}
                  >
                    CONFERMA QUALIFICA
                  </button>
                )}
                {groupStage?.status === 'finalized' && !knockout.length && (
                  <button
                    className="primary"
                    disabled={!active || mutation.isPending}
                    onClick={() => command('finals/generate')}
                  >
                    GENERA TABELLONE
                  </button>
                )}
                {knockoutDone && (
                  <button
                    className="primary"
                    disabled={!active || mutation.isPending}
                    onClick={() => command('elimination/advance')}
                  >
                    PROSSIMO TURNO
                  </button>
                )}
                {finalMatch?.status === 'completed' ? (
                  <button
                    className="primary"
                    disabled={!active || !!openTiebreak || !!knockoutTie || mutation.isPending}
                    onClick={() => command('complete')}
                  >
                    CONFERMA RISULTATO FINALE
                  </button>
                ) : (
                  knockout.length > 0 && (
                    <button className="primary" onClick={() => setTab('bracket')}>
                      VAI AL TABELLONE
                    </button>
                  )
                )}
                <p
                  role="status"
                  className={`stage-note ${canFinalize || (groupStage?.status === 'finalized' && !knockout.length) ? 'ok' : ''}`}
                >
                  {note}
                </p>
              </div>
            )}
            {!isDraft(t) && !ended && (
              <div className="pair">
                <button
                  className="warning-outline"
                  disabled={(!active && !paused) || mutation.isPending}
                  onClick={() => command(paused ? 'resume' : 'pause')}
                >
                  {paused ? 'Riprendi torneo' : 'Metti in pausa'}
                </button>
                <button className="danger-outline" onClick={() => setCancel(true)}>
                  Annulla torneo…
                </button>
              </div>
            )}
            {active && isResultRecording(t) && (
              <button
                className="small"
                onClick={() =>
                  setLeaving(
                    t.entries.find((e) => e.status === 'registered' || e.status === 'qualified')
                      ?.id ?? '',
                  )
                }
              >
                Ritira un giocatore…
              </button>
            )}
          </>
        )}
        {tab === 'groups' &&
          (groups.length ? (
            <>
              <div className="chips" role="radiogroup" aria-label="Girone">
                {groups.map((g, i) => (
                  <button
                    key={g.id}
                    role="radio"
                    className="chip"
                    aria-checked={g.id === selected?.id}
                    onClick={() => setGroup(i)}
                  >
                    {groupLabel(g.name)}
                  </button>
                ))}
              </div>
              {selectedTable && (
                <GroupTable
                  t={t}
                  table={selectedTable}
                  cut={c.qualifiersPerGroup}
                  qualified={groupStage?.status === 'finalized' ? seeds : []}
                />
              )}
              <div className="section-head">
                <h2>Calendario</h2>
                {ready.length > 1 && active && (
                  <button
                    className="small"
                    aria-pressed={reordering}
                    onClick={() => setReordering(!reordering)}
                  >
                    <ArrowUpDown size={16} aria-hidden="true" />
                    {reordering ? 'Fatto' : 'Riordina'}
                  </button>
                )}
              </div>
              {rounds.map((round) => (
                <section key={round} className="round">
                  <h3>ROUND {round}</h3>
                  {selectedMatches
                    .filter((m) => m.scheduleRound === round)
                    .map((m) => (
                      <MatchRow
                        key={m.id}
                        t={t}
                        m={m}
                        reorder={
                          reordering
                            ? ready.indexOf(m) > 0 && !mutation.isPending
                              ? () => moveUp(m)
                              : null
                            : undefined
                        }
                      />
                    ))}
                </section>
              ))}
              {t.matches
                .filter(
                  (m) =>
                    m.matchType === 'tiebreak' &&
                    m.tieTarget === selected?.id &&
                    m.status !== 'cancelled',
                )
                .map((m) => (
                  <section key={m.id} className="round">
                    <h3>SPAREGGIO</h3>
                    <MatchRow t={t} m={m} />
                  </section>
                ))}
            </>
          ) : (
            <Empty title="Gironi non ancora generati">
              <p>I gironi vengono creati all’avvio del torneo.</p>
            </Empty>
          ))}
        {tab === 'bracket' && (
          <>
            <p className="description">
              {knockout.length
                ? 'Tabellone generato dai risultati confermati.'
                : 'Anteprima: il tabellone si genera dopo la conferma della qualifica.'}
            </p>
            <div
              className="bracket"
              style={{
                gridTemplateColumns: `repeat(${Math.max(knockout.length, 2)}, minmax(150px, 1fr))`,
              }}
            >
              {knockout.length
                ? knockout.map((s) => (
                    <div className="bracket-round" key={s.id}>
                      <h3>{knockoutTitle(s.kind)}</h3>
                      {stageMatches(s.id).map((m, i) => (
                        <article
                          key={m.id}
                          className={`bracket-match ${playable(m) ? 'open' : ''} ${s.kind === 'final' ? 'final' : ''}`}
                        >
                          <span className="bracket-title">
                            {m.matchType === 'tiebreak'
                              ? 'SPAREGGIO'
                              : `${knockoutTitle(s.kind).toUpperCase()}${stageMatches(s.id).length > 1 ? ` ${i + 1}` : ''}`}
                          </span>
                          {m.participants.map((p) => (
                            <span
                              key={p.tournamentEntryId}
                              className={m.winnerEntryId === p.tournamentEntryId ? 'win' : ''}
                            >
                              <small>S{seedOf(p.tournamentEntryId)}</small>{' '}
                              {entryName(t, p.tournamentEntryId)}
                              {m.status === 'completed' && (
                                <b>
                                  {p.finalScore ??
                                    (m.winnerEntryId === p.tournamentEntryId ? 'V' : '')}
                                </b>
                              )}
                              {s.kind === 'final' &&
                                m.winnerEntryId === p.tournamentEntryId &&
                                t.status === 'completed' && <CrownIcon className="inline-crown" />}
                            </span>
                          ))}
                          {m.participants.length === 1 && <span className="muted">bye</span>}
                          {playable(m) && (
                            <Link className="outline button" to={`/partite/${m.id}`}>
                              Gioca
                            </Link>
                          )}
                        </article>
                      ))}
                    </div>
                  ))
                : [
                    <div className="bracket-round" key="first">
                      <h3>{plannedPairs(t).length === 1 ? 'Finale' : 'Primo turno'}</h3>
                      {plannedPairs(t).map((pair, i) => (
                        <article className="bracket-match planned" key={i}>
                          {pair.map((x, k) => (
                            <span key={k}>{x ?? 'bye'}</span>
                          ))}
                        </article>
                      ))}
                    </div>,
                    plannedPairs(t).length > 1 && (
                      <div className="bracket-round" key="final">
                        <h3>Finale</h3>
                        <article className="bracket-match planned final">
                          <CrownIcon className="inline-crown" />
                          <span>Vincenti del turno precedente</span>
                        </article>
                      </div>
                    ),
                  ]}
            </div>
            <p className="hint">
              Seed: tutti i primi, poi tutti i secondi. Accoppiamenti standard (1–8, 4–5, 2–7, 3–6);
              i bye vanno ai seed migliori e il turno successivo si genera da solo quando tutti
              hanno un vincitore.
            </p>
          </>
        )}
        {tab === 'ranking' && (
          <>
            {t.results.length > 0 && <ResultsTable t={t} />}
            {tables
              .filter((r) => r.stageKind === 'group' && t.gameMode === 'HI_SCORE')
              .map((table) => (
                <div className="panel table-panel" key={table.targetId}>
                  <div className="table-scroll">
                    <table>
                      <caption>{groupLabel(table.groupName)} · statistiche</caption>
                      <thead>
                        <tr>
                          <th scope="col">Giocatore</th>
                          <th scope="col" className="num">
                            Segnati
                          </th>
                          <th scope="col" className="num">
                            Media
                          </th>
                          <th scope="col" className="num">
                            {isResultRecording(t) ? 'Record' : 'Best'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map((r) => (
                          <tr key={r.tournamentEntryId}>
                            <td>{entryName(t, r.tournamentEntryId)}</td>
                            <td className="num">{r.scored}</td>
                            <td className="num muted">
                              {(isResultRecording(t) ? r.averageScore : r.average).toFixed(1)}
                            </td>
                            <td className="num muted">
                              {isResultRecording(t) ? r.bestScore : r.bestTurn}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            {!tables.length && (
              <Empty title="Classifica vuota">
                <p>La classifica compare dopo i primi incontri.</p>
              </Empty>
            )}
          </>
        )}
        {tie && (
          <TieSheet
            t={t}
            table={tie.table}
            group={tie.group}
            title={`Spareggio · ${tie.table.groupName ? groupLabel(tie.table.groupName) : knockoutTitle(tie.table.stageKind)}`}
            busy={mutation.isPending}
            error={mutation.error}
            close={() => setTie(null)}
            create={(entryIds) => {
              command('tiebreaks', { targetId: tie.table.targetId, entryIds });
              setTie(null);
            }}
          />
        )}
        {decision && (
          <DecisionSheet
            t={t}
            targetId={decision.table.targetId}
            entries={decision.group.map((r) => r.tournamentEntryId)}
            title="Decisione dell’organizzatore"
            close={() => setDecision(null)}
            done={() => {
              setDecision(null);
              retry();
            }}
          />
        )}
        {leaving && (
          <Modal title="Ritirare un giocatore?" close={() => setLeaving('')}>
            <p>
              Gli incontri che non ha ancora giocato vanno all’avversario a tavolino; quelli giocati
              restano validi. Un giocatore ritirato non si qualifica.
            </p>
            <label className="field">
              Giocatore
              <span className="select">
                <select value={leaving} onChange={(e) => setLeaving(e.target.value)}>
                  {t.entries
                    .filter((e) => e.status === 'registered' || e.status === 'qualified')
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.displayNameAtRegistration}
                      </option>
                    ))}
                </select>
              </span>
            </label>
            <label className="field">
              Motivo (obbligatorio)
              <input
                value={leaveReason}
                placeholder="es. infortunio"
                onChange={(e) => setLeaveReason(e.target.value)}
              />
            </label>
            <ErrorMessage error={mutation.error} />
            <button
              className="primary"
              disabled={!leaveReason.trim() || mutation.isPending}
              onClick={() => {
                command('entries/withdraw', { entryId: leaving, reason: leaveReason.trim() });
                setLeaving('');
                setLeaveReason('');
              }}
            >
              RITIRA GIOCATORE
            </button>
            <button onClick={() => setLeaving('')}>Annulla</button>
          </Modal>
        )}
        {cancel && (
          <Modal
            variant="dialog"
            tone="danger"
            alert
            title="Annullare il torneo?"
            close={() => setCancel(false)}
          >
            <p>
              Il torneo diventa “annullato”: resta nello storico ma esce dalle statistiche dei
              giocatori. Non si può riattivare.
            </p>
            <button className="primary" onClick={() => setCancel(false)}>
              TIENI IL TORNEO
            </button>
            <button
              className="danger-outline"
              disabled={mutation.isPending}
              onClick={() => {
                command('cancel');
                setCancel(false);
              }}
            >
              Sì, annulla definitivamente
            </button>
          </Modal>
        )}
      </main>
    </>
  );
}
