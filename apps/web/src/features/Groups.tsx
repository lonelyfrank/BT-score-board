import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, ArrowUpDown, ChevronDown, Info, Pause, Play, UserMinus, X } from 'lucide-react';
import { CrownIcon } from '../components/BrandIcons';
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
  Segmented,
  StatusChip,
  Tabs,
  statusLabel,
  useTab,
} from '../components/ui';
import { api, type Tournament } from '../services/api';
import { formatLabel, gameOf, isResultRecording } from '../services/rules';
import {
  ActionsMenu,
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
      <span className="match-vs">
        <small>#{m.sequence}</small>
        <b className={side(a)}>{a ? entryName(t, a.tournamentEntryId) : '—'}</b>
        <span className="vs-mid">{done || live ? middle : 'vs'}</span>
        <b className={side(b)}>{b ? entryName(t, b.tournamentEntryId) : 'bye'}</b>
      </span>
      <StatusChip
        tone={live ? 'live' : done ? (m.winnerEntryId ? 'success' : 'warning') : 'neutral'}
      >
        {done && m.winnerEntryId ? `V ${entryName(t, m.winnerEntryId).split(' ')[0]}` : tag}
      </StatusChip>
    </>
  );
  if (reorder !== undefined)
    return (
      <div className="mrow match">
        {content}
        {reorder && (
          <button
            type="button"
            className="mini"
            aria-label={`Anticipa incontro #${m.sequence}`}
            onClick={reorder}
          >
            <ArrowUp />
          </button>
        )}
      </div>
    );
  return (
    <Link className={`mrow match ${live ? 'live' : ''}`} to={`/partite/${m.id}`}>
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
    <>
      <div className="card gt-card">
        <table className="gt" aria-label={`Classifica ${groupLabel(table.groupName)}`}>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Giocatore</th>
              {columns.map((h) => (
                <th scope="col" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.tournamentEntryId} className={r.placement <= cut ? 'q' : ''}>
                <td>{r.placement}</td>
                <td>
                  {entryName(t, r.tournamentEntryId)}
                  {r.tied && r.played > 0 && <span className="tag">PARI</span>}
                  {r.withdrawn && <span className="tag">RITIRATO</span>}
                  {qualified.includes(r.tournamentEntryId) && <span className="tag ok">Q</span>}
                </td>
                <td>{r.played}</td>
                <td>{r.wins}</td>
                <td>{r.draws}</td>
                <td>{r.losses}</td>
                {byScore && <td>{signed(r.difference)}</td>}
                <td>{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="gt-legend">
        <i aria-hidden="true" />
        Qualificati: primi {cut} · V {c.winPoints} · N {c.drawPoints} · P {c.lossPoints}
      </p>
      <p className="hint">
        Ordine:{' '}
        {byScore
          ? 'punti, differenza, punti segnati, scontro diretto (solo tra 2), poi spareggio o decisione.'
          : 'punti, vittorie, scontro diretto (solo tra 2), poi spareggio o decisione.'}
      </p>
    </>
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
        <main>
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
  const upcoming = ready.filter((m) => m.id !== onBoard?.id).slice(0, 3);
  const stageAction =
    !isDraft(t) && !ended ? (
      groupStage?.status === 'open' ? (
        <button
          type="button"
          className="btn cta"
          disabled={!canFinalize || mutation.isPending}
          onClick={() => command('qualification/finalize')}
        >
          CONFERMA QUALIFICA
        </button>
      ) : groupStage?.status === 'finalized' && !knockout.length ? (
        <button
          type="button"
          className="btn cta"
          disabled={!active || mutation.isPending}
          onClick={() => command('finals/generate')}
        >
          GENERA TABELLONE
        </button>
      ) : knockoutDone ? (
        <button
          type="button"
          className="btn cta"
          disabled={!active || mutation.isPending}
          onClick={() => command('elimination/advance')}
        >
          PROSSIMO TURNO
        </button>
      ) : finalMatch?.status === 'completed' ? (
        <button
          type="button"
          className="btn cta"
          disabled={!active || !!openTiebreak || !!knockoutTie || mutation.isPending}
          onClick={() => command('complete')}
        >
          CONFERMA RISULTATO FINALE
        </button>
      ) : knockout.length > 0 ? (
        <button type="button" className="btn cta" onClick={() => setTab('bracket')}>
          VAI AL TABELLONE
        </button>
      ) : null
    ) : null;
  return (
    <>
      <Header
        title={t.name}
        subtitle={[formatLabel(t.mode), gameOf(t).label, `${t.entries.length} giocatori`, eventName]
          .filter(Boolean)
          .join(' · ')}
        back="/tornei"
        backLabel="Indietro ai tornei"
        action={
          <ActionsMenu
            actions={[
              ...(!isDraft(t) && !ended
                ? [
                    {
                      icon: paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />,
                      label: paused ? 'Riprendi torneo' : 'Metti in pausa il torneo',
                      hint: paused
                        ? 'Si torna a registrare risultati'
                        : 'Nessun risultato finché non riprendi',
                      run: () => command(paused ? 'resume' : 'pause'),
                      disabled: (!active && !paused) || mutation.isPending,
                    },
                  ]
                : []),
              ...(active && isResultRecording(t)
                ? [
                    {
                      icon: <UserMinus aria-hidden="true" />,
                      label: 'Ritira un giocatore…',
                      hint: 'Gli incontri da giocare vanno all’avversario a tavolino',
                      run: () =>
                        setLeaving(
                          t.entries.find(
                            (e) => e.status === 'registered' || e.status === 'qualified',
                          )?.id ?? '',
                        ),
                    },
                  ]
                : []),
              ...(ready.length > 1 && active
                ? [
                    {
                      icon: <ArrowUpDown aria-hidden="true" />,
                      label: 'Riordina gli incontri',
                      hint: 'Cambia l’ordine degli incontri da giocare',
                      run: () => {
                        setTab('groups');
                        setReordering(true);
                      },
                    },
                  ]
                : []),
              ...(!isDraft(t) && !ended
                ? [
                    {
                      icon: <X aria-hidden="true" />,
                      label: 'Annulla torneo…',
                      hint: 'Resta nello storico, esce dalle statistiche',
                      run: () => setCancel(true),
                    },
                  ]
                : []),
            ]}
          />
        }
      />
      <div className="toolbar">
        <Tabs
          label="Sezioni del torneo"
          tabs={[
            { id: 'overview', label: 'Panoramica', attention: !!tieToShow },
            { id: 'groups', label: 'Gironi' },
            { id: 'bracket', label: 'Tabellone' },
            { id: 'ranking', label: 'Classifica' },
          ]}
          value={tab}
          change={setTab}
        />
        {tab === 'groups' && groups.length > 1 && (
          <Segmented
            label="Girone"
            value={selected?.id ?? ''}
            change={(id) => setGroup(groups.findIndex((g) => g.id === id))}
            options={groups.map((g) => ({ id: g.id, label: groupLabel(g.name) }))}
          />
        )}
      </div>
      <main className="tournament">
        <ErrorMessage error={error} retry={retry} />
        {tab === 'overview' && (
          <>
            {isDraft(t) && <DraftPanel t={t} busy={mutation.isPending} command={command} />}
            {t.status === 'completed' && <Podium t={t} />}
            <StageTimeline steps={groupSteps(t)} />
            {tieToShow?.table && tieToShow.group && (
              <TieAlert
                action={{
                  label: 'Spareggio sul totem',
                  disabled: !active || mutation.isPending,
                  run: () => setTie({ table: tieToShow.table!, group: tieToShow.group! }),
                }}
                secondary={{
                  label: 'Decido io',
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
                decide uno spareggio sul totem o l’organizzatore.
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
            {upcoming.length > 0 && !ended && (
              <>
                <div className="sec-h">
                  <h3>Prossimi</h3>
                  <span>{knockout.length ? 'a eliminazione diretta' : 'nei gironi'}</span>
                </div>
                <div className="list">
                  {upcoming.map((m) => (
                    <MatchRow key={m.id} t={t} m={m} />
                  ))}
                </div>
              </>
            )}
            {t.status === 'completed' && <BackupLink />}
            <p className="note">
              <Info aria-hidden="true" />
              <span>
                {knockout.length
                  ? 'Ogni turno a eliminazione diretta richiede un vincitore: niente pareggi.'
                  : note}
              </span>
            </p>
          </>
        )}
        {tab === 'groups' &&
          (groups.length ? (
            <>
              {selectedTable && (
                <GroupTable
                  t={t}
                  table={selectedTable}
                  cut={c.qualifiersPerGroup}
                  qualified={groupStage?.status === 'finalized' ? seeds : []}
                />
              )}
              <div className="sec-h">
                <h3>Incontri</h3>
                {reordering ? (
                  <button
                    type="button"
                    className="btn sm"
                    aria-pressed
                    onClick={() => setReordering(false)}
                  >
                    Fatto
                  </button>
                ) : (
                  <span>
                    {selectedMatches.filter((m) => m.status === 'completed').length}/
                    {selectedMatches.length} giocati
                  </span>
                )}
              </div>
              {rounds.map((round) => (
                <section key={round} className="list" aria-label={`Round ${round}`}>
                  <h4 className="group-l">Round {round}</h4>
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
                  <section key={m.id} className="list">
                    <h4 className="group-l">Spareggio</h4>
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
            <p className="hint">
              {knockout.length
                ? 'Tabellone generato dai risultati confermati.'
                : 'Anteprima: il tabellone si genera dopo la conferma della qualifica.'}
            </p>
            <div className="bracket">
              {knockout.length
                ? knockout.map((s) => (
                    <section
                      className="bracket-round"
                      key={s.id}
                      aria-label={knockoutTitle(s.kind)}
                    >
                      <h3 className="group-l">{knockoutTitle(s.kind)}</h3>
                      {stageMatches(s.id).map((m, i) => (
                        <article
                          key={m.id}
                          className={`bracket-match ${playable(m) ? 'open' : ''} ${s.kind === 'final' ? 'final' : ''}`}
                        >
                          <span className="field-l">
                            {m.matchType === 'tiebreak'
                              ? 'SPAREGGIO'
                              : `${knockoutTitle(s.kind).toUpperCase()}${stageMatches(s.id).length > 1 ? ` ${i + 1}` : ''}`}
                          </span>
                          {m.participants.map((p) => (
                            <span
                              key={p.tournamentEntryId}
                              className={`bm-row ${m.winnerEntryId === p.tournamentEntryId ? 'win' : ''}`}
                            >
                              <small>S{seedOf(p.tournamentEntryId)}</small>
                              <span>{entryName(t, p.tournamentEntryId)}</span>
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
                          {m.participants.length === 1 && <span className="hint">bye</span>}
                          {playable(m) && (
                            <Link className="btn sm" to={`/partite/${m.id}`}>
                              Gioca
                            </Link>
                          )}
                        </article>
                      ))}
                    </section>
                  ))
                : [
                    <section className="bracket-round" key="first">
                      <h3 className="group-l">
                        {plannedPairs(t).length === 1 ? 'Finale' : 'Primo turno'}
                      </h3>
                      {plannedPairs(t).map((pair, i) => (
                        <article className="bracket-match planned" key={i}>
                          {pair.map((x, k) => (
                            <span className="bm-row" key={k}>
                              <span>{x ?? 'bye'}</span>
                            </span>
                          ))}
                        </article>
                      ))}
                    </section>,
                    plannedPairs(t).length > 1 && (
                      <section className="bracket-round" key="final">
                        <h3 className="group-l">Finale</h3>
                        <article className="bracket-match planned final">
                          <span className="bm-row">
                            <CrownIcon className="inline-crown" />
                            <span>Vincenti del turno precedente</span>
                          </span>
                        </article>
                      </section>
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
                <div className="card gt-card" key={table.targetId}>
                  <table
                    className="gt plain"
                    aria-label={`${groupLabel(table.groupName)} · statistiche`}
                  >
                    <thead>
                      <tr>
                        <th scope="col">Giocatore</th>
                        <th scope="col">Segnati</th>
                        <th scope="col">Media</th>
                        <th scope="col">{isResultRecording(t) ? 'Record' : 'Best'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((r) => (
                        <tr key={r.tournamentEntryId}>
                          <td>{entryName(t, r.tournamentEntryId)}</td>
                          <td>{r.scored}</td>
                          <td>{(isResultRecording(t) ? r.averageScore : r.average).toFixed(1)}</td>
                          <td>{isResultRecording(t) ? r.bestScore : r.bestTurn}</td>
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
          <Modal
            title="Ritirare un giocatore?"
            close={() => setLeaving('')}
            footer={
              <>
                <button type="button" className="btn ghost" onClick={() => setLeaving('')}>
                  Annulla
                </button>
                <button
                  type="button"
                  className="btn cta"
                  disabled={!leaveReason.trim() || mutation.isPending}
                  onClick={() => {
                    command('entries/withdraw', { entryId: leaving, reason: leaveReason.trim() });
                    setLeaving('');
                    setLeaveReason('');
                  }}
                >
                  RITIRA GIOCATORE
                </button>
              </>
            }
          >
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
                <ChevronDown aria-hidden="true" />
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
          </Modal>
        )}
        {cancel && (
          <Modal
            variant="dialog"
            tone="danger"
            alert
            title="Annullare il torneo?"
            close={() => setCancel(false)}
            footer={
              <>
                <button type="button" className="btn cta" onClick={() => setCancel(false)}>
                  TIENI IL TORNEO
                </button>
                <button
                  type="button"
                  className="btn danger"
                  disabled={mutation.isPending}
                  onClick={() => {
                    command('cancel');
                    setCancel(false);
                  }}
                >
                  Sì, annulla definitivamente
                </button>
              </>
            }
          >
            <p>
              Il torneo diventa “annullato”: resta nello storico ma esce dalle statistiche dei
              giocatori. Non si può riattivare.
            </p>
          </Modal>
        )}
      </main>
      {tab === 'overview' && stageAction && (
        <div className="actionbar">
          {stageAction}
          <p
            role="status"
            className={`form-reason ${canFinalize || (groupStage?.status === 'finalized' && !knockout.length) ? 'ok' : 'muted'}`}
          >
            {note}
          </p>
        </div>
      )}
    </>
  );
}
